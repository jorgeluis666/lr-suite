-- El catálogo de agentes IA y lo que cada uno lee para trabajar.
--
-- Hasta ahora «Agentes IA» era solo el recibo: cuánto costó cada agente. No decía cuáles existen
-- —un agente que nunca se usó no aparecía—, ni dejaba tocar nada. Y lo que cada agente sabe vivía
-- entero dentro de su Edge Function: para añadirle un documento, una URL de referencia o una regla
-- nueva había que editar TypeScript y volver a desplegar.
--
-- Aquí viven las dos cosas que faltaban:
--   · lr_suite_agente          — la ficha de cada agente: quién es, dónde vive, qué función corre.
--   · lr_suite_agente_recurso  — lo que se le carga: prompts, documentos y enlaces.
--
-- Los recursos NO reemplazan el prompt de sistema que está en el código: se añaden al final, en un
-- bloque aparte, y la Edge Function los lee con la service_role key en cada llamada
-- (supabase/functions/_shared/recursos.ts). Así una instrucción nueva entra escribiéndola en el
-- tablero, sin desplegar; y lo que no se puede romper desde el navegador —las herramientas, los
-- límites, el formato de la respuesta— sigue siendo código.
--
-- Permisos, como en lr_suite_agente_uso: el navegador no toca las tablas. Ni SELECT. Todo pasa por
-- las funciones de abajo, que devuelven lo justo. El plan de Supabase es el gratuito y el egress se
-- paga mirando, así que la lista general no baja el texto de los prompts: eso solo se trae al abrir
-- la ficha de un agente.
--
-- CÓMO APLICARLA: Supabase → SQL Editor → pegar entero → Run. Si sale el aviso de RLS, es falso
-- (lo dispara el bloque DO, no la tabla).
BEGIN;

-- ── El catálogo ────────────────────────────────────────────────────────────
-- La clave es la misma que escribe la Edge Function en lr_suite_agente_uso: así el recibo y la
-- ficha hablan del mismo agente sin tabla intermedia.
CREATE TABLE IF NOT EXISTS public.lr_suite_agente (
  clave text PRIMARY KEY CHECK (clave ~ '^[a-z][a-z0-9_-]{1,39}$'),
  nombre text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  -- Una línea: qué hace. Es lo que se lee en la tarjeta del tablero.
  rol text CHECK (rol IS NULL OR length(rol) <= 400),
  -- Desde dónde se le habla: «Módulo Pendientes», «WhatsApp», «Se dispara solo».
  donde text CHECK (donde IS NULL OR length(donde) <= 120),
  -- La Edge Function que lo corre. Sirve para saber qué desplegar cuando algo falla.
  funcion text CHECK (funcion IS NULL OR length(funcion) <= 80),
  -- El modelo que declara su código. El que corrió de verdad sale del registro de uso, y cuando
  -- los dos no coinciden es que alguien cambió un secreto: el tablero lo marca.
  modelo text CHECK (modelo IS NULL OR length(modelo) <= 80),
  -- Apagar un agente aquí no lo desconecta: es una etiqueta para los que ya no se usan, para que
  -- el tablero no los mezcle con los vivos. Lo que desconecta de verdad es el secreto o el código.
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 100,
  notas text CHECK (notas IS NULL OR length(notas) <= 4000),
  creado_at timestamptz NOT NULL DEFAULT now(),
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  actualizado_por text
);

-- ── Lo que se le carga ─────────────────────────────────────────────────────
-- Tres tipos, y cada uno llega al modelo de una forma distinta:
--   prompt    → instrucciones. Van al final del prompt de sistema, tal cual.
--   documento → conocimiento. Texto pegado que el agente puede citar; si en vez de texto hay una
--               URL (un Drive, por ejemplo), lo que se le pasa es la referencia, no el archivo:
--               la Suite no descarga documentos y el modelo no abre enlaces por su cuenta.
--   enlace    → una URL con su descripción. El agente la conoce y la puede dar; solo la visita si
--               tiene la herramienta de búsqueda web.
CREATE TABLE IF NOT EXISTS public.lr_suite_agente_recurso (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agente text NOT NULL REFERENCES public.lr_suite_agente(clave) ON UPDATE CASCADE ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('prompt', 'documento', 'enlace')),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 160),
  url text CHECK (url IS NULL OR (length(url) <= 1000 AND url ~ '^https?://')),
  -- 20.000 caracteres son unos 5.000 tokens: un documento largo de verdad. El tope está para que
  -- nadie pegue un PDF entero y multiplique por diez el costo de cada mensaje sin darse cuenta.
  contenido text CHECK (contenido IS NULL OR length(contenido) <= 20000),
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 100,
  creado_at timestamptz NOT NULL DEFAULT now(),
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  actualizado_por text,
  -- Un recurso vacío no es un recurso: el prompt necesita texto, el enlace necesita URL, y el
  -- documento vale con cualquiera de los dos.
  CONSTRAINT lr_suite_agente_recurso_tiene_algo CHECK (
    CASE tipo
      WHEN 'prompt' THEN contenido IS NOT NULL AND length(btrim(contenido)) > 0
      WHEN 'enlace' THEN url IS NOT NULL
      ELSE (contenido IS NOT NULL AND length(btrim(contenido)) > 0) OR url IS NOT NULL
    END
  )
);

CREATE INDEX IF NOT EXISTS lr_suite_agente_recurso_agente_idx
  ON public.lr_suite_agente_recurso (agente, tipo, orden, id);

ALTER TABLE public.lr_suite_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_suite_agente_recurso ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lr_suite_agente FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lr_suite_agente_recurso FROM PUBLIC, anon, authenticated;

-- ── Los agentes que ya existen ─────────────────────────────────────────────
-- Los siete sitios desde los que la Suite llama al modelo, al 12 de noviembre de 2026. Se insertan
-- sin pisar lo que ya esté: si mañana alguien les cambia el nombre desde el tablero y la migración
-- se vuelve a correr, el nombre puesto a mano gana.
INSERT INTO public.lr_suite_agente (clave, nombre, rol, donde, funcion, modelo, orden) VALUES
  ('pendientes', 'Pendientes',
   'Lee el tablero del día y propone qué mover: reordena, reasigna y cierra pendientes con el visto bueno de la persona.',
   'Módulo Pendientes · burbuja azul', 'pendientes-agente', 'claude-sonnet-5-5', 10),
  ('gasto', 'Alertas de Gasto',
   'Vigila el pacing de cada marca: avisa de la que se pasa del presupuesto y de la que lo va a dejar sin usar.',
   'Módulo Alertas de Gasto · burbuja ámbar', 'gasto-agente', 'claude-sonnet-5-5', 20),
  ('prospeccion', 'ACRM · la cola',
   'Conversa sobre la cola de prospección: qué acción toca hoy, a quién se le debe respuesta y qué se puede cerrar.',
   'Módulo ACRM · burbuja', 'acrm-agente', 'claude-sonnet-5-5', 30),
  ('ficha', 'ACRM · ficha del lead',
   'Prepara la ficha de un prospecto y propone los hitos del plan de contacto, con el mensaje ya redactado.',
   'Módulo ACRM · ficha del lead', 'acrm-ficha', 'claude-sonnet-5-5', 40),
  ('priorizar', 'ACRM · prioridad de la cola',
   'Puntúa de 0 a 100 cada acción pendiente de la cola y explica por qué. Se dispara con el botón, no conversa.',
   'Módulo ACRM · botón «Prioridad IA»', 'acrm-priorizar', 'claude-sonnet-5-5', 50),
  ('whatsapp', 'Asistente de WhatsApp',
   'Atiende a los prospectos que escriben al WhatsApp de la agencia, responde con el conocimiento cargado y reserva citas.',
   'WhatsApp Cloud API · sin nadie de la agencia del otro lado', 'whatsapp', 'claude-haiku-5-5', 60),
  ('reglas', 'Análisis de reglas',
   'Revisa las reglas de las cuentas publicitarias y señala las que sobran, las que se pisan y las que faltan.',
   'Módulo Reglas · se dispara solo', 'reglas-analisis', 'claude-opus-5-5', 70)
ON CONFLICT (clave) DO NOTHING;

-- ── Qué lee el tablero ─────────────────────────────────────────────────────
-- Una sola llamada para la lista: el catálogo entero, cuántos recursos tiene cada agente y lo que
-- gastó en el periodo. Sin el texto de los prompts —eso pesa y casi nunca se mira desde la lista—:
-- para eso está lr_suite_agente_ficha().
--
-- La lista sale de la unión del catálogo y del registro de uso: un agente que todavía no habló con
-- nadie aparece igual (con ceros), y una clave que esté gastando sin estar en el catálogo también
-- aparece, marcada, que es justo cuando hay que enterarse.
CREATE OR REPLACE FUNCTION public.lr_suite_agentes_panel(p_dias integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_dias integer := least(greatest(coalesce(p_dias, 30), 1), 180);
  v_desde timestamptz;
  v_salida jsonb;
BEGIN
  IF NOT public.is_lr_suite_pending_user() THEN
    RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501';
  END IF;

  v_desde := (
    date_trunc('day', (now() AT TIME ZONE 'America/Lima')) - make_interval(days => v_dias - 1)
  ) AT TIME ZONE 'America/Lima';

  WITH filas AS (
    SELECT u.*, (u.creado_at AT TIME ZONE 'America/Lima')::date AS dia
    FROM public.lr_suite_agente_uso u
    WHERE u.creado_at >= v_desde
  ),
  uso AS (
    SELECT
      f.agente,
      count(*) AS llamadas,
      coalesce(sum(f.entrada), 0) AS entrada,
      coalesce(sum(f.salida), 0) AS salida,
      coalesce(sum(f.cache_lee), 0) AS cache_lee,
      coalesce(sum(f.cache_escribe), 0) AS cache_escribe,
      coalesce(sum(f.busquedas), 0) AS busquedas,
      coalesce(sum(f.codigo), 0) AS codigo,
      round(coalesce(sum(f.costo_usd), 0), 4) AS costo,
      max(f.creado_at) AS ultimo,
      (array_agg(f.modelo ORDER BY f.creado_at DESC))[1] AS modelo_real,
      (array_agg(f.esfuerzo ORDER BY f.creado_at DESC))[1] AS esfuerzo
    FROM filas f
    GROUP BY f.agente
  ),
  recursos AS (
    SELECT
      r.agente,
      count(*) FILTER (WHERE r.activo) AS activos,
      count(*) AS total,
      count(*) FILTER (WHERE r.tipo = 'prompt') AS prompts,
      count(*) FILTER (WHERE r.tipo = 'documento') AS documentos,
      count(*) FILTER (WHERE r.tipo = 'enlace') AS enlaces,
      coalesce(sum(length(coalesce(r.contenido, ''))) FILTER (WHERE r.activo), 0) AS caracteres
    FROM public.lr_suite_agente_recurso r
    GROUP BY r.agente
  ),
  claves AS (
    SELECT clave FROM public.lr_suite_agente
    UNION
    SELECT agente FROM uso
  )
  SELECT jsonb_build_object(
    'dias', v_dias,
    'desde', (v_desde AT TIME ZONE 'America/Lima')::date,
    'hoy', (now() AT TIME ZONE 'America/Lima')::date,
    'total', (
      SELECT jsonb_build_object(
        'llamadas', count(*),
        'entrada', coalesce(sum(f.entrada), 0),
        'salida', coalesce(sum(f.salida), 0),
        'cache_lee', coalesce(sum(f.cache_lee), 0),
        'cache_escribe', coalesce(sum(f.cache_escribe), 0),
        'busquedas', coalesce(sum(f.busquedas), 0),
        'codigo', coalesce(sum(f.codigo), 0),
        'costo', round(coalesce(sum(f.costo_usd), 0), 4)
      )
      FROM filas f
    ),
    'agentes', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.orden, x.costo DESC, x.clave), '[]'::jsonb)
      FROM (
        SELECT
          c.clave,
          coalesce(a.nombre, c.clave) AS nombre,
          a.rol,
          a.donde,
          a.funcion,
          a.modelo,
          coalesce(a.activo, true) AS activo,
          (a.clave IS NULL) AS sin_ficha,
          coalesce(a.orden, 900) AS orden,
          coalesce(u.llamadas, 0) AS llamadas,
          coalesce(u.entrada, 0) AS entrada,
          coalesce(u.salida, 0) AS salida,
          coalesce(u.cache_lee, 0) AS cache_lee,
          coalesce(u.busquedas, 0) AS busquedas,
          coalesce(u.codigo, 0) AS codigo,
          coalesce(u.costo, 0) AS costo,
          u.ultimo,
          u.modelo_real,
          u.esfuerzo,
          coalesce(r.total, 0) AS recursos,
          coalesce(r.activos, 0) AS recursos_activos,
          coalesce(r.prompts, 0) AS prompts,
          coalesce(r.documentos, 0) AS documentos,
          coalesce(r.enlaces, 0) AS enlaces,
          coalesce(r.caracteres, 0) AS caracteres
        FROM claves c
        LEFT JOIN public.lr_suite_agente a ON a.clave = c.clave
        LEFT JOIN uso u ON u.agente = c.clave
        LEFT JOIN recursos r ON r.agente = c.clave
      ) x
    ),
    'por_persona', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.costo DESC), '[]'::jsonb)
      FROM (
        SELECT
          coalesce(f.usuario, 'sin usuario') AS usuario,
          count(*) AS llamadas,
          round(coalesce(sum(f.costo_usd), 0), 4) AS costo
        FROM filas f
        GROUP BY coalesce(f.usuario, 'sin usuario')
      ) x
    ),
    'por_dia', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.dia), '[]'::jsonb)
      FROM (
        SELECT f.dia, count(*) AS llamadas, round(coalesce(sum(f.costo_usd), 0), 4) AS costo
        FROM filas f
        GROUP BY f.dia
      ) x
    )
  )
  INTO v_salida;

  RETURN v_salida;
END
$fn$;

REVOKE ALL ON FUNCTION public.lr_suite_agentes_panel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_suite_agentes_panel(integer) TO authenticated;

-- ── La ficha de un agente ──────────────────────────────────────────────────
-- Esto sí trae el texto completo de sus recursos, porque es lo que se va a editar. Y su gasto
-- desglosado por tipo de llamada, que es donde se ve, por ejemplo, que revisar un mensaje de
-- WhatsApp cuesta aparte de redactarlo.
CREATE OR REPLACE FUNCTION public.lr_suite_agente_ficha(p_clave text, p_dias integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_dias integer := least(greatest(coalesce(p_dias, 30), 1), 180);
  v_clave text := lower(btrim(coalesce(p_clave, '')));
  v_desde timestamptz;
  v_salida jsonb;
BEGIN
  IF NOT public.is_lr_suite_pending_user() THEN
    RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_clave = '' THEN RAISE EXCEPTION 'Falta el agente'; END IF;

  v_desde := (
    date_trunc('day', (now() AT TIME ZONE 'America/Lima')) - make_interval(days => v_dias - 1)
  ) AT TIME ZONE 'America/Lima';

  SELECT jsonb_build_object(
    'clave', v_clave,
    'dias', v_dias,
    'agente', (
      SELECT to_jsonb(a) FROM public.lr_suite_agente a WHERE a.clave = v_clave
    ),
    'recursos', (
      SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.tipo, r.orden, r.id), '[]'::jsonb)
      FROM public.lr_suite_agente_recurso r
      WHERE r.agente = v_clave
    ),
    'por_llamada', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.costo DESC), '[]'::jsonb)
      FROM (
        SELECT
          u.llamada,
          count(*) AS llamadas,
          coalesce(sum(u.entrada), 0) AS entrada,
          coalesce(sum(u.salida), 0) AS salida,
          coalesce(sum(u.cache_lee), 0) AS cache_lee,
          round(coalesce(sum(u.costo_usd), 0), 4) AS costo
        FROM public.lr_suite_agente_uso u
        WHERE u.agente = v_clave AND u.creado_at >= v_desde
        GROUP BY u.llamada
      ) x
    ),
    -- Las últimas diez llamadas, para ver qué pasó recién sin bajar la tabla entera.
    'ultimas', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.creado_at DESC), '[]'::jsonb)
      FROM (
        SELECT u.creado_at, u.llamada, u.usuario, u.modelo, u.esfuerzo,
               u.entrada, u.salida, u.cache_lee, u.busquedas, u.codigo,
               round(u.costo_usd, 4) AS costo
        FROM public.lr_suite_agente_uso u
        WHERE u.agente = v_clave
        ORDER BY u.creado_at DESC
        LIMIT 10
      ) x
    )
  )
  INTO v_salida;

  RETURN v_salida;
END
$fn$;

REVOKE ALL ON FUNCTION public.lr_suite_agente_ficha(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_suite_agente_ficha(text, integer) TO authenticated;

-- ── Escribir ───────────────────────────────────────────────────────────────
-- Una operación para la ficha del agente y otra para sus recursos. Las dos dejan anotado quién
-- tocó: son dos personas y conviene saber de quién fue la instrucción que cambió un agente.
CREATE OR REPLACE FUNCTION public.lr_suite_agente_guardar(p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_clave text := lower(btrim(coalesce(p_datos->>'clave', '')));
  v_quien text;
BEGIN
  IF NOT public.is_lr_suite_pending_user() THEN
    RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_clave !~ '^[a-z][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION 'La clave del agente va en minúsculas, sin espacios ni tildes';
  END IF;
  IF coalesce(btrim(p_datos->>'nombre'), '') = '' THEN
    RAISE EXCEPTION 'El agente necesita un nombre';
  END IF;

  SELECT u.email INTO v_quien FROM auth.users u WHERE u.id = auth.uid();

  INSERT INTO public.lr_suite_agente (clave, nombre, rol, donde, funcion, modelo, activo, orden, notas, actualizado_por)
  VALUES (
    v_clave,
    left(btrim(p_datos->>'nombre'), 80),
    nullif(left(btrim(coalesce(p_datos->>'rol', '')), 400), ''),
    nullif(left(btrim(coalesce(p_datos->>'donde', '')), 120), ''),
    nullif(left(btrim(coalesce(p_datos->>'funcion', '')), 80), ''),
    nullif(left(btrim(coalesce(p_datos->>'modelo', '')), 80), ''),
    coalesce((p_datos->>'activo')::boolean, true),
    coalesce((p_datos->>'orden')::integer, 100),
    nullif(left(btrim(coalesce(p_datos->>'notas', '')), 4000), ''),
    v_quien
  )
  ON CONFLICT (clave) DO UPDATE SET
    nombre = excluded.nombre,
    rol = excluded.rol,
    donde = excluded.donde,
    funcion = excluded.funcion,
    modelo = excluded.modelo,
    activo = excluded.activo,
    orden = excluded.orden,
    notas = excluded.notas,
    actualizado_at = now(),
    actualizado_por = excluded.actualizado_por;

  RETURN jsonb_build_object('ok', true, 'clave', v_clave);
END
$fn$;

REVOKE ALL ON FUNCTION public.lr_suite_agente_guardar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_suite_agente_guardar(jsonb) TO authenticated;

-- crear:   {agente, tipo, titulo, url?, contenido?, orden?}
-- editar:  {id, titulo?, url?, contenido?, orden?}
-- alternar:{id}            — enciende o apaga el recurso sin borrarlo
-- borrar:  {id}
CREATE OR REPLACE FUNCTION public.lr_suite_agente_recurso_op(p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id bigint := nullif(p_datos->>'id', '')::bigint;
  v_quien text;
  v_tipo text;
BEGIN
  IF NOT public.is_lr_suite_pending_user() THEN
    RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501';
  END IF;

  SELECT u.email INTO v_quien FROM auth.users u WHERE u.id = auth.uid();

  IF p_accion = 'crear' THEN
    v_tipo := lower(btrim(coalesce(p_datos->>'tipo', '')));
    IF v_tipo NOT IN ('prompt', 'documento', 'enlace') THEN
      RAISE EXCEPTION 'El recurso tiene que ser prompt, documento o enlace';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.lr_suite_agente a WHERE a.clave = lower(btrim(coalesce(p_datos->>'agente', '')))) THEN
      RAISE EXCEPTION 'Ese agente no está en el catálogo';
    END IF;

    INSERT INTO public.lr_suite_agente_recurso (agente, tipo, titulo, url, contenido, orden, actualizado_por)
    VALUES (
      lower(btrim(p_datos->>'agente')),
      v_tipo,
      left(btrim(coalesce(p_datos->>'titulo', '')), 160),
      nullif(btrim(coalesce(p_datos->>'url', '')), ''),
      nullif(btrim(coalesce(p_datos->>'contenido', '')), ''),
      coalesce((p_datos->>'orden')::integer, 100),
      v_quien
    )
    RETURNING id INTO v_id;

  ELSIF p_accion = 'editar' THEN
    IF v_id IS NULL THEN RAISE EXCEPTION 'Falta el recurso'; END IF;
    UPDATE public.lr_suite_agente_recurso SET
      titulo = CASE WHEN p_datos ? 'titulo' THEN left(btrim(coalesce(p_datos->>'titulo', '')), 160) ELSE titulo END,
      url = CASE WHEN p_datos ? 'url' THEN nullif(btrim(coalesce(p_datos->>'url', '')), '') ELSE url END,
      contenido = CASE WHEN p_datos ? 'contenido' THEN nullif(btrim(coalesce(p_datos->>'contenido', '')), '') ELSE contenido END,
      orden = coalesce((p_datos->>'orden')::integer, orden),
      actualizado_at = now(),
      actualizado_por = v_quien
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese recurso ya no existe'; END IF;

  ELSIF p_accion = 'alternar' THEN
    IF v_id IS NULL THEN RAISE EXCEPTION 'Falta el recurso'; END IF;
    UPDATE public.lr_suite_agente_recurso
    SET activo = NOT activo, actualizado_at = now(), actualizado_por = v_quien
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese recurso ya no existe'; END IF;

  ELSIF p_accion = 'borrar' THEN
    IF v_id IS NULL THEN RAISE EXCEPTION 'Falta el recurso'; END IF;
    DELETE FROM public.lr_suite_agente_recurso WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese recurso ya no existe'; END IF;

  ELSE
    RAISE EXCEPTION 'Acción inválida';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.lr_suite_agente_recurso_op(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_suite_agente_recurso_op(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ── Comprobación después de aplicar ────────────────────────────────────────
-- Tiene que devolver los siete agentes, todos con costo 0 si todavía no hablaron en el periodo:
--   SELECT jsonb_pretty(public.lr_suite_agentes_panel(30));
-- Y la ficha de uno, con sus recursos (vacíos al principio):
--   SELECT jsonb_pretty(public.lr_suite_agente_ficha('pendientes', 30));
