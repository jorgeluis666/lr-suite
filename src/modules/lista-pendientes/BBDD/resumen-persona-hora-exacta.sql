-- ============================================================================
-- Resumen personal de pendientes: a la 1 y a las 5 de la tarde exactas
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Por que: GitHub no garantiza la hora de sus workflows programados (el 22 de
-- octubre de 2026 el de las 8:30 arranco a la 1:03 p. m.). Un resumen del
-- mediodia que llega a las cinco no sirve de nada, asi que la hora la pone
-- pg_cron, que si es puntual: a la 1 y a las 5 de Lima le pide a GitHub que
-- corra .github/workflows/resumen-persona.yml, que arranca en segundos y manda
-- un correo a cada persona.
--
-- Que necesita: la llave de GitHub que ya quedo guardada con el correo de las
-- 8:30 (lr_suite_notificaciones_claves, id 'github-actions'). Es la misma para
-- los dos envios: una sola llave de grano fino, solo para el repositorio
-- lr-suite, con el permiso Actions: Read and write. Si no esta, instalar antes
-- src/modules/alertas-gasto/BBDD/alertas-gasto-hora-exacta.sql, que es donde se
-- pega.
--
-- Requiere: resumen-persona-correo.sql y las extensiones http y pg_cron (ya
-- instaladas por estado-perdidas-ganancias).
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

-- ── 1. La llave de GitHub tiene que estar ya ───────────────────────────────
do $llave$
begin
  if to_regclass('public.lr_suite_notificaciones_claves') is null then
    raise exception 'Falta lr_suite_notificaciones_claves. Ejecuta antes resumen-persona-correo.sql';
  end if;
  if not exists (
    select 1 from public.lr_suite_notificaciones_claves
    where id = 'github-actions' and (clave like 'github\_pat\_%' or clave like 'ghp\_%')
  ) then
    raise exception
      'Falta la llave de GitHub (id github-actions). Pegala en la seccion 1 de src/modules/alertas-gasto/BBDD/alertas-gasto-hora-exacta.sql';
  end if;
end $llave$;

-- ── 2. Pedirle a GitHub que mande los resumenes ────────────────────────────
-- p_simulacion = true arma los correos sin enviarlos (para probar).
create or replace function public.lr_suite_disparar_resumen_persona(p_simulacion boolean default false)
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
    raise exception 'Falta la llave de GitHub (id github-actions): pegala en alertas-gasto-hora-exacta.sql';
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  exception when others then
    null; -- version de la extension sin esta opcion: se usa su timeout por defecto
  end;

  -- El corte no se manda: el script lo decide por la hora de Lima (antes de las 3 es el del
  -- mediodia, despues el del cierre), asi una corrida que se retrase no se presenta con el
  -- rotulo equivocado.
  v_response := extensions.http((
    'POST',
    'https://api.github.com/repos/jorgeluis666/lr-suite/actions/workflows/resumen-persona.yml/dispatches',
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
    raise exception 'GitHub respondio % al pedir el resumen personal: %', v_response.status, left(coalesce(v_response.content, ''), 200);
  end if;
  return v_response.status;
end;
$$;

revoke execute on function public.lr_suite_disparar_resumen_persona(boolean) from public, anon, authenticated;

-- ── 3. A la 1 y a las 5 de la tarde de Lima, de lunes a viernes ─────────────
-- 13:00 y 17:00 de Lima son 18:00 y 22:00 UTC (Peru no cambia de hora).
-- Solo de lunes a viernes: un control de productividad el domingo es ruido.
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-resumen-persona',
  '0 18,22 * * 1-5',
  $cron$select public.lr_suite_disparar_resumen_persona()$cron$
);

-- ── 4. Comprobacion ────────────────────────────────────────────────────────
-- Lo que debe devolver: job = lr-suite-resumen-persona y schedule = 0 18,22 * * 1-5.
select jobname as job, schedule, active
from cron.job
where jobname = 'lr-suite-resumen-persona';

-- Probar sin enviar los correos (en GitHub > Actions aparece una corrida "Resumen personal de
-- pendientes"):
--   select public.lr_suite_disparar_resumen_persona(true);
-- Ultimas ejecuciones del cron:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-resumen-persona')
--   order by start_time desc limit 5;
-- Cambiar las horas (ej. 12:30 y 6 p. m. de Lima = 17:30 y 23:00 UTC; hacen falta dos jobs si los
-- minutos no coinciden):
--   select cron.schedule('lr-suite-resumen-persona', '30 17 * * 1-5',
--     $cron$select public.lr_suite_disparar_resumen_persona()$cron$);
--   select cron.schedule('lr-suite-resumen-persona-tarde', '0 23 * * 1-5',
--     $cron$select public.lr_suite_disparar_resumen_persona()$cron$);
-- Incluir sabados y domingos: cambiar '0 18,22 * * 1-5' por '0 18,22 * * *'.
-- Desinstalar: select cron.unschedule('lr-suite-resumen-persona');
