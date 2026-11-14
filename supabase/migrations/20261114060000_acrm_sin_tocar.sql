-- Devolver un lead a «Sin tocar».
--
-- El embudo no retrocede: esa regla se queda. Lo que esta migración abre es una sola puerta, la del
-- contacto que nunca ocurrió. Abrir la ficha de un lead lo pasa a «Contactado» para no tener que
-- repetirlo en la tabla, pero entre abrir la ficha y mandar el mensaje puede no haber mensaje:
-- LinkedIn corta por límite de invitaciones, el perfil no deja escribir o uno abrió el que no era.
-- Ese lead tiene que poder volver a la cola de los que nadie tocó.
--
-- La puerta es estrecha a propósito:
--   · solo desde «contactado» (un lead que respondió, cotizó o se cerró no vuelve);
--   · solo si no hay ningún mensaje enviado en su hilo, que es lo que de verdad significa haber
--     contactado a alguien y lo que cuenta la racha del marcador;
--   · solo si su perfil de LinkedIn no tiene el primer contacto cerrado en la reserva.
-- Con eso, lo único que se puede deshacer es lo que la pantalla marcó sola.
--
-- Aditivo: no toca lr_acrm_operar ni la regla de orden del embudo. Prueba: tests/acrm/sin-tocar.mjs.
BEGIN;

CREATE OR REPLACE FUNCTION private.lr_acrm_sin_tocar(p_captura text, p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid := auth.uid(); e public.lr_acrm_embudo%rowtype;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN
  RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM public.lr_acrm_embudo WHERE captura=p_captura FOR UPDATE;
 IF e.captura IS NULL THEN RAISE EXCEPTION 'Ese prospecto no está en el embudo'; END IF;
 IF e.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'El embudo cambió. Actualiza la lista.'; END IF;
 IF e.etapa <> 'contactado' THEN
  RAISE EXCEPTION 'Solo vuelve a «Sin tocar» un lead en «Contactado»: este está en %', e.etapa;
 END IF;
 IF EXISTS (SELECT 1 FROM public.lr_acrm_mensajes WHERE captura=p_captura AND direccion='enviado') THEN
  RAISE EXCEPTION 'Este lead ya tiene un mensaje enviado en su hilo: ese contacto no se deshace';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.lr_acrm_contactos
  WHERE linkedin_url=substr(p_captura,4) AND p_captura LIKE 'li:%' AND estado='contactado'
 ) THEN
  RAISE EXCEPTION 'Su primer contacto de LinkedIn quedó registrado en la reserva: no se deshace desde aquí';
 END IF;
 UPDATE public.lr_acrm_embudo SET etapa='nuevo', contactado_en=NULL, respondio_en=NULL,
  version=version+1, actualizado_en=now(), actualizado_por=v_uid
 WHERE captura=e.captura;
 RETURN jsonb_build_object('ok',true,'captura',e.captura,'etapa','nuevo');
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_sin_tocar(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_sin_tocar(text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_acrm_sin_tocar(p_captura text, p_version integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_sin_tocar(p_captura,p_version);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_sin_tocar(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_sin_tocar(text,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
