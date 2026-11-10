-- El ACRM absorbe Cotizaciones, y la contactabilidad pasa a la cola de acciones.
--
-- Hasta ahora las cotizaciones vivían en un bloque JSON (lr_suite_private_data, clave 'quotes')
-- editado desde el navegador, en un módulo aparte. Eso dejaba el embudo cojo: terminaba en
-- «cotizado» y el seguimiento posterior —los ocho toques -de contactabilidad— vivía en otra
-- pantalla, como puntitos que nadie veía si no abría ese módulo.
--
-- Aquí la cotización pasa a ser una fila al lado del prospecto, y cada toque pendiente se
-- convierte en una acción de la misma cola que todo lo demás: la que el agente prioriza y la que
-- se mira cada mañana.
--
-- Las 22 cotizaciones que ya existen se migran con su prospecto: ninguna nació en el ACRM, así
-- que cada una estrena una captura de canal 'directo' y entra al embudo ya en «cotizado».
BEGIN;

-- ── Un canal más ───────────────────────────────────────────────────────────
-- 'directo': el cliente que llegó por referido, por teléfono o de antes del ACRM. No tiene meta
-- de captura —no se sale a buscarlo— pero sí entra al embudo y al marcador.
ALTER TABLE public.lr_acrm_capturas DROP CONSTRAINT lr_acrm_capturas_canal_check;
ALTER TABLE public.lr_acrm_capturas ADD CONSTRAINT lr_acrm_capturas_canal_check
  CHECK(canal IN ('linkedin','meta_whatsapp','directo'));

-- Un tipo de acción más: el toque de seguimiento de una cotización enviada.
ALTER TABLE public.lr_acrm_acciones DROP CONSTRAINT lr_acrm_acciones_tipo_check;
ALTER TABLE public.lr_acrm_acciones ADD CONSTRAINT lr_acrm_acciones_tipo_check
  CHECK(tipo IN ('primer_contacto','respuesta','seguimiento','cotizacion'));

-- ── La cadencia ────────────────────────────────────────────────────────────
-- Los mismos días que usaba el módulo de Cotizaciones: tres toques la primera semana, uno por
-- semana durante tres, y uno cada quince días el segundo mes. Vive en un solo sitio para que el
-- navegador y la base no puedan discrepar.
CREATE FUNCTION public.lr_acrm_cadencia() RETURNS integer[] LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT ARRAY[1,3,5,12,19,26,41,56];
$fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_cadencia() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lr_acrm_cadencia() TO authenticated;

CREATE TABLE public.lr_acrm_cotizaciones (
 -- El id que ya traen las cotizaciones del bloque JSON: así los enlaces viejos siguen valiendo.
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 120),
 captura text NOT NULL REFERENCES public.lr_acrm_capturas(clave) ON DELETE CASCADE,
 cliente text NOT NULL DEFAULT '' CHECK(length(cliente)<=300),
 contacto text NOT NULL DEFAULT '' CHECK(length(contacto)<=300),
 telefono text NOT NULL DEFAULT '' CHECK(length(telefono)<=60),
 email text NOT NULL DEFAULT '' CHECK(length(email)<=200),
 servicio text NOT NULL DEFAULT '' CHECK(length(servicio)<=300),
 origen text NOT NULL DEFAULT '' CHECK(length(origen)<=60),
 monto numeric(12,2) NOT NULL DEFAULT 0 CHECK(monto>=0 AND monto<100000000),
 facturado numeric(12,2) NOT NULL DEFAULT 0 CHECK(facturado>=0 AND facturado<100000000),
 gastos numeric(12,2) NOT NULL DEFAULT 0 CHECK(gastos>=0 AND gastos<100000000),
 estado text NOT NULL DEFAULT 'enviada' CHECK(estado IN ('enviada','revision','aprobada','perdida')),
 enviada date,
 -- Cuántos de los ocho toques se hicieron. El siguiente sale de enviada + cadencia[hechos+1].
 contactos_hechos integer NOT NULL DEFAULT 0 CHECK(contactos_hechos BETWEEN 0 AND 8),
 archivo_url text CHECK(archivo_url IS NULL OR length(archivo_url)<=1000),
 archivo_tipo text CHECK(archivo_tipo IS NULL OR archivo_tipo IN ('link','file')),
 desglose jsonb NOT NULL DEFAULT '[]'::jsonb,
 version integer NOT NULL DEFAULT 1,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_por uuid REFERENCES public.lr_pros_colaboradores(usuario_id)
);
CREATE INDEX lr_acrm_cotizaciones_captura ON public.lr_acrm_cotizaciones(captura);
CREATE INDEX lr_acrm_cotizaciones_enviada ON public.lr_acrm_cotizaciones(enviada DESC);

DO $seg$
BEGIN
 EXECUTE 'ALTER TABLE public.lr_acrm_cotizaciones ENABLE ROW LEVEL SECURITY';
 EXECUTE 'REVOKE ALL ON public.lr_acrm_cotizaciones FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT ALL ON public.lr_acrm_cotizaciones TO service_role';
 EXECUTE 'GRANT SELECT ON public.lr_acrm_cotizaciones TO authenticated';
 EXECUTE 'CREATE POLICY equipo_lectura ON public.lr_acrm_cotizaciones FOR SELECT TO authenticated USING ((SELECT public.lr_pros_usuario_habilitado()))';
 EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.lr_acrm_cotizaciones';
END $seg$;

-- ── La contactabilidad se vuelve cola ──────────────────────────────────────
-- Una acción pendiente por cotización viva, la del toque que toca. No las ocho de golpe: ocho por
-- veintidós cotizaciones serían ciento setenta y seis filas que nadie puede mirar.
CREATE FUNCTION private.lr_acrm_cotizaciones_al_dia() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c record; v_owner uuid; v_vence timestamptz; v_texto text; n integer:=0;
BEGIN
 -- Lo cerrado y lo terminado no tiene siguiente toque: su acción pendiente se retira.
 DELETE FROM public.lr_acrm_acciones a
 USING public.lr_acrm_cotizaciones q
 WHERE a.tipo='cotizacion' AND a.estado='pendiente' AND a.captura=q.captura
   AND (q.estado IN ('aprobada','perdida') OR q.contactos_hechos>=8 OR q.enviada IS NULL);

 FOR c IN
  SELECT q.*, (q.enviada + ((public.lr_acrm_cadencia())[q.contactos_hechos+1] || ' days')::interval) AS toca
  FROM public.lr_acrm_cotizaciones q
  WHERE q.estado NOT IN ('aprobada','perdida') AND q.contactos_hechos<8 AND q.enviada IS NOT NULL
    -- Si ya pasó el último día de la cadencia, la ventana de seguimiento se cerró y no hay nada
    -- que programar. Sin esto, las cotizaciones de hace meses llenarían la cola de compromisos
    -- vencidos que nadie va a atender: ruido que tapa lo que sí toca hoy.
    AND q.enviada + (((public.lr_acrm_cadencia())[8]) || ' days')::interval
        >= (now() AT TIME ZONE 'America/Lima')::date
 LOOP
  v_vence := c.toca;
  v_texto := 'Contacto ' || (c.contactos_hechos+1) || ' de 8 por la cotización de ' || coalesce(nullif(c.cliente,''),'un cliente');
  -- Ya existe la del toque correcto: no se toca, para no perder su prioridad de IA.
  IF EXISTS(SELECT 1 FROM public.lr_acrm_acciones a
            WHERE a.captura=c.captura AND a.tipo='cotizacion' AND a.estado='pendiente' AND a.vence_en=v_vence) THEN
   CONTINUE;
  END IF;
  DELETE FROM public.lr_acrm_acciones a
  WHERE a.captura=c.captura AND a.tipo='cotizacion' AND a.estado='pendiente';
  -- Sigue quien ya venía atendiendo a ese prospecto; si no hay nadie, el menos cargado.
  SELECT responsable INTO v_owner FROM public.lr_acrm_acciones
  WHERE captura=c.captura ORDER BY creado_en DESC LIMIT 1;
  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.lr_pros_colaboradores WHERE usuario_id=v_owner AND activo) THEN
   SELECT m.usuario_id INTO v_owner FROM public.lr_pros_colaboradores m
   LEFT JOIN public.lr_acrm_acciones a ON a.responsable=m.usuario_id AND a.estado='pendiente'
   WHERE m.activo GROUP BY m.usuario_id,m.nombre ORDER BY count(a.id),m.nombre LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN CONTINUE; END IF;
  INSERT INTO public.lr_acrm_acciones(captura,responsable,accion,vence_en,tipo)
  VALUES(c.captura,v_owner,left(v_texto,240),v_vence,'cotizacion');
  n:=n+1;
 END LOOP;
 RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_cotizaciones_al_dia() FROM PUBLIC,anon,authenticated;

-- ── Operaciones ────────────────────────────────────────────────────────────
-- Dos ramas nuevas en la RPC que ya usan los botones del módulo, para que escribir una cotización
-- pase por el mismo sitio que todo lo demás.
CREATE OR REPLACE FUNCTION private.lr_acrm_operar(p_accion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid(); r record; c record; a public.lr_acrm_acciones%rowtype; e public.lr_acrm_embudo%rowtype;
 q public.lr_acrm_cotizaciones%rowtype; v_id uuid; n integer:=0; limite integer; fecha date; nueva text; cuando timestamptz; v_clave text;
BEGIN
 IF v_uid IS NULL OR NOT public.lr_pros_usuario_habilitado() THEN RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE='42501'; END IF;
 IF p_accion='meta' THEN
  fecha:=(p_datos->>'mes')::date;
  INSERT INTO public.lr_acrm_metas(mes,canal,objetivo) VALUES(fecha,p_datos->>'canal',(p_datos->>'objetivo')::int)
  ON CONFLICT(mes,canal) DO UPDATE SET objetivo=EXCLUDED.objetivo;
 ELSIF p_accion='preparar' THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(982431);
  -- Primero los toques de cotización que tocan: son compromisos con alguien que ya pidió precio.
  n:=private.lr_acrm_cotizaciones_al_dia();
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
   -- Completar un toque de cotización es marcar ese contacto como hecho: lo demás se recalcula.
   IF a.tipo='cotizacion' THEN
    UPDATE public.lr_acrm_cotizaciones SET contactos_hechos=least(8,contactos_hechos+1),
     version=version+1,actualizado_en=now(),actualizado_por=v_uid
    WHERE captura=a.captura AND estado NOT IN ('aprobada','perdida');
   END IF;
   UPDATE public.lr_acrm_acciones SET estado='hecha',completado_en=now(),completado_por=v_uid,version=version+1 WHERE id=a.id;
   IF a.tipo='cotizacion' THEN PERFORM private.lr_acrm_cotizaciones_al_dia(); END IF;
  ELSE
   UPDATE public.lr_acrm_acciones SET accion=p_datos->>'accion',vence_en=(p_datos->>'vence_en')::timestamptz,
    version=version+1,prioridad_ia=NULL,motivo_ia=NULL,ia_en=NULL WHERE id=a.id;
  END IF;
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
 -- Guardar una cotización. Si no trae captura, estrena una de canal 'directo'.
 ELSIF p_accion='cotizacion' THEN
  IF coalesce(p_datos->>'id','')='' THEN RAISE EXCEPTION 'La cotización necesita un id'; END IF;
  v_clave:=nullif(p_datos->>'captura','');
  IF v_clave IS NULL THEN
   v_clave:='co:'||(p_datos->>'id');
   INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en)
   VALUES(v_clave,'directo',left(coalesce(nullif(p_datos->>'cliente',''),'Cliente sin nombre'),300),
    coalesce((p_datos->>'enviada')::timestamptz,now()))
   ON CONFLICT(clave) DO NOTHING;
  ELSIF NOT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=v_clave) THEN
   RAISE EXCEPTION 'Ese prospecto no existe';
  END IF;
  INSERT INTO public.lr_acrm_cotizaciones(id,captura,cliente,contacto,telefono,email,servicio,origen,
   monto,facturado,gastos,estado,enviada,archivo_url,archivo_tipo,desglose,actualizado_por)
  VALUES(p_datos->>'id',v_clave,
   left(coalesce(p_datos->>'cliente',''),300),left(coalesce(p_datos->>'contacto',''),300),
   left(coalesce(p_datos->>'telefono',''),60),left(coalesce(p_datos->>'email',''),200),
   left(coalesce(p_datos->>'servicio',''),300),left(coalesce(p_datos->>'origen',''),60),
   coalesce((p_datos->>'monto')::numeric,0),coalesce((p_datos->>'facturado')::numeric,0),
   coalesce((p_datos->>'gastos')::numeric,0),coalesce(nullif(p_datos->>'estado',''),'enviada'),
   (p_datos->>'enviada')::date,nullif(p_datos->>'archivo_url',''),nullif(p_datos->>'archivo_tipo',''),
   coalesce(p_datos->'desglose','[]'::jsonb),v_uid)
  ON CONFLICT(id) DO UPDATE SET
   cliente=EXCLUDED.cliente,contacto=EXCLUDED.contacto,telefono=EXCLUDED.telefono,email=EXCLUDED.email,
   servicio=EXCLUDED.servicio,origen=EXCLUDED.origen,monto=EXCLUDED.monto,facturado=EXCLUDED.facturado,
   gastos=EXCLUDED.gastos,estado=EXCLUDED.estado,enviada=EXCLUDED.enviada,
   archivo_url=EXCLUDED.archivo_url,archivo_tipo=EXCLUDED.archivo_tipo,desglose=EXCLUDED.desglose,
   version=lr_acrm_cotizaciones.version+1,actualizado_en=now(),actualizado_por=v_uid;
  -- El embudo sigue a la cotización: enviada es «cotizado», aprobada es «ganado».
  SELECT * INTO q FROM public.lr_acrm_cotizaciones WHERE id=p_datos->>'id';
  INSERT INTO public.lr_acrm_embudo(captura,etapa,cotizado_en,cotizacion,monto,actualizado_por)
  VALUES(v_clave,CASE WHEN q.estado='aprobada' THEN 'ganado' WHEN q.estado='perdida' THEN 'perdido' ELSE 'cotizado' END,
   coalesce(q.enviada::timestamptz,now()),q.id,q.monto,v_uid)
  ON CONFLICT(captura) DO UPDATE SET
   etapa=CASE WHEN q.estado='aprobada' THEN 'ganado' WHEN q.estado='perdida' THEN 'perdido'
              WHEN private.lr_acrm_etapa_orden(lr_acrm_embudo.etapa)<3 THEN 'cotizado' ELSE lr_acrm_embudo.etapa END,
   cotizado_en=coalesce(lr_acrm_embudo.cotizado_en,q.enviada::timestamptz,now()),
   cerrado_en=CASE WHEN q.estado IN ('aprobada','perdida') THEN coalesce(lr_acrm_embudo.cerrado_en,now()) ELSE NULL END,
   cotizacion=q.id,monto=q.monto,version=lr_acrm_embudo.version+1,actualizado_en=now(),actualizado_por=v_uid;
  PERFORM private.lr_acrm_cotizaciones_al_dia();
 -- Marcar o desmarcar toques a mano, como hacían los puntos del módulo viejo.
 ELSIF p_accion='cotizacion_toque' THEN
  UPDATE public.lr_acrm_cotizaciones SET contactos_hechos=greatest(0,least(8,(p_datos->>'hechos')::int)),
   version=version+1,actualizado_en=now(),actualizado_por=v_uid
  WHERE id=p_datos->>'id';
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa cotización no existe'; END IF;
  PERFORM private.lr_acrm_cotizaciones_al_dia();
 ELSIF p_accion='etapa' THEN
  nueva:=p_datos->>'etapa';
  IF nueva NOT IN ('nuevo','contactado','respondio','cotizado','ganado','perdido') THEN RAISE EXCEPTION 'Etapa inválida'; END IF;
  SELECT * INTO e FROM public.lr_acrm_embudo WHERE captura=p_datos->>'captura' FOR UPDATE;
  IF e.captura IS NULL THEN RAISE EXCEPTION 'Ese prospecto no está en el embudo'; END IF;
  IF e.version IS DISTINCT FROM (p_datos->>'version')::int THEN RAISE EXCEPTION 'El embudo cambió. Actualiza la lista.'; END IF;
  IF private.lr_acrm_etapa_orden(nueva)<private.lr_acrm_etapa_orden(e.etapa) AND e.etapa<>'perdido' THEN
   RAISE EXCEPTION 'El embudo no retrocede: % ya está en %',e.captura,e.etapa;
  END IF;
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

-- ── El marcador cuenta también el canal directo ────────────────────────────
CREATE OR REPLACE FUNCTION public.lr_acrm_marcador(p_mes date) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
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
  coalesce(sum(v.monto) FILTER(WHERE v.cotizado_en>=r.desde AND v.cotizado_en<r.hasta),0)::numeric AS monto_cotizado,
  count(*) FILTER(WHERE v.etapa='nuevo')::int AS sin_tocar
 FROM (SELECT unnest(ARRAY['linkedin','meta_whatsapp','directo']) AS canal) c
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

-- ── Las 22 que ya existen ──────────────────────────────────────────────────
-- Cada una estrena su captura de canal 'directo' y entra al embudo en la etapa que le toque.
DO $migra$
DECLARE q jsonb; v_clave text; v_estado text; v_enviada date; v_hechos integer;
BEGIN
 FOR q IN SELECT jsonb_array_elements(payload) FROM public.lr_suite_private_data WHERE key='quotes' LOOP
  IF coalesce(q->>'id','')='' THEN CONTINUE; END IF;
  v_clave:='co:'||(q->>'id');
  v_enviada:=nullif(left(coalesce(q->>'fechaEnvio',''),10),'')::date;
  v_estado:=CASE
   WHEN lower(coalesce(q->>'estado','')) ~ 'aprob|ganad|cerrad|acept' THEN 'aprobada'
   WHEN lower(coalesce(q->>'estado','')) ~ 'revis|negocia|evalua' THEN 'revision'
   WHEN lower(coalesce(q->>'estado','')) ~ 'perdid|anulad|cancelad' THEN 'perdida'
   ELSE 'enviada' END;
  v_hechos:=least(8,greatest(0,coalesce((q->>'contactosRealizados')::int,
   coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(q->'contactos')='array' THEN q->'contactos' ELSE '[]'::jsonb END),0))));
  INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en)
  VALUES(v_clave,'directo',left(coalesce(nullif(q->>'cliente',''),'Cliente sin nombre'),300),
   coalesce(v_enviada::timestamptz,now()))
  ON CONFLICT(clave) DO NOTHING;
  INSERT INTO public.lr_acrm_cotizaciones(id,captura,cliente,contacto,telefono,email,servicio,origen,
   monto,facturado,gastos,estado,enviada,contactos_hechos,archivo_url,archivo_tipo,desglose)
  VALUES(q->>'id',v_clave,left(coalesce(q->>'cliente',''),300),left(coalesce(q->>'contacto',''),300),
   left(coalesce(q->>'telefono',''),60),left(coalesce(q->>'emailContacto',''),200),
   left(coalesce(q->>'servicio',''),300),left(coalesce(q->>'origen',''),60),
   coalesce((q->>'montoCotizado')::numeric,0),coalesce((q->>'montoFacturado')::numeric,0),
   coalesce((q->>'gastos')::numeric,0),v_estado,v_enviada,v_hechos,
   nullif(q->>'archivoUrl',''),nullif(q->>'archivoTipo',''),
   CASE WHEN jsonb_typeof(q->'desglose')='array' THEN q->'desglose' ELSE '[]'::jsonb END)
  ON CONFLICT(id) DO NOTHING;
  -- La captura recién creada ya trae su fila de embudo en «nuevo», puesta por el trigger: hay que
  -- actualizarla, no insertarla. Con DO NOTHING las 22 se quedaban sin etapa.
  INSERT INTO public.lr_acrm_embudo(captura,etapa,cotizado_en,cerrado_en,cotizacion,monto)
  VALUES(v_clave,CASE WHEN v_estado='aprobada' THEN 'ganado' WHEN v_estado='perdida' THEN 'perdido' ELSE 'cotizado' END,
   coalesce(v_enviada::timestamptz,now()),
   CASE WHEN v_estado IN ('aprobada','perdida') THEN coalesce(v_enviada::timestamptz,now()) END,
   q->>'id',coalesce((q->>'montoCotizado')::numeric,0))
  ON CONFLICT(captura) DO UPDATE SET
   etapa=EXCLUDED.etapa,cotizado_en=coalesce(lr_acrm_embudo.cotizado_en,EXCLUDED.cotizado_en),
   cerrado_en=EXCLUDED.cerrado_en,cotizacion=EXCLUDED.cotizacion,monto=EXCLUDED.monto,
   version=lr_acrm_embudo.version+1,actualizado_en=now();
 END LOOP;
END $migra$;

NOTIFY pgrst,'reload schema';
COMMIT;
