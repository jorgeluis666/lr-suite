-- El embudo del ACRM y el hilo de mensajes de cada prospecto.
--
-- Hasta ahora el módulo sabía a quién había que escribirle, pero no qué pasó después: la consulta
-- de WhatsApp se pisaba con cada mensaje nuevo y nada decía si un contacto llegó a cotización o a
-- venta. Estas dos tablas cierran eso.
--
-- La etapa no se teclea: sale de los mensajes. Un mensaje nuestro a quien nadie había escrito lo
-- deja «contactado»; una respuesta suya a eso lo deja «respondio». Las dos etapas que los mensajes
-- no pueden deducir —cotizado y el cierre— se marcan a mano o desde el agente, porque la cotización
-- vive en otro módulo.
--
-- Un mensaje entrante de alguien a quien todavía no le escribimos NO mueve nada: un lead de Meta
-- que preguntó y sigue sin respuesta es un prospecto sin tocar, y el embudo tiene que decirlo.
BEGIN;

-- ── Etapas ─────────────────────────────────────────────────────────────────
-- ganado y perdido comparten orden: los dos son finales, y así «perdido» nunca es un retroceso.
CREATE FUNCTION private.lr_acrm_etapa_orden(p_etapa text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE p_etapa WHEN 'nuevo' THEN 0 WHEN 'contactado' THEN 1 WHEN 'respondio' THEN 2 WHEN 'cotizado' THEN 3 ELSE 4 END;
$fn$;

CREATE TABLE public.lr_acrm_embudo (
 captura text PRIMARY KEY REFERENCES public.lr_acrm_capturas(clave) ON DELETE CASCADE,
 etapa text NOT NULL DEFAULT 'nuevo' CHECK(etapa IN ('nuevo','contactado','respondio','cotizado','ganado','perdido')),
 contactado_en timestamptz,
 respondio_en timestamptz,
 cotizado_en timestamptz,
 cerrado_en timestamptz,
 -- El id de la cotización en el módulo de Cotizaciones, que no vive en una tabla: es texto suelto
 -- a propósito, para no atar este embudo a cómo se guarde aquello.
 cotizacion text CHECK(cotizacion IS NULL OR length(cotizacion) BETWEEN 1 AND 120),
 monto numeric(12,2) CHECK(monto IS NULL OR (monto>=0 AND monto<100000000)),
 nota text CHECK(nota IS NULL OR length(nota)<=300),
 version integer NOT NULL DEFAULT 1,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_por uuid REFERENCES public.lr_pros_colaboradores(usuario_id)
);
CREATE INDEX lr_acrm_embudo_etapa ON public.lr_acrm_embudo(etapa);

CREATE TABLE public.lr_acrm_mensajes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 captura text NOT NULL REFERENCES public.lr_acrm_capturas(clave) ON DELETE CASCADE,
 direccion text NOT NULL CHECK(direccion IN ('enviado','recibido')),
 texto text NOT NULL CHECK(length(texto) BETWEEN 1 AND 4000),
 enviado_en timestamptz NOT NULL,
 autor uuid REFERENCES public.lr_pros_colaboradores(usuario_id),
 origen text NOT NULL DEFAULT 'manual' CHECK(origen IN ('manual','agente','webhook')),
 creado_en timestamptz NOT NULL DEFAULT now(),
 -- Lo nuestro siempre lo escribe alguien; lo que llega, nadie de la casa.
 CHECK((direccion='enviado') = (autor IS NOT NULL))
);
CREATE INDEX lr_acrm_mensajes_hilo ON public.lr_acrm_mensajes(captura,enviado_en DESC);
CREATE INDEX lr_acrm_mensajes_autor ON public.lr_acrm_mensajes(autor,enviado_en DESC) WHERE direccion='enviado';

DO $seg$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['lr_acrm_embudo','lr_acrm_mensajes'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY equipo_lectura ON public.%I FOR SELECT TO authenticated USING ((SELECT public.lr_pros_usuario_habilitado()))',t);
  EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
 END LOOP;
END $seg$;

-- ── La etapa la mueven los mensajes ────────────────────────────────────────
CREATE FUNCTION private.lr_acrm_mensaje_mueve() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actual text; destino text;
BEGIN
 INSERT INTO public.lr_acrm_embudo(captura) VALUES(NEW.captura) ON CONFLICT(captura) DO NOTHING;
 SELECT etapa INTO actual FROM public.lr_acrm_embudo WHERE captura=NEW.captura FOR UPDATE;
 destino:=CASE
  WHEN NEW.direccion='enviado' AND actual='nuevo' THEN 'contactado'
  WHEN NEW.direccion='recibido' AND actual='contactado' THEN 'respondio'
  ELSE NULL END;
 IF destino IS NOT NULL THEN
  UPDATE public.lr_acrm_embudo SET etapa=destino,
   contactado_en=CASE WHEN destino='contactado' THEN NEW.enviado_en ELSE contactado_en END,
   respondio_en=CASE WHEN destino='respondio' THEN NEW.enviado_en ELSE respondio_en END,
   version=version+1,actualizado_en=now(),actualizado_por=coalesce(NEW.autor,actualizado_por)
  WHERE captura=NEW.captura;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_mensaje_mueve() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lr_acrm_mensaje_mueve_embudo AFTER INSERT ON public.lr_acrm_mensajes
 FOR EACH ROW EXECUTE FUNCTION private.lr_acrm_mensaje_mueve();

-- Cada prospecto nuevo entra al embudo en «nuevo», venga de donde venga.
CREATE FUNCTION private.lr_acrm_captura_al_embudo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 INSERT INTO public.lr_acrm_embudo(captura) VALUES(NEW.clave) ON CONFLICT(captura) DO NOTHING;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_captura_al_embudo() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lr_acrm_captura_entra_al_embudo AFTER INSERT ON public.lr_acrm_capturas
 FOR EACH ROW EXECUTE FUNCTION private.lr_acrm_captura_al_embudo();

-- Registrar el envío desde la reserva del perfil de LinkedIn ya es un contacto: el módulo lo marca
-- ahí y el embudo tiene que enterarse sin que nadie lo escriba dos veces.
CREATE FUNCTION private.lr_acrm_contacto_al_embudo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.estado='contactado' THEN
  INSERT INTO public.lr_acrm_embudo(captura,etapa,contactado_en,actualizado_por)
  VALUES('li:'||NEW.linkedin_url,'contactado',NEW.contactado_en,NEW.contactado_por)
  ON CONFLICT(captura) DO UPDATE SET
   etapa=CASE WHEN lr_acrm_embudo.etapa='nuevo' THEN 'contactado' ELSE lr_acrm_embudo.etapa END,
   contactado_en=coalesce(lr_acrm_embudo.contactado_en,NEW.contactado_en),
   version=lr_acrm_embudo.version+1,actualizado_en=now(),
   actualizado_por=coalesce(NEW.contactado_por,lr_acrm_embudo.actualizado_por);
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_contacto_al_embudo() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lr_acrm_contacto_entra_al_embudo AFTER UPDATE ON public.lr_acrm_contactos
 FOR EACH ROW EXECUTE FUNCTION private.lr_acrm_contacto_al_embudo();

-- ── Lo que ya existía entra al embudo ──────────────────────────────────────
INSERT INTO public.lr_acrm_embudo(captura) SELECT clave FROM public.lr_acrm_capturas ON CONFLICT DO NOTHING;
UPDATE public.lr_acrm_embudo e SET etapa='contactado',contactado_en=o.contactado_en,actualizado_por=o.contactado_por
FROM public.lr_acrm_contactos o WHERE e.captura='li:'||o.linkedin_url AND o.estado='contactado' AND e.etapa='nuevo';
-- La última consulta de cada lead de WhatsApp es el único mensaje que había guardado: arranca el
-- hilo con ella en vez de perderla.
INSERT INTO public.lr_acrm_mensajes(captura,direccion,texto,enviado_en,origen)
SELECT clave,'recibido',consulta,coalesce(ultimo_mensaje_en,capturado_en),'webhook'
FROM public.lr_acrm_capturas WHERE canal='meta_whatsapp' AND length(consulta)>0;

-- ── Operaciones ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.lr_acrm_operar(p_accion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); r record; c record; a public.lr_acrm_acciones%rowtype; e public.lr_acrm_embudo%rowtype;
 v_id uuid; n integer:=0; limite integer; fecha date; nueva text; cuando timestamptz;
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
 -- Un mensaje del hilo. El autor es siempre quien lo registra: nadie anota mensajes de otro.
 ELSIF p_accion='mensaje' THEN
  IF NOT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=p_datos->>'captura') THEN RAISE EXCEPTION 'Ese prospecto no existe'; END IF;
  IF coalesce(p_datos->>'direccion','') NOT IN ('enviado','recibido') THEN RAISE EXCEPTION 'La dirección es enviado o recibido'; END IF;
  cuando:=coalesce((p_datos->>'enviado_en')::timestamptz,now());
  IF cuando>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Un mensaje no puede estar fechado en el futuro'; END IF;
  INSERT INTO public.lr_acrm_mensajes(captura,direccion,texto,enviado_en,autor,origen)
  VALUES(p_datos->>'captura',p_datos->>'direccion',left(p_datos->>'texto',4000),cuando,
   CASE WHEN p_datos->>'direccion'='enviado' THEN v_uid ELSE NULL END,
   CASE WHEN coalesce(p_datos->>'origen','manual')='agente' THEN 'agente' ELSE 'manual' END)
  RETURNING id INTO v_id;
 -- Cotizado y cierre: lo que los mensajes no pueden deducir solos.
 ELSIF p_accion='etapa' THEN
  nueva:=p_datos->>'etapa';
  IF nueva NOT IN ('nuevo','contactado','respondio','cotizado','ganado','perdido') THEN RAISE EXCEPTION 'Etapa inválida'; END IF;
  SELECT * INTO e FROM public.lr_acrm_embudo WHERE captura=p_datos->>'captura' FOR UPDATE;
  IF e.captura IS NULL THEN RAISE EXCEPTION 'Ese prospecto no está en el embudo'; END IF;
  IF e.version IS DISTINCT FROM (p_datos->>'version')::int THEN RAISE EXCEPTION 'El embudo cambió. Actualiza la lista.'; END IF;
  -- Solo se avanza. Dar por perdido es un final, no un retroceso, y desde perdido se puede reabrir.
  IF private.lr_acrm_etapa_orden(nueva)<private.lr_acrm_etapa_orden(e.etapa) AND e.etapa<>'perdido' THEN
   RAISE EXCEPTION 'El embudo no retrocede: % ya está en %',e.captura,e.etapa;
  END IF;
  -- Las etapas intermedias que faltaban se dan por ocurridas ahora, salvo con «perdido»: un lead
  -- que se fue sin que nadie le escribiera no puede quedar contado como contactado del mes.
  UPDATE public.lr_acrm_embudo SET etapa=nueva,
   contactado_en=coalesce(contactado_en,CASE WHEN nueva IN ('contactado','respondio','cotizado','ganado') THEN now() END),
   respondio_en=coalesce(respondio_en,CASE WHEN nueva IN ('respondio','cotizado','ganado') THEN now() END),
   cotizado_en=CASE WHEN nueva='cotizado' THEN coalesce(cotizado_en,now()) ELSE cotizado_en END,
   cerrado_en=CASE WHEN nueva IN ('ganado','perdido') THEN coalesce(cerrado_en,now()) ELSE NULL END,
   cotizacion=coalesce(nullif(p_datos->>'cotizacion',''),cotizacion),
   monto=coalesce((p_datos->>'monto')::numeric,monto),
   nota=coalesce(left(nullif(p_datos->>'nota',''),300),nota),
   version=version+1,actualizado_en=now(),actualizado_por=v_uid
  WHERE captura=e.captura;
 ELSIF p_accion='turno_ia' THEN
  INSERT INTO public.lr_acrm_ia_limite(usuario,solicitado_en) VALUES(v_uid,now()) ON CONFLICT(usuario)
  DO UPDATE SET solicitado_en=now() WHERE lr_acrm_ia_limite.solicitado_en<now()-interval '60 seconds';
  IF NOT FOUND THEN RAISE EXCEPTION 'Espera un minuto antes de volver a priorizar'; END IF;
 ELSE RAISE EXCEPTION 'Acción inválida';
 END IF;
 RETURN jsonb_build_object('ok',true,'creadas',n,'id',v_id);
END $fn$;

-- ── El marcador ────────────────────────────────────────────────────────────
-- Dos lecturas en una: el embudo por canal —cuántos de los que se tocaron este mes llegaron a cada
-- etapa— y la tabla de quién va ganando, con su racha de días escribiendo. Todo en una sola RPC
-- para no hacer seis lecturas desde el navegador.
CREATE FUNCTION public.lr_acrm_marcador(p_mes date) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
WITH limites AS (
 SELECT date_trunc('month',p_mes)::date AS inicio,(date_trunc('month',p_mes)+interval '1 month')::date AS fin,
 (now() AT TIME ZONE 'America/Lima')::date AS hoy
), rango AS (
 SELECT (inicio::timestamp AT TIME ZONE 'America/Lima') AS desde,(fin::timestamp AT TIME ZONE 'America/Lima') AS hasta,hoy FROM limites
), vivos AS (
 SELECT e.*,x.canal FROM public.lr_acrm_embudo e JOIN public.lr_acrm_capturas x ON x.clave=e.captura
), canales AS (
 SELECT c.canal,
  count(*) FILTER(WHERE v.contactado_en>=r.desde AND v.contactado_en<r.hasta)::int AS contactados,
  count(*) FILTER(WHERE v.respondio_en>=r.desde AND v.respondio_en<r.hasta)::int AS respondieron,
  count(*) FILTER(WHERE v.cotizado_en>=r.desde AND v.cotizado_en<r.hasta)::int AS cotizados,
  count(*) FILTER(WHERE v.etapa='ganado' AND v.cerrado_en>=r.desde AND v.cerrado_en<r.hasta)::int AS ganados,
  count(*) FILTER(WHERE v.etapa='perdido' AND v.cerrado_en>=r.desde AND v.cerrado_en<r.hasta)::int AS perdidos,
  coalesce(sum(v.monto) FILTER(WHERE v.etapa='ganado' AND v.cerrado_en>=r.desde AND v.cerrado_en<r.hasta),0)::numeric AS monto_ganado,
  count(*) FILTER(WHERE v.etapa='nuevo')::int AS sin_tocar
 FROM (SELECT unnest(ARRAY['linkedin','meta_whatsapp']) AS canal) c
 CROSS JOIN rango r LEFT JOIN vivos v ON v.canal=c.canal
 GROUP BY c.canal
), dias AS (
 SELECT m.autor,(m.enviado_en AT TIME ZONE 'America/Lima')::date AS dia
 FROM public.lr_acrm_mensajes m WHERE m.direccion='enviado' AND m.autor IS NOT NULL
 GROUP BY 1,2
), tramos AS (
 SELECT autor,dia,dia-(row_number() OVER(PARTITION BY autor ORDER BY dia))::int AS grupo FROM dias
), rachas AS (
 SELECT t.autor,max(t.dia) AS fin,count(*)::int AS largo FROM tramos t GROUP BY t.autor,t.grupo
), personas AS (
 SELECT p.usuario_id,p.nombre,
  coalesce(count(m.id) FILTER(WHERE m.enviado_en>=r.desde AND m.enviado_en<r.hasta),0)::int AS mensajes,
  coalesce(count(DISTINCT m.captura) FILTER(WHERE m.enviado_en>=r.desde AND m.enviado_en<r.hasta),0)::int AS prospectos,
  coalesce((SELECT max(largo) FROM rachas ra WHERE ra.autor=p.usuario_id AND ra.fin>=r.hoy-1),0)::int AS racha,
  (SELECT max(dia) FROM dias d WHERE d.autor=p.usuario_id) AS ultimo_dia
 FROM public.lr_pros_colaboradores p CROSS JOIN rango r
 LEFT JOIN public.lr_acrm_mensajes m ON m.autor=p.usuario_id AND m.direccion='enviado'
 WHERE p.activo GROUP BY p.usuario_id,p.nombre,r.desde,r.hasta,r.hoy
), cierres AS (
 SELECT e.actualizado_por AS usuario,
  count(*) FILTER(WHERE e.etapa='cotizado' AND e.cotizado_en>=r.desde AND e.cotizado_en<r.hasta)::int AS cotizados,
  count(*) FILTER(WHERE e.etapa='ganado' AND e.cerrado_en>=r.desde AND e.cerrado_en<r.hasta)::int AS ganados
 FROM public.lr_acrm_embudo e CROSS JOIN rango r WHERE e.actualizado_por IS NOT NULL GROUP BY e.actualizado_por
)
SELECT jsonb_build_object(
 'mes',to_char(date_trunc('month',p_mes),'YYYY-MM'),
 'canales',(SELECT coalesce(jsonb_agg(to_jsonb(canales) ORDER BY canal),'[]'::jsonb) FROM canales),
 'personas',(SELECT coalesce(jsonb_agg(to_jsonb(personas)||jsonb_build_object(
   'cotizados',coalesce((SELECT cotizados FROM cierres WHERE usuario=personas.usuario_id),0),
   'ganados',coalesce((SELECT ganados FROM cierres WHERE usuario=personas.usuario_id),0))
   ORDER BY personas.mensajes DESC,personas.nombre),'[]'::jsonb) FROM personas)
);
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_marcador(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_marcador(date) TO authenticated;

-- ── El webhook de Meta también escribe en el hilo ──────────────────────────
-- Esta es la versión de 20261109090317 con una línea más. Cuidado al tocarla: la regla de
-- atribución del anuncio (el evento más antiguo manda) vive dentro del ON CONFLICT y se pierde si
-- alguien reemplaza la función copiando una versión anterior.
CREATE OR REPLACE FUNCTION public.lr_acrm_recibir_meta(p_evento jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
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
  anuncio_id=CASE WHEN EXCLUDED.capturado_en<lr_acrm_capturas.capturado_en THEN EXCLUDED.anuncio_id WHEN EXCLUDED.capturado_en=lr_acrm_capturas.capturado_en THEN coalesce(lr_acrm_capturas.anuncio_id,EXCLUDED.anuncio_id) ELSE lr_acrm_capturas.anuncio_id END,
  consulta=CASE WHEN EXCLUDED.ultimo_mensaje_en>=lr_acrm_capturas.ultimo_mensaje_en THEN EXCLUDED.consulta ELSE lr_acrm_capturas.consulta END,
  ultimo_mensaje_en=greatest(lr_acrm_capturas.ultimo_mensaje_en,EXCLUDED.ultimo_mensaje_en);
 -- El hilo guarda todos: la columna consulta solo recuerda el último, y para el embudo hace falta
 -- saber que volvió a escribir.
 INSERT INTO public.lr_acrm_mensajes(captura,direccion,texto,enviado_en,origen)
 VALUES(k,'recibido',left(coalesce(p_evento->>'consulta','Mensaje adjunto'),4000),v_time,'webhook');
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
