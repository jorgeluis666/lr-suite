-- Rubro, empresa y web de cada lead, en la tabla maestra del ACRM.
--
-- De un lead solo se sabía su nombre, su canal y, si vino por WhatsApp, su consulta. Para decidir
-- si vale la pena escribirle —y para escribirle algo que no sea genérico— hay que saber además a
-- qué se dedica, de qué empresa es y qué tiene publicado. Eso se miraba fuera de la suite, en
-- LinkedIn o en Google, y no quedaba escrito en ningún lado.
--
-- Van en lr_acrm_capturas y no en la cotización: son datos de calificación, anteriores a cotizar, y
-- la captura es la única fila que tiene todo lead de los tres canales.
--
-- No toca lr_acrm_operar: los tres se guardan con su propia función, así que esta migración no
-- reescribe nada de lo que ya mueve etapas, mensajes y cotizaciones.
BEGIN;

ALTER TABLE public.lr_acrm_capturas
 ADD COLUMN IF NOT EXISTS rubro text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS empresa text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS web text NOT NULL DEFAULT '';

ALTER TABLE public.lr_acrm_capturas DROP CONSTRAINT IF EXISTS lr_acrm_capturas_datos_largo;
ALTER TABLE public.lr_acrm_capturas ADD CONSTRAINT lr_acrm_capturas_datos_largo
 CHECK (length(rubro)<=120 AND length(empresa)<=200 AND length(web)<=300);

-- Guardar los tres de un lead. Escribe cualquier cuenta habilitada, como el resto del ACRM; la
-- captura tiene que existir ya (un lead se estrena por su canal o por su cotización, nunca por acá).
CREATE OR REPLACE FUNCTION private.lr_acrm_datos(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_web text;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 -- La web se guarda como URL completa: «limaretail.com» escrito a mano, pintado como enlace tal
 -- cual, abriría una ruta de la propia suite en vez del sitio del prospecto.
 v_web:=btrim(coalesce(p_datos->>'web',''));
 IF v_web<>'' AND v_web !~* '^https?://' THEN v_web:='https://'||v_web; END IF;
 UPDATE public.lr_acrm_capturas SET
  rubro=left(btrim(coalesce(p_datos->>'rubro','')),120),
  empresa=left(btrim(coalesce(p_datos->>'empresa','')),200),
  web=left(v_web,300)
 WHERE clave=p_datos->>'captura';
 IF NOT FOUND THEN RAISE EXCEPTION 'Ese prospecto no existe'; END IF;
 RETURN jsonb_build_object('ok',true);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_datos(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_datos(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_acrm_datos(p_datos jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_datos(p_datos);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_datos(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_datos(jsonb) TO authenticated;

COMMIT;
