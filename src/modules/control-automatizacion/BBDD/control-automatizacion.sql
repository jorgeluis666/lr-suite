-- ============================================================================
-- Control de Automatización: historial de corridas y re-ejecución manual
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- El módulo "Control de Automatización" del index.html muestra en un solo lugar el estado de las
-- sincronizaciones automáticas. Este script agrega lo que el módulo necesita de Supabase. Es aditivo: no
-- cambia las tablas, las funciones ni los crons de Pérdidas y Ganancias ni de Palabras clave.
--
--   1. lr_suite_automation_runs: una fila por cada re-ejecución pedida desde el módulo (quién, cuándo,
--      estado, duración, filas y error). Las corridas automáticas no se copian aquí: se leen de
--      cron.job_run_details, el historial propio de pg_cron.
--   2. RPC lr_suite_automation_status(): estado de las dos sincronizaciones en un JSON chico (~5 KB):
--      job de pg_cron, últimas corridas, último dato guardado y su antigüedad, medida con el reloj de la
--      base de datos (no con el del navegador).
--   3. RPC run_lr_suite_automation(p_job): pone en cola una re-ejecución y programa un job de pg_cron de
--      un solo uso para el minuto siguiente, porque la descarga de Palabras clave no cabe en el tiempo
--      máximo de una llamada a la API. lr_suite_automation_process() corre la sincronización existente,
--      guarda el resultado (también si falla) y borra su job.
--
-- Solo Jorge Luis y Diego (is_lr_suite_pending_user()).
-- Requisitos: sincronizacion-google-sheets.sql y sincronizacion-drive.sql ya instalados.
-- Egress: una lectura de ~5 KB al abrir el módulo, y cada 15 s solo mientras hay una re-ejecución en cola.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- ── Re-ejecuciones pedidas desde el módulo ─────────────────────────────────
create table if not exists public.lr_suite_automation_runs (
  id bigint generated always as identity primary key,
  job text not null,
  trigger text not null default 'manual',
  requested_by text,
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz,
  cron_job_name text,
  status text not null default 'en_cola' check (status in ('en_cola', 'ok', 'error')),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  rows_loaded integer,
  detail jsonb,
  error_detail text
);

create index if not exists lr_suite_automation_runs_job_requested_idx
  on public.lr_suite_automation_runs (job, requested_at desc);

-- Solo lectura para los dos usuarios; las filas las escriben las funciones de abajo.
alter table public.lr_suite_automation_runs enable row level security;
revoke all on public.lr_suite_automation_runs from anon, authenticated;
grant select on public.lr_suite_automation_runs to authenticated;

drop policy if exists "lr suite users can read automation runs" on public.lr_suite_automation_runs;
create policy "lr suite users can read automation runs"
  on public.lr_suite_automation_runs for select to authenticated
  using (public.is_lr_suite_pending_user());

-- ── Ayudas ─────────────────────────────────────────────────────────────────
-- Sincronizaciones que vigila el módulo: su job diario de pg_cron y la fila donde guardan su estado.
create or replace function public.lr_suite_automation_jobs()
returns table (job text, cron_job text, data_key text)
language sql
immutable
as $$
  values
    ('financial', 'lr-suite-financial-daily', 'financial'),
    ('keywords', 'lr-suite-keywords-daily', 'keywords-status');
$$;

-- Texto a fecha; null si viene vacío o mal formado.
create or replace function public.lr_suite_automation_ts(p_value text)
returns timestamptz
language plpgsql
stable
as $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::timestamptz;
exception when others then
  return null;
end;
$$;

-- Filas con datos de un CSV: no cuenta las vacías, que Google Sheets exporta como ",,,,".
create or replace function public.lr_suite_automation_csv_rows(p_csv text)
returns integer
language sql
immutable
as $$
  select count(*)::integer
  from regexp_split_to_table(coalesce(p_csv, ''), E'\r?\n') as line
  where btrim(line, E' ,\t"') <> '';
$$;

-- Una re-ejecución tal como la recibe el módulo.
create or replace function public.lr_suite_automation_run_json(p_run public.lr_suite_automation_runs)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_run.id,
    'job', p_run.job,
    'status', p_run.status,
    'requestedBy', p_run.requested_by,
    'requestedAt', p_run.requested_at,
    'scheduledFor', p_run.scheduled_for,
    'startedAt', p_run.started_at,
    'finishedAt', p_run.finished_at,
    'durationMs', p_run.duration_ms,
    'rows', p_run.rows_loaded,
    'detail', p_run.detail,
    'error', p_run.error_detail,
    -- En cola hace más de 10 minutos: pg_cron no la ejecutó.
    'overdue', p_run.status = 'en_cola'
      and coalesce(p_run.scheduled_for, p_run.requested_at) < now() - interval '10 minutes'
  );
$$;

-- ── RPC: estado para el módulo ─────────────────────────────────────────────
create or replace function public.lr_suite_automation_status(p_history integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_history, 10), 1), 30);
  v_job record;
  v_jobs jsonb := '[]'::jsonb;
  v_jobid bigint;
  v_cron jsonb;
  v_runs jsonb;
  v_manual jsonb;
  v_payload jsonb;
  v_items jsonb;
  v_data jsonb;
  v_data_at timestamptz;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'Sin permiso para ver el control de automatización' using errcode = '42501';
  end if;

  for v_job in select * from public.lr_suite_automation_jobs() loop
    -- Job diario de pg_cron y sus últimas corridas. Si pg_cron no responde, se informa y se sigue.
    v_jobid := null;
    v_cron := null;
    v_runs := '[]'::jsonb;
    begin
      select c.jobid, jsonb_build_object('schedule', c.schedule, 'active', c.active)
        into v_jobid, v_cron
      from cron.job c
      where c.jobname = v_job.cron_job
      order by c.jobid desc
      limit 1;

      if v_jobid is not null then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'status', d.status,
                 'startedAt', d.start_time,
                 'finishedAt', d.end_time,
                 'durationMs', case
                   when d.start_time is not null and d.end_time is not null
                     then round(extract(epoch from (d.end_time - d.start_time)) * 1000)
                 end,
                 'message', left(d.return_message, 500)
               ) order by d.runid desc), '[]'::jsonb)
          into v_runs
        from (
          select r.runid, r.status, r.start_time, r.end_time, r.return_message
          from cron.job_run_details r
          where r.jobid = v_jobid
          order by r.runid desc
          limit v_limit
        ) as d;
      end if;
    exception when others then
      v_cron := jsonb_build_object('error', left(sqlerrm, 300));
    end;

    -- Último dato guardado por la sincronización: solo campos chicos, nunca los CSV.
    v_payload := null;
    select p.payload into v_payload
    from public.lr_suite_private_data p
    where p.key = v_job.data_key;

    if v_job.job = 'financial' then
      v_data_at := public.lr_suite_automation_ts(v_payload ->> 'syncedAt');
      v_items := case when jsonb_typeof(v_payload -> 'tabs') = 'object' then v_payload -> 'tabs' else '{}'::jsonb end;
      v_data := jsonb_build_object(
        'at', v_data_at,
        'trigger', v_payload ->> 'trigger',
        'requestedBy', v_payload ->> 'requestedBy',
        'rows', (
          select coalesce(jsonb_object_agg(t.key, public.lr_suite_automation_csv_rows(t.value)), '{}'::jsonb)
          from jsonb_each_text(v_items) as t
        )
      );
    else
      v_data_at := public.lr_suite_automation_ts(v_payload ->> 'lastSync');
      v_items := case when jsonb_typeof(v_payload -> 'files') = 'array' then v_payload -> 'files' else '[]'::jsonb end;
      v_data := jsonb_build_object(
        'at', v_data_at,
        'trigger', v_payload ->> 'trigger',
        'requestedBy', v_payload ->> 'requestedBy',
        'lastChange', v_payload ->> 'lastChange',
        'discovery', v_payload ->> 'discovery',
        'files', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'name', f ->> 'name',
                   'status', coalesce(f ->> 'status', 'ok'),
                   'modifiedTime', f ->> 'modifiedTime'
                 ) order by f ->> 'name'), '[]'::jsonb)
          from jsonb_array_elements(v_items) as f
        ),
        'errors', (
          select coalesce(jsonb_agg(left(e.message, 300)), '[]'::jsonb)
          from (
            select m as message
            from jsonb_array_elements_text(
              case when jsonb_typeof(v_payload -> 'errors') = 'array' then v_payload -> 'errors' else '[]'::jsonb end
            ) as m
            limit 10
          ) as e
        )
      );
    end if;

    -- Re-ejecuciones pedidas desde el módulo.
    select coalesce(jsonb_agg(public.lr_suite_automation_run_json(r) order by r.requested_at desc), '[]'::jsonb)
      into v_manual
    from public.lr_suite_automation_runs r
    where r.id in (
      select x.id
      from public.lr_suite_automation_runs x
      where x.job = v_job.job
      order by x.requested_at desc
      limit v_limit
    );

    v_jobs := v_jobs || jsonb_build_object(
      'id', v_job.job,
      'cronJob', v_job.cron_job,
      'cron', v_cron,
      'runs', v_runs,
      'manualRuns', v_manual,
      'data', v_data,
      'ageHours', case
        when v_data_at is null then null
        else round((extract(epoch from (now() - v_data_at)) / 3600)::numeric, 2)
      end
    );
  end loop;

  return jsonb_build_object('serverNow', now(), 'timezone', 'America/Lima', 'jobs', v_jobs);
end;
$$;

-- ── RPC: re-ejecutar una sincronización ────────────────────────────────────
create or replace function public.run_lr_suite_automation(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_job text := lower(btrim(coalesce(p_job, '')));
  v_run public.lr_suite_automation_runs%rowtype;
  v_email text;
  v_target timestamptz;
  v_tz text;
  v_local timestamp;
  v_name text;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'Sin permiso para re-ejecutar sincronizaciones' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lr_suite_automation_jobs() j where j.job = v_job) then
    raise exception 'Sincronización desconocida: %', p_job using errcode = '22023';
  end if;

  -- Doble clic o los dos usuarios a la vez: si ya hay una en cola, se devuelve esa.
  select * into v_run
  from public.lr_suite_automation_runs r
  where r.job = v_job
    and r.status = 'en_cola'
    and coalesce(r.scheduled_for, r.requested_at) > now() - interval '10 minutes'
  order by r.requested_at desc
  limit 1;
  if found then
    return public.lr_suite_automation_run_json(v_run);
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  -- Primer minuto entero con al menos 15 segundos de margen.
  v_target := date_trunc('minute', now()) + interval '1 minute';
  if v_target - now() < interval '15 seconds' then
    v_target := v_target + interval '1 minute';
  end if;

  insert into public.lr_suite_automation_runs (job, requested_by, scheduled_for)
  values (v_job, v_email, v_target)
  returning * into v_run;

  -- pg_cron lee el horario en su zona (GMT en Supabase). La expresión fija minuto, hora, día y mes: si el
  -- job no llegara a borrarse al correr, recién volvería en un año.
  begin
    v_tz := coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT');
  exception when others then
    v_tz := 'GMT';
  end;
  v_local := v_target at time zone v_tz;
  v_name := 'lr-suite-automation-run-' || v_run.id;

  perform cron.schedule(
    v_name,
    format(
      '%s %s %s %s *',
      extract(minute from v_local)::integer,
      extract(hour from v_local)::integer,
      extract(day from v_local)::integer,
      extract(month from v_local)::integer
    ),
    format('select public.lr_suite_automation_process(%s)', v_run.id)
  );

  update public.lr_suite_automation_runs
  set cron_job_name = v_name
  where id = v_run.id
  returning * into v_run;

  return public.lr_suite_automation_run_json(v_run);
end;
$$;

-- ── Corre una re-ejecución (la llama el job de pg_cron de un solo uso) ─────
create or replace function public.lr_suite_automation_process(p_run_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.lr_suite_automation_runs%rowtype;
  v_started timestamptz := clock_timestamp();
  v_result jsonb;
  v_rows integer;
  v_detail jsonb;
begin
  select * into v_run from public.lr_suite_automation_runs where id = p_run_id for update;
  if not found then
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

  begin
    if v_run.job = 'financial' then
      v_result := public.lr_suite_financial_refresh('manual', v_run.requested_by);
      select coalesce(jsonb_object_agg(t.key, public.lr_suite_automation_csv_rows(t.value)), '{}'::jsonb),
             coalesce(sum(public.lr_suite_automation_csv_rows(t.value)), 0)
        into v_detail, v_rows
      from jsonb_each_text(coalesce(v_result -> 'tabs', '{}'::jsonb)) as t;
      v_detail := jsonb_build_object('rows', v_detail);
    elsif v_run.job = 'keywords' then
      v_result := public.lr_suite_keywords_refresh('manual', v_run.requested_by);
      select count(*) filter (where f ->> 'status' = 'ok'),
             coalesce(jsonb_agg(jsonb_build_object('name', f ->> 'name', 'status', f ->> 'status')), '[]'::jsonb)
        into v_rows, v_detail
      from jsonb_array_elements(coalesce(v_result -> 'files', '[]'::jsonb)) as f;
      v_detail := jsonb_build_object(
        'files', v_detail,
        'changed', v_result -> 'changed',
        'errors', coalesce(v_result -> 'errors', '[]'::jsonb)
      );
    else
      raise exception 'Sincronización desconocida: %', v_run.job;
    end if;

    update public.lr_suite_automation_runs
    set status = 'ok',
        started_at = v_started,
        finished_at = clock_timestamp(),
        duration_ms = round(extract(epoch from (clock_timestamp() - v_started)) * 1000),
        rows_loaded = v_rows,
        detail = v_detail,
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

  -- Se conservan 180 días de re-ejecuciones.
  delete from public.lr_suite_automation_runs where requested_at < now() - interval '180 days';

  return public.lr_suite_automation_run_json(v_run);
end;
$$;

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira.
revoke execute on function public.lr_suite_automation_jobs() from public, anon, authenticated;
revoke execute on function public.lr_suite_automation_ts(text) from public, anon, authenticated;
revoke execute on function public.lr_suite_automation_csv_rows(text) from public, anon, authenticated;
revoke execute on function public.lr_suite_automation_run_json(public.lr_suite_automation_runs) from public, anon, authenticated;
revoke execute on function public.lr_suite_automation_process(bigint) from public, anon, authenticated;
revoke execute on function public.lr_suite_automation_status(integer) from public, anon;
grant execute on function public.lr_suite_automation_status(integer) to authenticated;
revoke execute on function public.run_lr_suite_automation(text) from public, anon;
grant execute on function public.run_lr_suite_automation(text) to authenticated;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Últimas re-ejecuciones pedidas desde el módulo:
--   select id, job, status, requested_by, requested_at, scheduled_for, duration_ms, rows_loaded, error_detail
--   from public.lr_suite_automation_runs order by requested_at desc limit 10;
-- Jobs de un solo uso que siguen programados (se borran solos al correr):
--   select jobid, jobname, schedule from cron.job where jobname like 'lr-suite-automation-run-%';
-- Borrar uno a mano:
--   select cron.unschedule('lr-suite-automation-run-<id>');
-- Probar una re-ejecución desde aquí, sin esperar al minuto siguiente:
--   insert into public.lr_suite_automation_runs (job, requested_by) values ('financial', 'sql-editor') returning id;
--   select public.lr_suite_automation_process(<id>);
