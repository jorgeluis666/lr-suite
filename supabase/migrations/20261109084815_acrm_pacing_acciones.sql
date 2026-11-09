BEGIN;
CREATE TABLE public.lr_acrm_capturas (
 clave text PRIMARY KEY,
 canal text NOT NULL CHECK(canal IN ('linkedin','meta_whatsapp')),
 nombre text NOT NULL,
 capturado_en timestamptz NOT NULL,
 consulta text NOT NULL DEFAULT '',
 ultimo_mensaje_en timestamptz,
 anuncio_id text,
 CHECK(length(clave)<500 AND length(nombre)<=300 AND length(consulta)<=2000)
);
CREATE TABLE public.lr_acrm_metas (
 mes date NOT NULL CHECK(extract(day FROM mes)=1),
 canal text NOT NULL CHECK(canal IN ('linkedin','meta_whatsapp')),
 objetivo integer NOT NULL CHECK(objetivo BETWEEN 0 AND 100000),
 PRIMARY KEY(mes,canal)
);
CREATE TABLE public.lr_acrm_acciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 captura text NOT NULL REFERENCES public.lr_acrm_capturas(clave),
 responsable uuid NOT NULL REFERENCES public.lr_pros_colaboradores(usuario_id),
 accion text NOT NULL CHECK(length(accion) BETWEEN 3 AND 240),
 vence_en timestamptz NOT NULL,
 tipo text NOT NULL DEFAULT 'seguimiento' CHECK(tipo IN ('primer_contacto','respuesta','seguimiento')),
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','hecha')),
 version integer NOT NULL DEFAULT 1,
 prioridad_ia integer CHECK(prioridad_ia BETWEEN 0 AND 100),
 motivo_ia text,
 ia_en timestamptz,
 creado_en timestamptz NOT NULL DEFAULT now(),
 completado_en timestamptz,
 completado_por uuid REFERENCES public.lr_pros_colaboradores(usuario_id)
);
CREATE UNIQUE INDEX lr_acrm_un_primer_contacto ON public.lr_acrm_acciones(captura) WHERE tipo='primer_contacto';
CREATE UNIQUE INDEX lr_acrm_una_respuesta ON public.lr_acrm_acciones(captura) WHERE tipo='respuesta' AND estado='pendiente';
CREATE INDEX lr_acrm_capturas_fecha ON public.lr_acrm_capturas(canal,capturado_en);
CREATE INDEX lr_acrm_acciones_cola ON public.lr_acrm_acciones(responsable,vence_en) WHERE estado='pendiente';
CREATE TABLE public.lr_acrm_meta_recibidos(id text PRIMARY KEY,recibido_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.lr_acrm_ia_limite(usuario uuid PRIMARY KEY REFERENCES auth.users(id),solicitado_en timestamptz NOT NULL);

DO $seg$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['lr_acrm_capturas','lr_acrm_metas','lr_acrm_acciones','lr_acrm_meta_recibidos','lr_acrm_ia_limite'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['lr_acrm_capturas','lr_acrm_metas','lr_acrm_acciones'] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY equipo_lectura ON public.%I FOR SELECT TO authenticated USING ((SELECT public.lr_pros_usuario_habilitado()))',t);
  EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
 END LOOP;
END $seg$;

-- Capture means first incorporation into ACRM, not the historical LinkedIn connection date.
INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en)
SELECT 'li:'||c.linkedin_url,'linkedin',max(c.nombre||' '||c.apellido),min(c.primera_carga_en)
FROM public.lr_pros_contactos_propios c JOIN public.lr_pros_colaboradores m ON m.usuario_id=c.usuario_id AND m.activo
WHERE c.linkedin_url IS NOT NULL GROUP BY c.linkedin_url;
CREATE FUNCTION private.lr_acrm_importado() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.linkedin_url IS NOT NULL THEN
  INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en)
  VALUES('li:'||NEW.linkedin_url,'linkedin',NEW.nombre||' '||NEW.apellido,NEW.primera_carga_en)
  ON CONFLICT(clave) DO UPDATE SET capturado_en=least(lr_acrm_capturas.capturado_en,EXCLUDED.capturado_en),nombre=EXCLUDED.nombre;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_importado() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lr_acrm_captura_importacion AFTER INSERT OR UPDATE ON public.lr_pros_contactos_propios
 FOR EACH ROW EXECUTE FUNCTION private.lr_acrm_importado();
CREATE FUNCTION private.lr_acrm_contacto_hecho() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.estado='contactado' THEN
  UPDATE public.lr_acrm_acciones SET estado='hecha',completado_en=NEW.contactado_en,completado_por=NEW.contactado_por,version=version+1
  WHERE captura='li:'||NEW.linkedin_url AND tipo='primer_contacto' AND estado='pendiente';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_contacto_hecho() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lr_acrm_cerrar_primer_contacto AFTER UPDATE ON public.lr_acrm_contactos
 FOR EACH ROW EXECUTE FUNCTION private.lr_acrm_contacto_hecho();

CREATE FUNCTION public.lr_acrm_pacing(p_mes date) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
WITH limites AS (
 SELECT date_trunc('month',p_mes)::date AS inicio,(date_trunc('month',p_mes)+interval '1 month')::date AS fin,
 (now() AT TIME ZONE 'America/Lima')::date AS hoy
), canales AS(SELECT unnest(ARRAY['linkedin','meta_whatsapp']) AS canal), datos AS (
 SELECT c.canal,coalesce(m.objetivo,0) AS meta,count(x.clave)::int AS capturados,
 count(x.clave) FILTER(WHERE x.anuncio_id IS NOT NULL)::int AS desde_anuncio,
 l.fin-l.inicio AS dias,greatest(0,least(l.fin-l.inicio,l.hoy-l.inicio+1)) AS transcurridos,
 greatest(0,l.fin-greatest(l.inicio,l.hoy)) AS restantes
 FROM canales c CROSS JOIN limites l LEFT JOIN public.lr_acrm_metas m ON m.canal=c.canal AND m.mes=l.inicio
 LEFT JOIN public.lr_acrm_capturas x ON x.canal=c.canal AND x.capturado_en>=l.inicio::timestamp AT TIME ZONE 'America/Lima'
 AND x.capturado_en<l.fin::timestamp AT TIME ZONE 'America/Lima'
 GROUP BY c.canal,m.objetivo,l.fin,l.inicio,l.hoy
)
SELECT coalesce(jsonb_agg(to_jsonb(datos)||jsonb_build_object(
 'esperados',round(meta::numeric*transcurridos/dias,1),
 'faltan',greatest(0,meta-capturados),
 'por_dia',CASE WHEN restantes>0 THEN ceil(greatest(0,meta-capturados)::numeric/restantes) ELSE NULL END)), '[]'::jsonb) FROM datos;
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_pacing(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_pacing(date) TO authenticated;

CREATE FUNCTION private.lr_acrm_operar(p_accion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); r record; c record; a public.lr_acrm_acciones%rowtype; v_id uuid; n integer:=0; limite integer; fecha date;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501'; END IF;
 IF p_accion='meta' THEN
  fecha:=(p_datos->>'mes')::date;
  INSERT INTO public.lr_acrm_metas(mes,canal,objetivo) VALUES(fecha,p_datos->>'canal',(p_datos->>'objetivo')::int)
  ON CONFLICT(mes,canal) DO UPDATE SET objetivo=EXCLUDED.objetivo;
 ELSIF p_accion='preparar' THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(982431);
  FOR r IN SELECT usuario_id FROM public.lr_pros_colaboradores WHERE activo ORDER BY nombre LOOP
   SELECT greatest(0,5-count(*))::int INTO limite FROM public.lr_acrm_acciones WHERE responsable=r.usuario_id AND estado='pendiente';
   FOR c IN SELECT x.*,o.version AS ov FROM public.lr_acrm_capturas x
    LEFT JOIN public.lr_acrm_contactos o ON o.linkedin_url=substr(x.clave,4)
    WHERE x.canal='linkedin' AND (o.estado IS NULL OR o.estado='asignado') AND (o.responsable IS NULL OR o.responsable=r.usuario_id)
    AND NOT EXISTS(SELECT 1 FROM public.lr_acrm_acciones existente WHERE existente.captura=x.clave AND existente.tipo='primer_contacto')
    ORDER BY x.capturado_en DESC,x.clave LIMIT limite LOOP
     IF c.ov IS NULL THEN PERFORM public.lr_acrm_contactar(substr(c.clave,4),'asignar',r.usuario_id,0); END IF;
     INSERT INTO public.lr_acrm_acciones(captura,responsable,accion,vence_en,tipo)
     VALUES(c.clave,r.usuario_id,'Enviar primer mensaje por LinkedIn',now(),'primer_contacto'); n:=n+1;
   END LOOP;
  END LOOP;
 ELSIF p_accion='crear' THEN
  IF NOT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=(p_datos->>'responsable')::uuid AND activo) THEN RAISE EXCEPTION 'Responsable no habilitado'; END IF;
  INSERT INTO public.lr_acrm_acciones(captura,responsable,accion,vence_en)
  VALUES(p_datos->>'captura',(p_datos->>'responsable')::uuid,p_datos->>'accion',(p_datos->>'vence_en')::timestamptz) RETURNING id INTO v_id;
 ELSIF p_accion IN ('editar','completar') THEN
  SELECT * INTO a FROM public.lr_acrm_acciones WHERE id=(p_datos->>'id')::uuid FOR UPDATE;
  IF a.id IS NULL OR a.version IS DISTINCT FROM (p_datos->>'version')::int OR a.estado<>'pendiente' THEN RAISE EXCEPTION 'La acción cambió. Actualiza la lista.'; END IF;
  IF a.responsable<>v_uid THEN RAISE EXCEPTION 'Solo el responsable puede editar o completar su acción'; END IF;
  IF p_accion='completar' THEN
   IF a.tipo='primer_contacto' THEN RAISE EXCEPTION 'Registra el envío desde la reserva del perfil'; END IF;
   UPDATE public.lr_acrm_acciones SET estado='hecha',completado_en=now(),completado_por=v_uid,version=version+1 WHERE id=a.id;
  ELSE
   UPDATE public.lr_acrm_acciones SET accion=p_datos->>'accion',vence_en=(p_datos->>'vence_en')::timestamptz,
    version=version+1,prioridad_ia=NULL,motivo_ia=NULL,ia_en=NULL WHERE id=a.id;
  END IF;
 ELSIF p_accion='turno_ia' THEN
  INSERT INTO public.lr_acrm_ia_limite(usuario,solicitado_en) VALUES(v_uid,now()) ON CONFLICT(usuario)
  DO UPDATE SET solicitado_en=now() WHERE lr_acrm_ia_limite.solicitado_en<now()-interval '60 seconds';
  IF NOT FOUND THEN RAISE EXCEPTION 'Espera un minuto antes de volver a priorizar'; END IF;
 ELSE RAISE EXCEPTION 'Acción inválida';
 END IF;
 RETURN jsonb_build_object('ok',true,'creadas',n,'id',v_id);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_operar(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_operar(text,jsonb) TO authenticated;
CREATE FUNCTION public.lr_acrm_operar(p_accion text,p_datos jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_operar(p_accion,p_datos);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_operar(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_operar(text,jsonb) TO authenticated;

-- Only the server can persist AI ranking. Version checks discard stale model output.
CREATE FUNCTION public.lr_acrm_guardar_prioridades(p_items jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE n integer;
BEGIN
 UPDATE public.lr_acrm_acciones a SET prioridad_ia=x.puntuacion,motivo_ia=left(x.motivo,300),ia_en=now()
 FROM jsonb_to_recordset(p_items) AS x(id uuid,version integer,puntuacion integer,motivo text)
 WHERE a.id=x.id AND a.version=x.version AND a.estado='pendiente';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_guardar_prioridades(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lr_acrm_guardar_prioridades(jsonb) TO service_role;

CREATE FUNCTION public.lr_acrm_recibir_meta(p_evento jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE k text; v_owner uuid; v_time timestamptz;
BEGIN
 IF coalesce(p_evento->>'telefono','')!~'^[0-9]{7,20}$' OR coalesce(p_evento->>'phone_id','')!~'^[0-9]{3,30}$' OR length(coalesce(p_evento->>'id','')) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Evento inválido'; END IF;
 v_time:=(p_evento->>'fecha')::timestamptz;
 IF v_time IS NULL OR v_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Fecha inválida'; END IF;
 INSERT INTO public.lr_acrm_meta_recibidos(id) VALUES(p_evento->>'id') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 k:='wa:'||(p_evento->>'phone_id')||':'||(p_evento->>'telefono');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(k,1));
 INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,consulta,ultimo_mensaje_en,anuncio_id)
 VALUES(k,'meta_whatsapp',left(coalesce(p_evento->>'nombre','Lead WhatsApp'),300),v_time,left(coalesce(p_evento->>'consulta','Mensaje adjunto'),2000),v_time,nullif(p_evento->>'anuncio_id',''))
 ON CONFLICT(clave) DO UPDATE SET capturado_en=least(lr_acrm_capturas.capturado_en,EXCLUDED.capturado_en),
  consulta=CASE WHEN EXCLUDED.ultimo_mensaje_en>=lr_acrm_capturas.ultimo_mensaje_en THEN EXCLUDED.consulta ELSE lr_acrm_capturas.consulta END,
  ultimo_mensaje_en=greatest(lr_acrm_capturas.ultimo_mensaje_en,EXCLUDED.ultimo_mensaje_en);
 SELECT responsable INTO v_owner FROM public.lr_acrm_acciones WHERE captura=k ORDER BY creado_en DESC LIMIT 1;
 IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=v_owner AND activo) THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(982432);
  SELECT m.usuario_id INTO v_owner FROM public.lr_pros_colaboradores m LEFT JOIN public.lr_acrm_acciones a ON a.responsable=m.usuario_id AND a.estado='pendiente'
  WHERE m.activo GROUP BY m.usuario_id,m.nombre ORDER BY count(a.id),m.nombre LIMIT 1;
 END IF;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin responsable habilitado'; END IF;
 INSERT INTO public.lr_acrm_acciones(captura,responsable,accion,vence_en,tipo)
 VALUES(k,v_owner,'Responder consulta de WhatsApp',now(),'respuesta')
 ON CONFLICT(captura) WHERE tipo='respuesta' AND estado='pendiente'
 DO UPDATE SET version=lr_acrm_acciones.version+1,prioridad_ia=NULL,motivo_ia=NULL,ia_en=NULL,vence_en=least(lr_acrm_acciones.vence_en,now());
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_recibir_meta(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lr_acrm_recibir_meta(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
