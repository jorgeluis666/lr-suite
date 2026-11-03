-- Aplicar después de prospeccion-contactos-equipo-unificados.sql.
-- El seguimiento se guarda separado de las importaciones CSV.
BEGIN;
CREATE TABLE IF NOT EXISTS public.lr_pros_fichas (
 identidad text PRIMARY KEY,
 segmento text NOT NULL DEFAULT 'sin_clasificar' CHECK (segmento IN ('sin_clasificar','ecommerce','servicios','ambos','otro')),
 trabajadores integer CHECK (trabajadores BETWEEN 0 AND 100000000),
 fuente text NOT NULL DEFAULT '' CHECK (length(fuente)<=1000),
 verificado_en date,
 estado text NOT NULL DEFAULT 'por_contactar' CHECK (estado IN ('por_contactar','contactado','respondio','reunion','cliente','descartado')),
 proximo_contacto date,
 actualizado_por uuid REFERENCES auth.users(id),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 CHECK (trabajadores IS NULL OR (length(btrim(fuente))>0 AND verificado_en IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.lr_pros_mensajes (
 id uuid PRIMARY KEY,
 identidad text NOT NULL,
 enviado_en date NOT NULL,
 canal text NOT NULL CHECK (canal IN ('linkedin','correo','whatsapp','otro')),
 tema text NOT NULL CHECK (length(btrim(tema)) BETWEEN 1 AND 2000),
 creado_por uuid NOT NULL REFERENCES auth.users(id),
 creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_pros_mensajes_contacto ON public.lr_pros_mensajes(identidad,enviado_en DESC);
ALTER TABLE public.lr_pros_fichas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_pros_mensajes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lr_pros_fichas,public.lr_pros_mensajes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lr_pros_fichas,public.lr_pros_mensajes TO authenticated;
DROP POLICY IF EXISTS equipo ON public.lr_pros_fichas;
CREATE POLICY equipo ON public.lr_pros_fichas FOR SELECT TO authenticated USING ((SELECT public.lr_pros_usuario_habilitado()));
DROP POLICY IF EXISTS equipo ON public.lr_pros_mensajes;
CREATE POLICY equipo ON public.lr_pros_mensajes FOR SELECT TO authenticated USING ((SELECT public.lr_pros_usuario_habilitado()));

CREATE OR REPLACE VIEW public.lr_pros_seguimiento WITH (security_invoker=true) AS
SELECT u.*,coalesce('li:'||c.linkedin_url,c.clave) AS identidad,
 coalesce(f.segmento,'sin_clasificar') AS segmento,f.trabajadores,f.fuente,f.verificado_en,
 coalesce(f.estado,'por_contactar') AS estado,f.proximo_contacto,
 (SELECT count(*)::int FROM public.lr_pros_mensajes m WHERE m.identidad=coalesce('li:'||c.linkedin_url,c.clave)) AS mensajes_enviados,
 (SELECT max(enviado_en) FROM public.lr_pros_mensajes m WHERE m.identidad=coalesce('li:'||c.linkedin_url,c.clave)) AS ultimo_mensaje
FROM public.lr_pros_contactos_unificados u
JOIN public.lr_pros_contactos_propios c ON c.id=u.id
LEFT JOIN public.lr_pros_fichas f ON f.identidad=coalesce('li:'||c.linkedin_url,c.clave);
REVOKE ALL ON public.lr_pros_seguimiento FROM PUBLIC,anon;
GRANT SELECT ON public.lr_pros_seguimiento TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_pros_guardar_seguimiento(p_identidad text,p_ficha jsonb DEFAULT NULL,p_mensaje jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth'
AS $fn$
BEGIN
 IF NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Sin permiso' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.lr_pros_contactos_propios c JOIN public.lr_pros_colaboradores a ON a.usuario_id=c.usuario_id AND a.activo
 WHERE coalesce('li:'||c.linkedin_url,c.clave)=p_identidad) THEN
  RAISE EXCEPTION 'El contacto ya no existe; actualiza la lista';
 END IF;
 IF p_ficha IS NOT NULL THEN
  IF (p_ficha->>'verificado_en')::date > (now() AT TIME ZONE 'America/Lima')::date THEN
   RAISE EXCEPTION 'La verificación no puede ser futura';
  END IF;
  INSERT INTO public.lr_pros_fichas(identidad,segmento,trabajadores,fuente,verificado_en,estado,proximo_contacto,actualizado_por)
  VALUES(p_identidad,p_ficha->>'segmento',(p_ficha->>'trabajadores')::integer,coalesce(p_ficha->>'fuente',''),
   (p_ficha->>'verificado_en')::date,p_ficha->>'estado',(p_ficha->>'proximo_contacto')::date,auth.uid())
  ON CONFLICT(identidad) DO UPDATE SET segmento=EXCLUDED.segmento,trabajadores=EXCLUDED.trabajadores,
   fuente=EXCLUDED.fuente,verificado_en=EXCLUDED.verificado_en,estado=EXCLUDED.estado,
   proximo_contacto=EXCLUDED.proximo_contacto,actualizado_por=auth.uid(),actualizado_en=now();
 END IF;
 IF p_mensaje IS NOT NULL THEN
  IF (p_mensaje->>'enviado_en')::date > (now() AT TIME ZONE 'America/Lima')::date THEN
   RAISE EXCEPTION 'Solo registra mensajes ya enviados';
  END IF;
  INSERT INTO public.lr_pros_mensajes(id,identidad,enviado_en,canal,tema,creado_por)
  VALUES((p_mensaje->>'id')::uuid,p_identidad,(p_mensaje->>'enviado_en')::date,p_mensaje->>'canal',p_mensaje->>'tema',auth.uid())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.lr_pros_fichas(identidad,estado,actualizado_por) VALUES(p_identidad,'contactado',auth.uid())
  ON CONFLICT(identidad) DO UPDATE SET estado=CASE WHEN lr_pros_fichas.estado='por_contactar' THEN 'contactado' ELSE lr_pros_fichas.estado END;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_pros_guardar_seguimiento(text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_pros_guardar_seguimiento(text,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
