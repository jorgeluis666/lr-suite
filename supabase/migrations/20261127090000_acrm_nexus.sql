-- Los leads que deja Nexus: el tablero de demostración y la auditoría de Google Ads.
--
-- Nexus tiene dos puertas abiertas al público y las dos piden nombre y correo: el alta del tablero
-- de demostración (`/demo`) y el auditor de Google Ads (`/audit/google`, que desde el 25 de
-- noviembre pregunta antes de conectar nada). Hasta hoy esos leads se quedaban en su propia
-- pantalla, `/leads` de Nexus, mientras todo el comercial de la agencia vive en el ACRM: quien
-- atiende leads tenía que mirar dos sitios y ninguno de los dos contaba la historia entera.
--
-- Esta migración abre los canales 'nexus_demo' y 'nexus_auditoria' —el quinto y el sexto— y una
-- función con clave por la que Nexus da de alta la captura, igual que ya escribe el gasto del mes
-- con `lr_suite_gasto_set_informe()`:
--
--   Nexus (/demo, alta abierta)        ─┐
--                                       ├─→ lr_acrm_captura_externa() → lr_acrm_capturas → embudo
--   Nexus (/audit/google, auditoría)   ─┘
--
-- El lead entra en «Sin tocar», como cualquier otro capturado, y de ahí lo mueve su ficha. Nexus
-- sigue guardando los suyos en su base: esto no los mueve de sitio, los trae además.
--
-- Decisiones que conviene no deshacer:
--
-- * **La clave es el correo**, `nx:<correo>`, porque es lo único que Nexus sabe de esa persona. Si
--   ese mismo correo ya está en el ACRM por otro canal —la hoja lo trae desde 20261126120000—, la
--   captura **no se duplica**: se usa la que ya existe y conserva su canal, que es su origen de
--   verdad. Lo que no se puede evitar es el duplicado de quien está por LinkedIn sin correo
--   conocido: esos dos los une una persona, a mano, y es el precio de no tener identidad común.
-- * **El canal de una captura que ya existía no cambia nunca.** Al revés que la hoja, que sí mueve
--   un lead de LinkedIn a Ads Library: aquí el demo y el auditor no explican por qué alguien está
--   en la lista, solo añaden una visita más.
-- * **Lo que ya escribió alguien no se pisa.** Solo se rellenan huecos, salvo `consulta`, donde la
--   segunda visita se añade en otra línea: que alguien haya visto el demo y además pedido la
--   auditoría es justo lo que hay que leer en su ficha.
-- * **La clave de ingesta es la puerta, no el rol.** La función la ejecuta `anon` —Nexus llama con
--   la clave publicable, como en el gasto— y lo que decide es `p_clave`. Sin ella, nada.
--
-- Se ejecuta entera en el SQL Editor de Supabase. Es idempotente, y al final muestra la clave que
-- hay que cargar en `config/local.php` de Nexus.
BEGIN;

-- ── 0. Requisitos ──────────────────────────────────────────────────────────
DO $requisitos$
BEGIN
 IF to_regclass('public.lr_acrm_capturas') IS NULL THEN
  RAISE EXCEPTION 'Falta el ACRM (public.lr_acrm_capturas). Esta migración va después de 20261109084815.';
 END IF;
 IF to_regclass('public.lr_suite_notificaciones_claves') IS NULL THEN
  RAISE EXCEPTION 'Falta public.lr_suite_notificaciones_claves. Ejecuta antes src/modules/alertas-gasto/BBDD/alertas-gasto-correo.sql';
 END IF;
END $requisitos$;

-- ── 1. Los canales quinto y sexto ──────────────────────────────────────────
-- El orden del CHECK es el de antigüedad, no el de importancia.
ALTER TABLE public.lr_acrm_capturas DROP CONSTRAINT IF EXISTS lr_acrm_capturas_canal_check;
ALTER TABLE public.lr_acrm_capturas ADD CONSTRAINT lr_acrm_capturas_canal_check
 CHECK (canal IN ('linkedin','meta_whatsapp','directo','ads_library','nexus_demo','nexus_auditoria'));

-- ── 2. La clave con la que entra Nexus ─────────────────────────────────────
-- Misma tabla y mismo patrón que la ingesta del gasto: se genera una sola vez, no se lee por la
-- API y repetir este script no la cambia.
INSERT INTO public.lr_suite_notificaciones_claves (id, clave)
VALUES ('acrm-ingesta',
 replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
ON CONFLICT (id) DO NOTHING;

-- ── 3. El alta, sin sesión ─────────────────────────────────────────────────
-- Hermana de private.lr_acrm_prospecto_guardar (la de la hoja), más corta porque aquí no hay
-- perfiles de LinkedIn ni dominios que adivinar: hay un correo, y con él basta.
CREATE OR REPLACE FUNCTION private.lr_acrm_nexus_captura(p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_canal text; v_correo text; v_nombre text; v_empresa text; v_consulta text;
 v_web text; v_clave text; v_existe boolean;
BEGIN
 v_canal:=CASE lower(btrim(coalesce(p_datos->>'origen','')))
  WHEN 'demo' THEN 'nexus_demo' WHEN 'auditoria' THEN 'nexus_auditoria' ELSE '' END;
 IF v_canal='' THEN
  RAISE EXCEPTION 'El origen tiene que ser demo o auditoria: %',coalesce(p_datos->>'origen','');
 END IF;
 v_correo:=left(lower(btrim(coalesce(p_datos->>'correo',''))),200);
 IF v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
  RAISE EXCEPTION 'El lead tiene que traer un correo: %',v_correo;
 END IF;
 -- El nombre llega de un formulario de otra aplicación: se le quitan los espacios de más, que
 -- en la tabla maestra se ven como un error de la agencia y no de quien lo escribió.
 v_nombre:=left(btrim(regexp_replace(coalesce(p_datos->>'nombre',''),'\s+',' ','g')),300);
 v_empresa:=left(btrim(coalesce(p_datos->>'empresa','')),200);
 v_consulta:=left(btrim(coalesce(p_datos->>'consulta','')),2000);
 v_web:=regexp_replace(btrim(coalesce(p_datos->>'web','')),'/+$','');
 IF v_web<>'' AND v_web !~* '^https?://' THEN v_web:='https://'||v_web; END IF;
 v_web:=left(v_web,300);

 -- Si ese correo ya está en el ACRM, el lead es ese: no se crea otro. La más antigua manda, para
 -- que dos llamadas seguidas no elijan filas distintas.
 SELECT x.clave INTO v_clave FROM public.lr_acrm_capturas x
  WHERE x.correo=v_correo ORDER BY x.capturado_en, x.clave LIMIT 1;
 IF v_clave IS NULL THEN v_clave:='nx:'||v_correo; END IF;
 SELECT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=v_clave) INTO v_existe;

 INSERT INTO public.lr_acrm_capturas(clave,canal,nombre,capturado_en,consulta,empresa,web,correo)
 VALUES(v_clave,v_canal,coalesce(nullif(v_nombre,''),v_correo),now(),v_consulta,v_empresa,v_web,v_correo)
 ON CONFLICT(clave) DO UPDATE SET
  -- Su origen es el de verdad: ni el canal ni la fecha de captura se tocan.
  nombre=CASE WHEN v_nombre<>'' AND lr_acrm_capturas.nombre IN ('',v_correo)
              THEN v_nombre ELSE lr_acrm_capturas.nombre END,
  -- La segunda visita se añade en otra línea; la misma, no se repite.
  consulta=CASE
   WHEN v_consulta='' THEN lr_acrm_capturas.consulta
   WHEN lr_acrm_capturas.consulta='' THEN v_consulta
   WHEN position(v_consulta IN lr_acrm_capturas.consulta)>0 THEN lr_acrm_capturas.consulta
   ELSE left(lr_acrm_capturas.consulta||E'\n'||v_consulta,2000) END,
  empresa=CASE WHEN lr_acrm_capturas.empresa='' THEN excluded.empresa ELSE lr_acrm_capturas.empresa END,
  web=CASE WHEN lr_acrm_capturas.web='' THEN excluded.web ELSE lr_acrm_capturas.web END,
  correo=CASE WHEN lr_acrm_capturas.correo='' THEN excluded.correo ELSE lr_acrm_capturas.correo END;

 RETURN jsonb_build_object('ok',true,'clave',v_clave,'canal',
  (SELECT canal FROM public.lr_acrm_capturas WHERE clave=v_clave),'nuevo',NOT v_existe);
END $fn$;
REVOKE ALL ON FUNCTION private.lr_acrm_nexus_captura(jsonb) FROM PUBLIC,anon,authenticated;

-- ── 4. La puerta por la que llama Nexus ────────────────────────────────────
-- La clave se comprueba antes que nada. El resto de la validación la hace la función de arriba, y
-- un lead mal formado corta la llamada: Nexus lo registra y lo reintenta en la siguiente alta.
CREATE OR REPLACE FUNCTION public.lr_acrm_captura_externa(p_clave text, p_datos jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF p_clave IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.lr_suite_notificaciones_claves
  WHERE id='acrm-ingesta' AND clave=p_clave
 ) THEN
  RAISE EXCEPTION 'clave no valida' USING ERRCODE='42501';
 END IF;
 RETURN private.lr_acrm_nexus_captura(p_datos);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_acrm_captura_externa(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lr_acrm_captura_externa(text,jsonb) TO anon, authenticated;

-- ── 5. El marcador cuenta los dos canales nuevos ───────────────────────────
-- Misma función de 20261119093000 con los dos canales añadidos a su lista: sin esto, un lead del
-- demo o del auditor que alguien contacte este mes no aparecería en ninguna fila del marcador.
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
 FROM (SELECT unnest(ARRAY['linkedin','meta_whatsapp','directo','ads_library','nexus_demo','nexus_auditoria']) AS canal) c
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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── 6. La clave para Nexus ─────────────────────────────────────────────────
-- Va al bloque `lr_suite` de `config/local.php` de Nexus, como `acrm_key`. No la dejes en el
-- historial de un SQL Editor compartido más tiempo del necesario.
SELECT clave AS clave_para_nexus
FROM public.lr_suite_notificaciones_claves
WHERE id = 'acrm-ingesta';

-- Una prueba de extremo a extremo con la clave de arriba, y cómo dejarlo como estaba:
--
-- select public.lr_acrm_captura_externa('<CLAVE>', '{"origen":"auditoria",
--   "nombre":"Prueba Nexus","correo":"prueba-nexus@example.test",
--   "empresa":"Cuenta de prueba","consulta":"Pidió la auditoría de Google Ads."}'::jsonb);
--
-- select clave, canal, nombre, correo, consulta from public.lr_acrm_capturas where clave like 'nx:%';
-- delete from public.lr_acrm_capturas where clave = 'nx:prueba-nexus@example.test';
