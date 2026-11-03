-- LR Suite | Barridos acumulativos de Investigación (v2)
-- Instalar después de prospeccion-investigacion-v1.sql.
BEGIN;
DO $guard$ BEGIN
 IF to_regprocedure('public.is_lr_suite_pending_user()') IS NULL OR to_regclass('public.lr_pros_candidatos') IS NULL THEN
   RAISE EXCEPTION 'Instalar primero Prospección Investigación v1';
 END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.lr_pros_barridos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 segmento text NOT NULL CHECK (segmento IN ('retail_ecommerce','servicios_leads')),
 consulta text NOT NULL DEFAULT '' CHECK (length(consulta) <= 70),
 cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
 total_barridos integer NOT NULL DEFAULT 0 CHECK (total_barridos >= 0),
 total_nuevos integer NOT NULL DEFAULT 0 CHECK (total_nuevos >= 0),
 ultimo_barrido_en timestamptz,
 actualizado_por uuid,
 creado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE (segmento,consulta)
);
ALTER TABLE public.lr_pros_barridos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lr_pros_barridos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lr_pros_barridos TO authenticated;
DROP POLICY IF EXISTS lr_pros_barridos_lee ON public.lr_pros_barridos;
CREATE POLICY lr_pros_barridos_lee ON public.lr_pros_barridos
 FOR SELECT TO authenticated USING (public.is_lr_suite_pending_user());

CREATE OR REPLACE FUNCTION public.lr_pros_barrido_estado(p_segmento text,p_consulta text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $body$
DECLARE v public.lr_pros_barridos%rowtype; k text := lower(btrim(coalesce(p_consulta,'')));
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_lr_suite_pending_user() THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_segmento NOT IN ('retail_ecommerce','servicios_leads') OR length(k)>70 THEN RAISE EXCEPTION 'Filtro inválido'; END IF;
 SELECT * INTO v FROM public.lr_pros_barridos WHERE segmento=p_segmento AND consulta=k;
 RETURN jsonb_build_object('cursor',coalesce(v.cursor,0),'total_barridos',coalesce(v.total_barridos,0),
   'total_nuevos',coalesce(v.total_nuevos,0));
END
$body$;

CREATE OR REPLACE FUNCTION public.lr_pros_barrido_avanzar(
 p_segmento text,p_consulta text,p_cursor integer,p_siguiente integer,p_nuevos integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $body$
DECLARE v public.lr_pros_barridos%rowtype; k text := lower(btrim(coalesce(p_consulta,'')));
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_lr_suite_pending_user() THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_segmento NOT IN ('retail_ecommerce','servicios_leads') OR length(k)>70 OR p_cursor<0 OR p_siguiente<0 OR p_nuevos NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Parámetros de barrido inválidos';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lr_pros_barrido:'||p_segmento||':'||k,0));
 SELECT * INTO v FROM public.lr_pros_barridos WHERE segmento=p_segmento AND consulta=k FOR UPDATE;
 IF NOT FOUND THEN
  IF p_cursor<>0 THEN RAISE EXCEPTION 'Cursor desactualizado: reinicie la búsqueda'; END IF;
  INSERT INTO public.lr_pros_barridos(segmento,consulta,cursor,total_barridos,total_nuevos,ultimo_barrido_en,actualizado_por)
  VALUES(p_segmento,k,p_siguiente,1,p_nuevos,now(),auth.uid()) RETURNING * INTO v;
 ELSE
  IF v.cursor<>p_cursor THEN RAISE EXCEPTION 'Otro barrido avanzó el cursor: actualice'; END IF;
  UPDATE public.lr_pros_barridos SET cursor=p_siguiente,total_barridos=total_barridos+1,
   total_nuevos=total_nuevos+p_nuevos,ultimo_barrido_en=now(),actualizado_por=auth.uid()
  WHERE id=v.id RETURNING * INTO v;
 END IF;
 RETURN jsonb_build_object('cursor',v.cursor,'total_barridos',v.total_barridos,'total_nuevos',v.total_nuevos);
END
$body$;

REVOKE ALL ON FUNCTION public.lr_pros_barrido_estado(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_barrido_estado(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.lr_pros_barrido_avanzar(text,text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_barrido_avanzar(text,text,integer,integer,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;