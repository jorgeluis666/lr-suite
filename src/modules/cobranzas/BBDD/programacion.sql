-- Instalar DESPUÉS del workflow y sus secretos. Requiere http, pg_cron y la
-- clave github-actions ya usada por las alertas de gasto. No envía al instalar.
begin;

create or replace function public.lr_suite_disparar_cobranzas(p_simulacion boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_response extensions.http_response;
begin
  select clave into v_token from public.lr_suite_notificaciones_claves where id = 'github-actions';
  if coalesce(v_token, '') = '' then
    raise exception 'Falta la llave de GitHub: pegala en la seccion 1 de alertas-gasto-hora-exacta.sql (configuración compartida)';
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  exception when others then
    null; -- version de la extension sin esta opcion: se usa su timeout por defecto
  end;

  v_response := extensions.http((
    'POST',
    'https://api.github.com/repos/jorgeluis666/lr-suite/actions/workflows/cobranzas.yml/dispatches',
    array[
      extensions.http_header('Authorization', 'Bearer ' || v_token),
      extensions.http_header('Accept', 'application/vnd.github+json'),
      extensions.http_header('X-GitHub-Api-Version', '2022-11-28'),
      extensions.http_header('User-Agent', 'lr-suite-pg-cron')
    ],
    'application/json',
    json_build_object('ref', 'main', 'inputs', json_build_object('dry_run', case when p_simulacion then 'true' else 'false' end))::text
  )::extensions.http_request);

  -- GitHub responde 204 si acepto la corrida. Con otro codigo el cron queda en error y se ve en
  -- cron.job_run_details (llave vencida o sin permiso: 401/403/404).
  if v_response.status <> 204 then
    raise exception 'GitHub respondio % al pedir los recordatorios: %', v_response.status, left(coalesce(v_response.content, ''), 200);
  end if;
  return v_response.status;
end;
$$;

revoke execute on function public.lr_suite_disparar_cobranzas(boolean) from public, anon, authenticated;

-- ── 3. Todos los dias a las 07:00 a. m. de Lima (12:00 UTC) ──────────────────
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-cobranzas',
  '0 12 * * *',
  $cron$select public.lr_suite_disparar_cobranzas()$cron$
);

commit;
