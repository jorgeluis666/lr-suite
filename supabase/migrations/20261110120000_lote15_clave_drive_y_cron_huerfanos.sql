-- Lote 15 de la auditoría, primera parte: que la clave de Drive no acabe escrita en ningún aviso,
-- que una descarga no pueda crecer sin tope, y que un job de pg_cron no se quede suelto un año.
--
-- CÓMO APLICARLA: Supabase → SQL Editor → pegar entero → Run. El aviso de «RLS» que a veces sale
-- con los bloques DO es falso; se ejecuta igual. Antes de pegar, conviene comprobar que lo que
-- corre en la base es lo mismo que hay en el repo (ver COMPROBACIÓN PREVIA, abajo).
--
-- COMPROBACIÓN PREVIA, solo lectura, por si la base se tocó a mano alguna vez:
--   select pg_get_functiondef('public.lr_suite_keywords_http_get(text,integer)'::regprocedure);
--   select pg_get_functiondef('public.lr_suite_keywords_download(jsonb)'::regprocedure);
--   select pg_get_functiondef('public.lr_suite_automation_process(bigint)'::regprocedure);
-- Si alguna difiere de src/modules/.../*.sql, avisar antes de aplicar esto: las reemplaza enteras.
--
-- QUÉ NO ENTRA AQUÍ todavía, porque pide decidir con la base delante:
--   · Reutilizar el CSV de los informes que no cambiaron (punto 2d del lote). Toca
--     lr_suite_keywords_refresh, que es la función larga, y conviene medirla antes.
--   · La limpieza de huérfanos desde lr_suite_automation_status, que es una función de 130 líneas:
--     aquí va como función propia y se llama desde process, sin reemplazar status.
BEGIN;

-- ── 1. La clave de Drive deja de viajar en los mensajes ────────────────────
-- v_url puede llevar ?key=<API key de Drive>. Al fallar una redirección, esa URL entera entraba
-- en el mensaje de la excepción, y de ahí al array «errors» de la fila keywords-status, que el
-- navegador lee y pinta. La clave quedaba a la vista de cualquiera con sesión, y también en
-- cron.job_run_details.
CREATE OR REPLACE FUNCTION public.lr_suite_keywords_http_get(p_url text, p_timeout_ms integer DEFAULT 15000)
RETURNS extensions.http_response
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_url text := p_url;
  v_response extensions.http_response;
  v_location text;
  v_hops integer := 0;
  -- La misma URL, pero sin el valor de la clave. Es la única que se puede nombrar en un error.
  v_url_segura text := regexp_replace(p_url, '([?&]key=)[^&]+', '\1<oculta>', 'g');
begin
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', p_timeout_ms::text);
  exception when others then
    null; -- version de la extension sin esta opcion: se usa su timeout por defecto
  end;

  loop
    v_response := extensions.http_get(v_url);
    exit when v_response.status not in (301, 302, 303, 307, 308);
    v_location := null;
    select h.value into v_location
    from unnest(v_response.headers) as h
    where lower(h.field) = 'location'
    limit 1;
    v_hops := v_hops + 1;
    if v_location is null or v_hops > 5 then
      raise exception 'Google redirigio % sin un destino valido', v_url_segura;
    end if;
    v_url := v_location;
  end loop;
  return v_response;
end;
$$;

-- ── 2. Una descarga no puede crecer sin tope ───────────────────────────────
-- El contenido se guarda entero en una fila. Un informe que creciera por error, o una página de
-- Google que no sea el informe, podía meter megas en la base y en cada lectura posterior.
CREATE OR REPLACE FUNCTION public.lr_suite_keywords_download(p_file jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_response extensions.http_response;
  v_tamano integer;
  v_url text := case
    when p_file ->> 'mimeType' = 'application/vnd.google-apps.spreadsheet'
      then 'https://docs.google.com/spreadsheets/d/' || (p_file ->> 'id') || '/export?format=csv'
    else 'https://drive.google.com/uc?export=download&id=' || (p_file ->> 'id')
  end;
begin
  v_response := public.lr_suite_keywords_http_get(v_url);
  if v_response.status <> 200 then
    raise exception 'Google respondio %', v_response.status;
  end if;
  v_tamano := octet_length(coalesce(v_response.content, ''));
  if v_tamano > 2000000 then
    raise exception 'el informe pesa % bytes, mas del tope de 2.000.000', v_tamano;
  end if;
  -- Evita guardar una página de inicio de sesión o un archivo que no es el informe.
  if coalesce(v_response.content, '') !~* 'palabra clave' or coalesce(v_response.content, '') !~* 'campa' then
    raise exception 'no es un informe de palabras clave (faltan las columnas Palabra clave y Campaña)';
  end if;
  return v_response.content;
end;
$$;

-- ── 3. Jobs de pg_cron que se quedaron sueltos ─────────────────────────────
-- Una corrida manual programa un job de un solo uso con la expresión «minuto hora día mes *». Si
-- pg_cron no corre en ese minuto (base reiniciada, pausada o en mantenimiento), el job no se borra
-- nunca: queda en cron.job y vuelve a dispararse dentro de UN AÑO, en esa misma fecha y hora, con
-- una sincronización que nadie pidió. Y si para entonces la corrida ya se borró por antigüedad
-- —se guardan 180 días—, process sale antes de llegar al unschedule y el job queda para siempre.
CREATE OR REPLACE FUNCTION public.lr_suite_automation_limpiar_huerfanos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_job record;
  v_run public.lr_suite_automation_runs%rowtype;
  -- No se puede usar FOUND más abajo: PERFORM lo reescribe, así que después del unschedule ya no
  -- diría si la corrida existía, sino si el unschedule devolvió algo.
  v_hay_corrida boolean;
  v_limpiados integer := 0;
begin
  -- Si pg_cron no está o no se puede leer, no es motivo para que falle quien llamó.
  begin
    for v_job in select j.jobname from cron.job j where j.jobname like 'lr-suite-automation-run-%'
    loop
      select * into v_run
      from public.lr_suite_automation_runs
      where cron_job_name = v_job.jobname
      order by id desc
      limit 1;
      v_hay_corrida := found;

      -- Se deja en paz solo el job cuya corrida sigue en cola y todavía está a tiempo.
      if v_hay_corrida
         and v_run.status = 'en_cola'
         and coalesce(v_run.scheduled_for, v_run.requested_at) > now() - interval '1 hour' then
        continue;
      end if;

      begin
        perform cron.unschedule(v_job.jobname);
        v_limpiados := v_limpiados + 1;
      exception when others then
        null;
      end;

      if v_hay_corrida and v_run.status = 'en_cola' then
        update public.lr_suite_automation_runs
        set status = 'error',
            finished_at = now(),
            error_detail = 'No se ejecutó a tiempo'
        where id = v_run.id;
      end if;
    end loop;
  exception when others then
    null;
  end;
  return v_limpiados;
end;
$$;

REVOKE ALL ON FUNCTION public.lr_suite_automation_limpiar_huerfanos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_suite_automation_limpiar_huerfanos() TO authenticated;

-- ── 4. Una corrida vencida no se ejecuta tarde ─────────────────────────────
-- Si el job se disparó con una hora de retraso, lo que pidió alguien hace rato ya no es lo que
-- espera: se marca como error en vez de lanzar una sincronización sorpresa. Y de paso, cada vez
-- que se procesa algo se barren los huérfanos, que es cuando más barato sale.
CREATE OR REPLACE FUNCTION public.lr_suite_automation_process(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_run public.lr_suite_automation_runs%rowtype;
  v_function regproc;
  v_started timestamptz := clock_timestamp();
  v_result jsonb;
  v_summary jsonb;
begin
  select * into v_run from public.lr_suite_automation_runs where id = p_run_id for update;
  if not found then
    -- La corrida ya no existe (se borró por antigüedad) pero el job sí: hay que barrerlo igual, o
    -- se queda disparándose una vez al año para siempre.
    perform public.lr_suite_automation_limpiar_huerfanos();
    return null;
  end if;

  -- El job era de un solo uso: se borra primero, así no vuelve a correr aunque algo falle después.
  if v_run.cron_job_name is not null then
    begin
      perform cron.unschedule(v_run.cron_job_name);
    exception when others then
      null;
    end;
  end if;

  if v_run.status <> 'en_cola' then
    return public.lr_suite_automation_run_json(v_run);
  end if;

  -- Vencida: no se ejecuta.
  if coalesce(v_run.scheduled_for, v_run.requested_at) < now() - interval '1 hour' then
    update public.lr_suite_automation_runs
    set status = 'error',
        finished_at = clock_timestamp(),
        error_detail = 'No se ejecutó a tiempo'
    where id = v_run.id
    returning * into v_run;
    return public.lr_suite_automation_run_json(v_run);
  end if;

  begin
    select to_regproc(c.run_function) into v_function
    from public.lr_suite_automation_components c
    where c.id = v_run.job;
    if v_function is null then
      raise exception 'El componente % no tiene una función para ejecutarlo', v_run.job;
    end if;

    execute format('select %s($1, $2)', v_function) into v_result using 'manual'::text, v_run.requested_by;
    v_summary := public.lr_suite_automation_summary(v_result);

    update public.lr_suite_automation_runs
    set status = 'ok',
        started_at = v_started,
        finished_at = clock_timestamp(),
        duration_ms = round(extract(epoch from (clock_timestamp() - v_started)) * 1000),
        rows_loaded = (v_summary ->> 'total')::integer,
        detail = v_summary,
        error_detail = null
    where id = v_run.id
    returning * into v_run;
  exception when others then
    -- Se deshace lo que alcanzó a escribir la sincronización (quedan los datos anteriores) y se guarda
    -- el motivo.
    update public.lr_suite_automation_runs
    set status = 'error',
        started_at = v_started,
        finished_at = clock_timestamp(),
        duration_ms = round(extract(epoch from (clock_timestamp() - v_started)) * 1000),
        error_detail = left(sqlerrm, 1000)
    where id = v_run.id
    returning * into v_run;
  end;

  perform public.lr_suite_automation_limpiar_huerfanos();

  -- Se conservan 180 días de corridas registradas.
  delete from public.lr_suite_automation_runs where requested_at < now() - interval '180 days';

  return public.lr_suite_automation_run_json(v_run);
end;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ── Después de aplicar ─────────────────────────────────────────────────────
-- 1) Barrer de una vez los huérfanos que ya hubiera:
--      select public.lr_suite_automation_limpiar_huerfanos();
--      select jobname from cron.job where jobname like 'lr-suite-automation-run-%';
--    La segunda consulta no debería devolver nada, salvo una corrida en cola de hace menos de 1 h.
-- 2) Comprobar que la clave no quedó escrita de antes:
--      select payload -> 'errors' from public.lr_suite_private_data where key = 'keywords-status';
--    Si ahí aparece «key=», hay que regenerar la API key en Google Cloud, limitarla a la Drive API
--    y volver a guardarla en Vault: estuvo a la vista y hay que darla por quemada.
