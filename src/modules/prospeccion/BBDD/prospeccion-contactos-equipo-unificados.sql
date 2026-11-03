-- LR Suite: lista unificada de contactos LinkedIn para miembros autorizados.
-- Conserva aportes separados por usuario e historial de cargas.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lr_pros_colaboradores (
  usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  nombre text NOT NULL CHECK(length(nombre) BETWEEN 2 AND 100),
  activo boolean NOT NULL DEFAULT true,
  administrador boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lr_pros_colaboradores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lr_pros_colaboradores FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lr_pros_colaboradores TO authenticated;

INSERT INTO public.lr_pros_colaboradores(usuario_id,nombre,activo,administrador)
SELECT u.id,CASE lower(u.email)
 WHEN 'jorgeluis@limaretail.com' THEN 'Jorge Luis'
 WHEN 'diegomachuca@limaretail.com' THEN 'Diego'
 END,true,true
FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL
 AND lower(u.email) IN ('jorgeluis@limaretail.com','diegomachuca@limaretail.com')
ON CONFLICT (usuario_id) DO UPDATE SET
 nombre=EXCLUDED.nombre,activo=true,administrador=true;

CREATE OR REPLACE FUNCTION public.lr_pros_usuario_habilitado()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth'
AS $fn$
 SELECT EXISTS (
 SELECT 1 FROM public.lr_pros_colaboradores m
 JOIN auth.users u ON u.id=m.usuario_id
 WHERE m.usuario_id=(SELECT auth.uid()) AND m.activo
 AND u.email_confirmed_at IS NOT NULL
 );
$fn$;
REVOKE ALL ON FUNCTION public.lr_pros_usuario_habilitado() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_usuario_habilitado() TO authenticated;

DROP POLICY IF EXISTS lr_pros_colaboradores_lectura ON public.lr_pros_colaboradores;
CREATE POLICY lr_pros_colaboradores_lectura ON public.lr_pros_colaboradores
 FOR SELECT TO authenticated USING ((SELECT public.lr_pros_usuario_habilitado()));

DROP POLICY IF EXISTS lr_pros_contactos_propios_solo_dueno ON public.lr_pros_contactos_propios;
DROP POLICY IF EXISTS lr_pros_contactos_propios_equipo ON public.lr_pros_contactos_propios;
CREATE POLICY lr_pros_contactos_propios_equipo ON public.lr_pros_contactos_propios
 FOR SELECT TO authenticated USING ((SELECT public.lr_pros_usuario_habilitado()));

DROP POLICY IF EXISTS lr_pros_cargas_propias_solo_dueno ON public.lr_pros_cargas_propias;
DROP POLICY IF EXISTS lr_pros_cargas_propias_usuario ON public.lr_pros_cargas_propias;
CREATE POLICY lr_pros_cargas_propias_usuario ON public.lr_pros_cargas_propias
 FOR SELECT TO authenticated USING (
 usuario_id=(SELECT auth.uid()) AND (SELECT public.lr_pros_usuario_habilitado()));

DO $fix$
DECLARE v_original text;v_new text;
BEGIN
 v_original:=pg_get_functiondef('public.lr_pros_importar_mis_contactos(jsonb)'::regprocedure);
 IF v_original IS NULL THEN RAISE EXCEPTION 'No existe importación incremental'; END IF;
 IF strpos(v_original,'NOT public.is_lr_suite_pending_user()')=0 THEN
   RAISE EXCEPTION 'Cambió el guard de importación, no se modifica automáticamente';
 END IF;
 v_new:=replace(v_original,'NOT public.is_lr_suite_pending_user()','NOT public.lr_pros_usuario_habilitado()');
 EXECUTE v_new;
END $fix$;
REVOKE ALL ON FUNCTION public.lr_pros_importar_mis_contactos(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_importar_mis_contactos(jsonb) TO authenticated;

CREATE OR REPLACE VIEW public.lr_pros_contactos_unificados
WITH (security_invoker=true) AS
WITH registros AS (
 SELECT c.id,c.usuario_id,c.linkedin_url,c.nombre,c.apellido,
 c.empresa,c.cargo,c.ubicacion,c.peru_verificado,c.actualizado_en,
 COALESCE('li:'||c.linkedin_url,c.clave) AS identidad,
 m.nombre AS aportador
 FROM public.lr_pros_contactos_propios c
 JOIN public.lr_pros_colaboradores m ON m.usuario_id=c.usuario_id
 WHERE m.activo
),
marcados AS (
 SELECT registros.*,
 ROW_NUMBER() OVER(PARTITION BY identidad
 ORDER BY (CASE WHEN nullif(empresa,'') IS NOT NULL THEN 1 ELSE 0 END
   +CASE WHEN nullif(cargo,'') IS NOT NULL THEN 1 ELSE 0 END
   +CASE WHEN nullif(ubicacion,'') IS NOT NULL THEN 1 ELSE 0 END) DESC,
 actualizado_en DESC,id) AS numero
 FROM registros
),
aportantes AS (
 SELECT identidad,COUNT(DISTINCT usuario_id)::int AS cantidad_fuentes,
 STRING_AGG(DISTINCT aportador,', ' ORDER BY aportador) AS aportado_por
 FROM registros GROUP BY identidad
)
SELECT m.id,m.nombre,m.apellido,m.empresa,m.cargo,m.linkedin_url,m.ubicacion,
 m.peru_verificado,m.actualizado_en,a.aportado_por,a.cantidad_fuentes
FROM marcados m JOIN aportantes a ON a.identidad=m.identidad
WHERE m.numero=1;
REVOKE ALL ON public.lr_pros_contactos_unificados FROM PUBLIC,anon;
GRANT SELECT ON public.lr_pros_contactos_unificados TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_pros_autorizar_colaborador(
 p_email text,p_nombre text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $fn$
DECLARE v_user uuid;v_email text:=lower(btrim(p_email));
BEGIN
 IF (SELECT COUNT(*) FROM public.lr_pros_colaboradores
     WHERE usuario_id=auth.uid() AND activo AND administrador)<>1 THEN
  RAISE EXCEPTION 'Solo un administrador puede agregar participantes' USING ERRCODE='42501';
 END IF;
 IF v_email IS NULL OR length(v_email)>254 OR length(coalesce(p_nombre,'')) NOT BETWEEN 2 AND 100 THEN
  RAISE EXCEPTION 'Email o nombre no válidos';
 END IF;
 SELECT u.id INTO v_user FROM auth.users u
 WHERE lower(u.email)=v_email AND u.email_confirmed_at IS NOT NULL;
 IF v_user IS NULL THEN RAISE EXCEPTION 'La cuenta debe existir y tener correo confirmado'; END IF;
 INSERT INTO public.lr_pros_colaboradores(usuario_id,nombre,activo,administrador)
 VALUES (v_user,btrim(p_nombre),true,false)
 ON CONFLICT(usuario_id) DO UPDATE SET nombre=EXCLUDED.nombre,activo=true;
 RETURN jsonb_build_object('status','authorized','usuario_id',v_user);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_pros_autorizar_colaborador(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_autorizar_colaborador(text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;