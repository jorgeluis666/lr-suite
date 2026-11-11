-- El registro de lo que gastan los agentes IA.
--
-- Hasta ahora las funciones tiraban el `usage` que devuelve cada respuesta de Anthropic, así que la
-- única cifra de gasto era la de la consola de Anthropic: un solo número para todo, porque es una
-- sola clave. No había forma de saber qué agente, qué persona ni qué día se llevaron el dinero.
--
-- Aquí vive ese dato. Una fila por llamada al modelo, escrita por la Edge Function con la
-- service_role key. El costo se calcula y se congela en el momento de la llamada
-- (supabase/functions/_shared/uso.ts): si mañana cambian los precios, lo ya gastado no se mueve.
--
-- Permisos, a propósito más estrechos que los de las demás tablas: el navegador NO lee esta tabla.
-- Ni SELECT. Lee el resumen ya sumado por lr_suite_agente_uso_resumen(), que devuelve un puñado de
-- cifras en vez de miles de filas. El plan de Supabase es el gratuito y el egress se paga mirando,
-- así que un tablero que baje el detalle entero cada vez que alguien lo abre no es una opción.
--
-- CÓMO APLICARLA: Supabase → SQL Editor → pegar entero → Run. Si sale el aviso de RLS, es falso
-- (lo dispara el bloque DO, no la tabla).
BEGIN;

CREATE TABLE IF NOT EXISTS public.lr_suite_agente_uso (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_at timestamptz NOT NULL DEFAULT now(),
  -- Cuál de los agentes: pendientes, gasto, prospeccion, whatsapp.
  agente text NOT NULL,
  -- Qué llamada fue. El de WhatsApp hace dos por mensaje (redactar y revisar) y la del revisor
  -- cuesta aparte; sin esto, las dos se verían como una sola cifra y no se sabría cuál pesa.
  llamada text NOT NULL DEFAULT 'chat',
  -- Correo de quien estaba conversando. Nulo en el de WhatsApp: ahí no hay nadie de la agencia
  -- del otro lado, escribe un prospecto.
  usuario text,
  modelo text NOT NULL,
  esfuerzo text,
  entrada integer NOT NULL DEFAULT 0,
  salida integer NOT NULL DEFAULT 0,
  cache_lee integer NOT NULL DEFAULT 0,
  cache_escribe integer NOT NULL DEFAULT 0,
  -- Las dos herramientas que corren en el servidor de Anthropic y se cobran aparte de los tokens.
  -- La búsqueda entra en el costo ($10 por cada 1.000). La ejecución de código NO: se cobra por
  -- tiempo de contenedor con 1.550 horas gratis al mes, y meter una estimación por llamada haría
  -- que el tablero mintiera hacia arriba. Se cuenta, y el tablero avisa.
  busquedas integer NOT NULL DEFAULT 0,
  codigo integer NOT NULL DEFAULT 0,
  costo_usd numeric(12,6) NOT NULL DEFAULT 0
);

-- Todas las lecturas del resumen son «desde tal fecha»: es el único índice que hace falta.
CREATE INDEX IF NOT EXISTS lr_suite_agente_uso_creado_idx
  ON public.lr_suite_agente_uso (creado_at DESC);

ALTER TABLE public.lr_suite_agente_uso ENABLE ROW LEVEL SECURITY;

-- Sin políticas y sin permisos: nadie llega a la tabla salvo la service_role, que es la que usan
-- las Edge Functions y que no pasa por RLS. El navegador entra por la función de abajo.
REVOKE ALL ON TABLE public.lr_suite_agente_uso FROM PUBLIC;
REVOKE ALL ON TABLE public.lr_suite_agente_uso FROM anon;
REVOKE ALL ON TABLE public.lr_suite_agente_uso FROM authenticated;

-- ── El resumen que lee el tablero ──────────────────────────────────────────
-- Una sola llamada devuelve todo lo que pinta el módulo: el total del periodo, el desglose por
-- agente (con el modelo y el esfuerzo que corrieron de verdad en la última llamada, que es mejor
-- dato que lo que diga un secreto), el desglose por persona y la serie por día.
--
-- El día es el de Lima, no el UTC: si no, lo de la tarde aparecería mañana.
CREATE OR REPLACE FUNCTION public.lr_suite_agente_uso_resumen(p_dias integer DEFAULT 30)
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
    SELECT
      u.*,
      (u.creado_at AT TIME ZONE 'America/Lima')::date AS dia
    FROM public.lr_suite_agente_uso u
    WHERE u.creado_at >= v_desde
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
    'por_agente', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.costo DESC), '[]'::jsonb)
      FROM (
        SELECT
          f.agente,
          count(*) AS llamadas,
          coalesce(sum(f.entrada), 0) AS entrada,
          coalesce(sum(f.salida), 0) AS salida,
          coalesce(sum(f.cache_lee), 0) AS cache_lee,
          coalesce(sum(f.busquedas), 0) AS busquedas,
          coalesce(sum(f.codigo), 0) AS codigo,
          round(coalesce(sum(f.costo_usd), 0), 4) AS costo,
          max(f.creado_at) AS ultimo,
          (array_agg(f.modelo ORDER BY f.creado_at DESC))[1] AS modelo,
          (array_agg(f.esfuerzo ORDER BY f.creado_at DESC))[1] AS esfuerzo
        FROM filas f
        GROUP BY f.agente
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
        SELECT
          f.dia,
          count(*) AS llamadas,
          round(coalesce(sum(f.costo_usd), 0), 4) AS costo
        FROM filas f
        GROUP BY f.dia
      ) x
    )
  )
  INTO v_salida;

  RETURN v_salida;
END
$fn$;

REVOKE ALL ON FUNCTION public.lr_suite_agente_uso_resumen(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_suite_agente_uso_resumen(integer) TO authenticated;

-- ── Limpieza ───────────────────────────────────────────────────────────────
-- El registro no es un histórico que haya que guardar para siempre: sirve para ver el mes y
-- comparar con el anterior. A los 400 días se borra solo, para que la tabla no crezca sin fin en
-- un proyecto del plan gratuito.
CREATE OR REPLACE FUNCTION public.lr_suite_agente_uso_purgar()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH borradas AS (
    DELETE FROM public.lr_suite_agente_uso
    WHERE creado_at < now() - interval '400 days'
    RETURNING 1
  )
  SELECT count(*)::integer FROM borradas;
$fn$;

REVOKE ALL ON FUNCTION public.lr_suite_agente_uso_purgar() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ── Comprobación después de aplicar ────────────────────────────────────────
-- Tiene que devolver un JSON con total en cero y las tres listas vacías:
--   SELECT public.lr_suite_agente_uso_resumen(30);
