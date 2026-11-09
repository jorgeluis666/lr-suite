BEGIN;
-- One operational record per canonical profile, independent of who imported it.
CREATE TABLE public.lr_acrm_contactos (
 linkedin_url text PRIMARY KEY CHECK (linkedin_url ~ '^https://www[.]linkedin[.]com/in/[a-z0-9][a-z0-9_.%-]{1,180}$'),
 responsable uuid NOT NULL REFERENCES public.lr_pros_colaboradores(usuario_id),
 estado text NOT NULL CHECK (estado IN ('asignado','reservado','contactado')),
 version integer NOT NULL DEFAULT 1,
 contactado_por uuid REFERENCES public.lr_pros_colaboradores(usuario_id),
 contactado_en timestamptz,
 actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.lr_acrm_contacto_eventos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 linkedin_url text NOT NULL REFERENCES public.lr_acrm_contactos(linkedin_url),
 actor uuid NOT NULL REFERENCES public.lr_pros_colaboradores(usuario_id),
 accion text NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lr_acrm_eventos_perfil ON public.lr_acrm_contacto_eventos(linkedin_url,creado_en DESC);
ALTER TABLE public.lr_acrm_contactos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_acrm_contacto_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lr_acrm_contactos,public.lr_acrm_contacto_eventos FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lr_acrm_contactos,public.lr_acrm_contacto_eventos TO authenticated;
CREATE POLICY equipo_lectura ON public.lr_acrm_contactos FOR SELECT TO authenticated
 USING ((SELECT public.lr_pros_usuario_habilitado()));
CREATE POLICY equipo_lectura ON public.lr_acrm_contacto_eventos FOR SELECT TO authenticated
 USING ((SELECT public.lr_pros_usuario_habilitado()));

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE FUNCTION private.lr_acrm_contactar(p_url text,p_accion text,p_responsable uuid,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
 v_uid uuid := auth.uid(); v_url text; v_row public.lr_acrm_contactos%rowtype;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 v_url:=lower(regexp_replace(split_part(split_part(btrim(p_url),'?',1),'#',1),'/$',''));
 v_url:=regexp_replace(v_url,'^(https?://)?(www[.])?linkedin[.]com/','https://www.linkedin.com/');
 IF v_url IS NULL OR v_url !~ '^https://www[.]linkedin[.]com/in/[a-z0-9][a-z0-9_.%-]{1,180}$' THEN
  RAISE EXCEPTION 'URL de LinkedIn inválida';
 END IF;
 IF p_accion IS NULL OR p_accion NOT IN ('asignar','reservar','confirmar','cancelar') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lr_pros_contactos_unificados WHERE linkedin_url=v_url) THEN
  RAISE EXCEPTION 'Primero agrega el perfil a la base compartida';
 END IF;
 -- Serializes even the first insert: two simultaneous requests cannot both reserve.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_url,0));
 SELECT * INTO v_row FROM public.lr_acrm_contactos WHERE linkedin_url=v_url FOR UPDATE;
 IF coalesce(v_row.version,0) IS DISTINCT FROM p_version THEN
  RAISE EXCEPTION 'El perfil cambió. Actualiza la lista antes de continuar.' USING ERRCODE='40001';
 END IF;
 IF p_accion='asignar' THEN
  IF v_row.estado IN ('reservado','contactado') THEN RAISE EXCEPTION 'El contacto ya está reservado o realizado'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=p_responsable AND activo) THEN RAISE EXCEPTION 'Responsable no habilitado'; END IF;
  INSERT INTO public.lr_acrm_contactos(linkedin_url,responsable,estado) VALUES(v_url,p_responsable,'asignado')
  ON CONFLICT(linkedin_url) DO UPDATE SET responsable=p_responsable,version=lr_acrm_contactos.version+1,actualizado_en=now();
 ELSIF p_accion='reservar' THEN
  IF v_row.estado IN ('reservado','contactado') THEN RAISE EXCEPTION 'Este perfil ya está reservado o contactado'; END IF;
  IF v_row.responsable IS NOT NULL AND v_row.responsable<>v_uid THEN RAISE EXCEPTION 'Este perfil está asignado a otro compañero'; END IF;
  INSERT INTO public.lr_acrm_contactos(linkedin_url,responsable,estado) VALUES(v_url,v_uid,'reservado')
  ON CONFLICT(linkedin_url) DO UPDATE SET estado='reservado',version=lr_acrm_contactos.version+1,actualizado_en=now();
 ELSE
  IF v_row.responsable IS DISTINCT FROM v_uid OR v_row.estado IS DISTINCT FROM 'reservado' THEN
   RAISE EXCEPTION 'Solo quien reservó este contacto puede cerrarlo';
  END IF;
  UPDATE public.lr_acrm_contactos SET estado=CASE WHEN p_accion='confirmar' THEN 'contactado' ELSE 'asignado' END,
   contactado_por=CASE WHEN p_accion='confirmar' THEN v_uid END,
   contactado_en=CASE WHEN p_accion='confirmar' THEN now() END,
   version=version+1,actualizado_en=now() WHERE linkedin_url=v_url;
 END IF;
 INSERT INTO public.lr_acrm_contacto_eventos(linkedin_url,actor,accion) VALUES(v_url,v_uid,p_accion);
 SELECT * INTO v_row FROM public.lr_acrm_contactos WHERE linkedin_url=v_url;
 RETURN to_jsonb(v_row);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_contactar(text,text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_contactar(text,text,uuid,integer) TO authenticated;
CREATE FUNCTION public.lr_acrm_contactar(p_url text,p_accion text,p_responsable uuid DEFAULT NULL,p_version integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT private.lr_acrm_contactar(p_url,p_accion,p_responsable,p_version);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_contactar(text,text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_contactar(text,text,uuid,integer) TO authenticated;
DO $pub$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['lr_acrm_contactos','lr_pros_contactos_propios'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
  END IF;
 END LOOP;
END $pub$;
NOTIFY pgrst,'reload schema';
COMMIT;
