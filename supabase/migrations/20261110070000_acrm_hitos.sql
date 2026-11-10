-- Los hitos de cada lead: el plan de contactos hasta conseguir la reunión.
--
-- Un hito es una acción de la cola con algo más: el mensaje que se le va a mandar, ya redactado, y
-- el canal por el que va. El agente de la ficha (función acrm-ficha) los propone uno detrás de otro
-- —primer mensaje, seguimiento, llamada, propuesta de reunión— y la persona los aprueba; al
-- cumplirlos, el mensaje queda en el hilo y el siguiente hito ya está esperando con su fecha.
--
-- Aditivo: dos columnas opcionales en lr_acrm_acciones y una operación propia para crear y editar
-- hitos. No toca lr_acrm_operar ni lo que ya funciona; una acción sin mensaje sigue siendo la de
-- siempre.
BEGIN;

ALTER TABLE public.lr_acrm_acciones
 ADD COLUMN mensaje text CHECK (mensaje IS NULL OR length(mensaje) <= 4000),
 ADD COLUMN canal text CHECK (canal IS NULL OR canal IN ('linkedin','whatsapp','llamada','correo','reunion'));

-- crear: {captura, accion, vence_en, mensaje?, canal?, responsable?} — sin responsable, quien lo crea.
-- editar: {id, version, accion?, vence_en?, mensaje?, canal?} — solo el responsable, con control de
-- versión, y como en «editar» de siempre se borra la prioridad de IA, que ya no corresponde.
CREATE FUNCTION private.lr_acrm_hito(p_accion text, p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid := auth.uid(); a public.lr_acrm_acciones%rowtype; v_id uuid; v_resp uuid;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501'; END IF;
 IF coalesce(p_datos->>'canal','') NOT IN ('','linkedin','whatsapp','llamada','correo','reunion') THEN RAISE EXCEPTION 'Canal inválido'; END IF;
 IF p_accion = 'crear' THEN
  IF NOT EXISTS (SELECT 1 FROM public.lr_acrm_capturas WHERE clave = p_datos->>'captura') THEN RAISE EXCEPTION 'Ese prospecto no existe'; END IF;
  v_resp := coalesce(nullif(p_datos->>'responsable','')::uuid, v_uid);
  IF NOT EXISTS (SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id = v_resp AND activo) THEN RAISE EXCEPTION 'Responsable no habilitado'; END IF;
  INSERT INTO public.lr_acrm_acciones(captura, responsable, accion, vence_en, tipo, mensaje, canal)
  VALUES (p_datos->>'captura', v_resp, left(p_datos->>'accion', 240), (p_datos->>'vence_en')::timestamptz, 'seguimiento',
          nullif(left(coalesce(p_datos->>'mensaje',''), 4000), ''), nullif(p_datos->>'canal',''))
  RETURNING id INTO v_id;
 ELSIF p_accion = 'editar' THEN
  SELECT * INTO a FROM public.lr_acrm_acciones WHERE id = (p_datos->>'id')::uuid FOR UPDATE;
  IF a.id IS NULL OR a.version IS DISTINCT FROM (p_datos->>'version')::int OR a.estado <> 'pendiente' THEN
   RAISE EXCEPTION 'El hito cambió. Actualiza la ficha.';
  END IF;
  IF a.responsable <> v_uid THEN RAISE EXCEPTION 'Solo el responsable puede editar su hito'; END IF;
  UPDATE public.lr_acrm_acciones SET
   accion = coalesce(left(nullif(p_datos->>'accion',''), 240), accion),
   vence_en = coalesce(nullif(p_datos->>'vence_en','')::timestamptz, vence_en),
   mensaje = CASE WHEN p_datos ? 'mensaje' THEN nullif(left(coalesce(p_datos->>'mensaje',''), 4000), '') ELSE mensaje END,
   canal = CASE WHEN p_datos ? 'canal' THEN nullif(p_datos->>'canal','') ELSE canal END,
   version = version + 1, prioridad_ia = NULL, motivo_ia = NULL, ia_en = NULL
  WHERE id = a.id;
  v_id := a.id;
 ELSE
  RAISE EXCEPTION 'Acción inválida';
 END IF;
 RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_hito(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_hito(text, jsonb) TO authenticated;

CREATE FUNCTION public.lr_acrm_hito(p_accion text, p_datos jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_hito(p_accion, p_datos);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_hito(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_hito(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
