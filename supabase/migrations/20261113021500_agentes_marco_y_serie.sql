-- El marco de indicadores de cada agente, y su gasto día a día.
--
-- Dos cosas que pedía el tablero y no tenía:
--
--   1. «Marco de indicadores». Un agente que responde sobre números tiene que saber con cuáles:
--      cuáles mira, cómo los llama la agencia, qué es bueno y qué es una alarma. Hasta ahora eso
--      había que escribirlo como un prompt suelto. Ahora es un campo propio de la ficha, se ve
--      aparte en la configuración y entra en el prompt con su propio encabezado.
--
--   2. La serie por día de CADA agente. El panel ya devolvía la serie del conjunto; para dibujar
--      la rayita de gasto en la fila de cada agente hacía falta la suya. Son pocos días por
--      agente —solo los que tuvieron gasto—, así que el tablero sigue bajando unos pocos KB.
--
-- Aditiva: una columna nueva y dos funciones reemplazadas. No toca datos ni permisos.
--
-- CÓMO APLICARLA: Supabase → SQL Editor → pegar entero → Run.
BEGIN;

ALTER TABLE public.lr_suite_agente
  ADD COLUMN IF NOT EXISTS marco text CHECK (marco IS NULL OR length(marco) <= 8000);

COMMENT ON COLUMN public.lr_suite_agente.marco IS
  'Marco de indicadores: con qué cifras trabaja el agente y cuándo son una alarma. Entra en su prompt.';

-- ── El tablero, ahora con la serie de cada agente ──────────────────────────
CREATE OR REPLACE FUNCTION public.lr_suite_agentes_panel(p_dias integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_dias integer := least(greatest(coalesce(p_dias, 30), 1), 180);
  v_desde timestamptz;
  v_mitad timestamptz;
  v_salida jsonb;
BEGIN
  IF NOT public.is_lr_suite_pending_user() THEN
    RAISE EXCEPTION 'Cuenta no autorizada' USING ERRCODE = '42501';
  END IF;

  v_desde := (
    date_trunc('day', (now() AT TIME ZONE 'America/Lima')) - make_interval(days => v_dias - 1)
  ) AT TIME ZONE 'America/Lima';

  -- El corte para saber si un agente va al alza: la mitad del periodo. Con 30 días, los últimos
  -- 15 contra los 15 anteriores. Es lo que el tablero marca como «gasto al alza».
  v_mitad := (
    date_trunc('day', (now() AT TIME ZONE 'America/Lima')) - make_interval(days => (v_dias / 2))
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
      round(coalesce(sum(f.costo_usd) FILTER (WHERE f.creado_at >= v_mitad), 0), 4) AS costo_reciente,
      round(coalesce(sum(f.costo_usd) FILTER (WHERE f.creado_at < v_mitad), 0), 4) AS costo_previo,
      max(f.creado_at) AS ultimo,
      (array_agg(f.modelo ORDER BY f.creado_at DESC))[1] AS modelo_real,
      (array_agg(f.esfuerzo ORDER BY f.creado_at DESC))[1] AS esfuerzo
    FROM filas f
    GROUP BY f.agente
  ),
  -- La rayita de cada fila. Solo los días con gasto: los huecos los pinta el navegador, que ya
  -- sabe qué periodo está mirando.
  serie AS (
    SELECT
      d.agente,
      jsonb_agg(jsonb_build_object('dia', d.dia, 'costo', d.costo, 'llamadas', d.llamadas) ORDER BY d.dia) AS dias
    FROM (
      SELECT f.agente, f.dia, count(*) AS llamadas, round(coalesce(sum(f.costo_usd), 0), 4) AS costo
      FROM filas f
      GROUP BY f.agente, f.dia
    ) d
    GROUP BY d.agente
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
          (a.marco IS NOT NULL AND length(btrim(a.marco)) > 0) AS tiene_marco,
          coalesce(a.orden, 900) AS orden,
          coalesce(u.llamadas, 0) AS llamadas,
          coalesce(u.entrada, 0) AS entrada,
          coalesce(u.salida, 0) AS salida,
          coalesce(u.cache_lee, 0) AS cache_lee,
          coalesce(u.busquedas, 0) AS busquedas,
          coalesce(u.codigo, 0) AS codigo,
          coalesce(u.costo, 0) AS costo,
          coalesce(u.costo_reciente, 0) AS costo_reciente,
          coalesce(u.costo_previo, 0) AS costo_previo,
          u.ultimo,
          u.modelo_real,
          u.esfuerzo,
          coalesce(s.dias, '[]'::jsonb) AS por_dia,
          coalesce(r.total, 0) AS recursos,
          coalesce(r.activos, 0) AS recursos_activos,
          coalesce(r.prompts, 0) AS prompts,
          coalesce(r.documentos, 0) AS documentos,
          coalesce(r.enlaces, 0) AS enlaces,
          coalesce(r.caracteres, 0) AS caracteres
        FROM claves c
        LEFT JOIN public.lr_suite_agente a ON a.clave = c.clave
        LEFT JOIN uso u ON u.agente = c.clave
        LEFT JOIN serie s ON s.agente = c.clave
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

-- ── Guardar la ficha, ahora con el marco ───────────────────────────────────
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

  INSERT INTO public.lr_suite_agente (clave, nombre, rol, donde, funcion, modelo, activo, orden, notas, marco, actualizado_por)
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
    nullif(left(btrim(coalesce(p_datos->>'marco', '')), 8000), ''),
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
    -- El marco solo se pisa si venía en la petición: el alta rápida desde la lista no lo manda y
    -- no tiene por qué borrar lo que alguien escribió en la ficha.
    --
    -- Calificado con el nombre de la tabla a propósito: dentro de un ON CONFLICT DO UPDATE, un
    -- «marco» a secas es ambiguo entre la fila que ya está y la que se intentó insertar, y
    -- Postgres lo rechaza en tiempo de ejecución («column reference "marco" is ambiguous»).
    marco = CASE WHEN p_datos ? 'marco' THEN excluded.marco ELSE lr_suite_agente.marco END,
    actualizado_at = now(),
    actualizado_por = excluded.actualizado_por;

  RETURN jsonb_build_object('ok', true, 'clave', v_clave);
END
$fn$;

REVOKE ALL ON FUNCTION public.lr_suite_agente_guardar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_suite_agente_guardar(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ── Comprobación después de aplicar ────────────────────────────────────────
-- Cada agente trae ahora su propia serie y el corte de las dos mitades del periodo:
--   SELECT jsonb_pretty(public.lr_suite_agentes_panel(30) -> 'agentes' -> 0);
