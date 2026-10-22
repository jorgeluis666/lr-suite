-- ============================================================================
-- Resumen diario de pendientes: a las 8:30 a. m. exactas
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Por que: GitHub no garantiza la hora de sus workflows programados (el 22 de
-- octubre de 2026 el de las 8:30 arranco a la 1:03 p. m.). pg_cron si es puntual:
-- a las 8:30 de Lima le pide a GitHub que corra .github/workflows/resumen-pendientes.yml,
-- que arranca en segundos y manda el correo.
--
-- Que necesita: una llave de GitHub de grano fino, solo para el repositorio
-- lr-suite, con el permiso Actions: Read and write. Vive en
-- lr_suite_notificaciones_claves (id 'github-actions'), que no se lee por la API.
--
-- Requiere: resumen-pendientes-correo.sql (tabla de claves) y las extensiones
-- http y pg_cron (ya instaladas por estado-perdidas-ganancias).
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

-- ── 1. La llave de GitHub ───────────────────────────────────────────────────
-- Pega la llave entre las comillas de abajo SOLO en el SQL Editor (no la guardes
-- en este archivo: el repositorio es publico). Si la dejas como esta, no se toca
-- la llave que ya este guardada.
do $llave$
declare
  v_llave text := 'PEGAR_AQUI_LA_LLAVE_DE_GITHUB';
begin
  if to_regclass('public.lr_suite_notificaciones_claves') is null then
    raise exception 'Falta lr_suite_notificaciones_claves. Ejecuta antes resumen-pendientes-correo.sql';
  end if;
  if v_llave <> 'PEGAR_AQUI_LA_LLAVE_DE_GITHUB' and trim(v_llave) <> '' then
    insert into public.lr_suite_notificaciones_claves (id, clave)
    values ('github-actions', trim(v_llave))
    on conflict (id) do update set clave = excluded.clave, creada_en = now();
  end if;
end $llave$;

-- ── 2. Pedirle a GitHub que mande el resumen ───────────────────────────────
-- p_simulacion = true arma el correo sin enviarlo (para probar).
create or replace function public.lr_suite_disparar_resumen_pendientes(p_simulacion boolean default false)
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
    raise exception 'Falta la llave de GitHub: pegala en la seccion 1 de resumen-pendientes-hora-exacta.sql';
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  exception when others then
    null; -- version de la extension sin esta opcion: se usa su timeout por defecto
  end;

  v_response := extensions.http((
    'POST',
    'https://api.github.com/repos/jorgeluis666/lr-suite/actions/workflows/resumen-pendientes.yml/dispatches',
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
    raise exception 'GitHub respondio % al pedir el resumen: %', v_response.status, left(coalesce(v_response.content, ''), 200);
  end if;
  return v_response.status;
end;
$$;

revoke execute on function public.lr_suite_disparar_resumen_pendientes(boolean) from public, anon, authenticated;

-- ── 3. Todos los dias a las 8:30 a. m. de Lima (13:30 UTC) ──────────────────
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-resumen-pendientes',
  '30 13 * * *',
  $cron$select public.lr_suite_disparar_resumen_pendientes()$cron$
);

-- ── 4. Comprobacion ────────────────────────────────────────────────────────
-- Lo que debe devolver: llave_guardada = true y job = lr-suite-resumen-pendientes.
select
  exists (select 1 from public.lr_suite_notificaciones_claves where id = 'github-actions' and clave <> '') as llave_guardada,
  (select jobname from cron.job where jobname = 'lr-suite-resumen-pendientes') as job;

-- Probar sin enviar el correo (en GitHub > Actions aparece una corrida "Resumen diario de pendientes"):
--   select public.lr_suite_disparar_resumen_pendientes(true);
-- Ultimas ejecuciones del cron:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-resumen-pendientes')
--   order by start_time desc limit 5;
-- Cambiar la hora (ej. 8:00 de Lima = 13:00 UTC):
--   select cron.schedule('lr-suite-resumen-pendientes', '0 13 * * *',
--     $cron$select public.lr_suite_disparar_resumen_pendientes()$cron$);
-- Desinstalar: select cron.unschedule('lr-suite-resumen-pendientes');
