-- El bot de WhatsApp dentro del ACRM.
--
-- El asistente de la Agenda (función whatsapp) pasa a atender también a los leads que llegan por
-- pauta. Meta llama a un solo webhook, acrm-meta: guarda el lead en el ACRM y reenvía el mismo
-- mensaje firmado al asistente, que responde. Esta migración es lo que el ACRM necesita para eso:
--
--   · Que lo que responde el bot quede en el hilo del lead. Hasta ahora todo mensaje enviado tenía
--     que tener un autor del equipo; los del bot van sin autor y con origen 'agente', así que no
--     suman a la racha ni al marcador de nadie, pero sí mueven el embudo (nuevo → contactado).
--   · Que la tarea «Responder consulta de WhatsApp» se cierre sola cuando el bot respondió.
--   · Que la reunión que el bot agenda aparezca como hito en la ficha del lead.
--   · Que el equipo pueda tomar la conversación desde la ficha (el bot calla) y devolverla.
--   · Que la tabla del ACRM muestre en qué va el bot con cada lead (respondiendo, buscando cita,
--     cita agendada, control humano) y cuántas citas agendó hoy.
--   · Que, si el bot transfiere la conversación a una persona, la tarea de responder siga abierta.
BEGIN;

-- Un mensaje enviado lleva autor, salvo que lo haya escrito el bot.
ALTER TABLE public.lr_acrm_mensajes DROP CONSTRAINT lr_acrm_mensajes_check;
ALTER TABLE public.lr_acrm_mensajes ADD CONSTRAINT lr_acrm_mensajes_check CHECK (
 (direccion = 'recibido' AND autor IS NULL)
 OR (direccion = 'enviado' AND (autor IS NOT NULL OR origen = 'agente'))
);

-- Lo que el bot respondió, anotado en el ACRM. La llama la función whatsapp con la service_role:
-- no hay ningún usuario detrás. p_reunion, si el bot dejó una cita agendada. p_transferido, si el
-- bot pasó la conversación a una persona: su respuesta («te va a atender un asesor») no resuelve la
-- consulta, así que la tarea de responder queda abierta para el equipo.
CREATE FUNCTION public.lr_acrm_bot_respondio(p_clave text, p_texto text, p_wa_message_id text DEFAULT NULL,
 p_reunion timestamptz DEFAULT NULL, p_reunion_texto text DEFAULT NULL, p_transferido boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_owner uuid; v_cerradas integer := 0;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.lr_acrm_capturas WHERE clave = p_clave) THEN
  RETURN jsonb_build_object('ok', false, 'motivo', 'sin_captura');
 END IF;
 INSERT INTO public.lr_acrm_mensajes(captura, direccion, texto, enviado_en, autor, origen)
 VALUES (p_clave, 'enviado', left(coalesce(nullif(p_texto, ''), '(sin texto)'), 4000), now(), NULL, 'agente');
 -- La consulta ya tiene respuesta: su tarea se cierra. Lo que siga lo pide la conversación.
 IF NOT coalesce(p_transferido, false) THEN
  UPDATE public.lr_acrm_acciones SET estado = 'hecha', completado_en = now(), version = version + 1
  WHERE captura = p_clave AND tipo = 'respuesta' AND estado = 'pendiente';
  GET DIAGNOSTICS v_cerradas = ROW_COUNT;
 END IF;
 IF p_reunion IS NOT NULL THEN
  SELECT responsable INTO v_owner FROM public.lr_acrm_acciones WHERE captura = p_clave ORDER BY creado_en DESC LIMIT 1;
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id = v_owner AND activo) THEN
   SELECT usuario_id INTO v_owner FROM public.lr_pros_colaboradores WHERE activo ORDER BY nombre LIMIT 1;
  END IF;
  IF v_owner IS NOT NULL THEN
   INSERT INTO public.lr_acrm_acciones(captura, responsable, accion, vence_en, tipo, canal, mensaje)
   VALUES (p_clave, v_owner, left('Reunión agendada por el bot' || coalesce(' · ' || nullif(p_reunion_texto, ''), ''), 240),
           p_reunion, 'seguimiento', 'reunion', NULL);
  END IF;
 END IF;
 RETURN jsonb_build_object('ok', true, 'respuestas_cerradas', v_cerradas);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_bot_respondio(text, text, text, timestamptz, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lr_acrm_bot_respondio(text, text, text, timestamptz, text, boolean) TO service_role;

-- Quién atiende la conversación de un lead de WhatsApp: el bot o el equipo. Lo usa la ficha.
-- p_humano = true: el bot calla. false: vuelve a atender. Solo con sesión habilitada del ACRM.
CREATE FUNCTION private.lr_acrm_bot_control(p_captura text, p_humano boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_wa text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501'; END IF;
 v_wa := (regexp_match(coalesce(p_captura, ''), '^wa:[0-9]+:([0-9]{7,20})$'))[1];
 IF v_wa IS NULL THEN RAISE EXCEPTION 'Solo los leads de WhatsApp tienen conversación con el bot'; END IF;
 IF to_regclass('public.lr_suite_agenda_conversaciones') IS NULL THEN RAISE EXCEPTION 'Falta instalar la Agenda (agenda.sql)'; END IF;
 INSERT INTO public.lr_suite_agenda_conversaciones(wa_id, estado) VALUES (v_wa, CASE WHEN p_humano THEN 'humano' ELSE 'bot' END)
 ON CONFLICT (wa_id) DO UPDATE SET estado = EXCLUDED.estado,
  atencion = CASE WHEN EXCLUDED.estado = 'bot' THEN NULL ELSE lr_suite_agenda_conversaciones.atencion END;
 RETURN jsonb_build_object('ok', true, 'estado', CASE WHEN p_humano THEN 'humano' ELSE 'bot' END);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_bot_control(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_bot_control(text, boolean) TO authenticated;
CREATE FUNCTION public.lr_acrm_bot_control(p_captura text, p_humano boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.lr_acrm_bot_control(p_captura, p_humano);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_bot_control(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_bot_control(text, boolean) TO authenticated;

-- En qué va el bot con un lead, en una palabra, para la tabla y la ficha:
--   humano        el equipo tomó la conversación (o el bot la transfirió): el bot calla.
--   agendada      tiene una cita confirmada por venir (o de hoy).
--   buscando      la conversación llegó a la propuesta o a pedir datos: está cerrando la cita.
--   respondiendo  el bot está conversando.
--   cerrada       la conversación terminó sin cita pendiente.
--   sin_chat      el bot todavía no habló con este lead.
CREATE FUNCTION private.lr_acrm_bot_fase(p_wa text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $fn$
DECLARE r record;
BEGIN
 SELECT estado, etapa INTO r FROM public.lr_suite_agenda_conversaciones WHERE wa_id = p_wa;
 IF NOT FOUND THEN RETURN 'sin_chat'; END IF;
 IF r.estado = 'humano' THEN RETURN 'humano'; END IF;
 IF EXISTS (SELECT 1 FROM public.lr_suite_agenda_citas c WHERE c.wa_id = p_wa AND c.estado = 'confirmada' AND c.fin > now() - interval '12 hours') THEN
  RETURN 'agendada';
 END IF;
 RETURN CASE WHEN r.etapa IN ('propuesta', 'datos') THEN 'buscando' WHEN r.etapa IN ('agendado', 'cerrado') THEN 'cerrada' ELSE 'respondiendo' END;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_bot_fase(text) FROM PUBLIC, anon, authenticated;

-- Lo que la ficha muestra del bot: quién atiende, en qué va, su resumen y la próxima cita.
CREATE FUNCTION private.lr_acrm_bot_estado(p_captura text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $fn$
DECLARE v_wa text; r record; v_cita jsonb; v_activo boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501'; END IF;
 v_wa := (regexp_match(coalesce(p_captura, ''), '^wa:[0-9]+:([0-9]{7,20})$'))[1];
 IF v_wa IS NULL OR to_regclass('public.lr_suite_agenda_conversaciones') IS NULL THEN RETURN NULL; END IF;
 SELECT bot_activo INTO v_activo FROM public.lr_suite_agenda_config LIMIT 1;
 SELECT jsonb_build_object('inicio', c.inicio, 'tipo', c.tipo, 'meet', c.meet_url) INTO v_cita
 FROM public.lr_suite_agenda_citas c WHERE c.wa_id = v_wa AND c.estado = 'confirmada' AND c.fin > now() ORDER BY c.inicio LIMIT 1;
 SELECT estado, etapa, atencion, resumen, ultimo_mensaje_at INTO r FROM public.lr_suite_agenda_conversaciones WHERE wa_id = v_wa;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('estado', 'bot', 'etapa', 'nuevo', 'atencion', NULL, 'fase', 'sin_chat', 'cita', v_cita, 'bot_activo', coalesce(v_activo, true));
 END IF;
 RETURN jsonb_build_object('estado', r.estado, 'etapa', r.etapa, 'atencion', r.atencion, 'resumen', r.resumen, 'ultimo', r.ultimo_mensaje_at,
  'fase', private.lr_acrm_bot_fase(v_wa), 'cita', v_cita, 'bot_activo', coalesce(v_activo, true));
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_bot_estado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_bot_estado(text) TO authenticated;
CREATE FUNCTION public.lr_acrm_bot_estado(p_captura text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER STABLE SET search_path='' AS $fn$
 SELECT private.lr_acrm_bot_estado(p_captura);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_bot_estado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_bot_estado(text) TO authenticated;

-- El bot en la tabla del ACRM: si está prendido, cuántas citas agendó hoy (hora de Lima) y en qué va
-- con cada lead de WhatsApp de la página que se ve (hasta 200 claves por llamada).
CREATE FUNCTION private.lr_acrm_bot_tablero(p_capturas text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $fn$
DECLARE v_activo boolean; v_hoy integer; v_estados jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501'; END IF;
 IF to_regclass('public.lr_suite_agenda_conversaciones') IS NULL THEN RETURN NULL; END IF;
 SELECT bot_activo INTO v_activo FROM public.lr_suite_agenda_config LIMIT 1;
 SELECT count(*)::integer INTO v_hoy FROM public.lr_suite_agenda_citas c
 WHERE c.origen = 'asistente' AND c.estado <> 'cancelada'
   AND (c.created_at AT TIME ZONE 'America/Lima')::date = (now() AT TIME ZONE 'America/Lima')::date;
 SELECT coalesce(jsonb_object_agg(k.captura, private.lr_acrm_bot_fase(k.wa)), '{}'::jsonb) INTO v_estados
 FROM (SELECT DISTINCT x AS captura, (regexp_match(x, '^wa:[0-9]+:([0-9]{7,20})$'))[1] AS wa
       FROM unnest((coalesce(p_capturas, '{}'::text[]))[1:200]) AS x) k
 WHERE k.wa IS NOT NULL;
 RETURN jsonb_build_object('activo', coalesce(v_activo, true), 'agendados_hoy', v_hoy, 'estados', v_estados);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_bot_tablero(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.lr_acrm_bot_tablero(text[]) TO authenticated;
CREATE FUNCTION public.lr_acrm_bot_tablero(p_capturas text[]) RETURNS jsonb LANGUAGE sql SECURITY INVOKER STABLE SET search_path='' AS $fn$
 SELECT private.lr_acrm_bot_tablero(p_capturas);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_bot_tablero(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_bot_tablero(text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
