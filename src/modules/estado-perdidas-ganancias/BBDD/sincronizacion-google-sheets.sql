-- ============================================================================
-- Pérdidas y Ganancias: sincronización con Google Sheets
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Fuente: hoja "Perdidas y ganancias - Lima Retail"
--   https://docs.google.com/spreadsheets/d/1SgnvjANYBDeyrPfcbHWpXOmu-2a6DcvzFJWNHFYPPz8
-- Pestañas que se leen (por gid, sobreviven a un cambio de nombre):
--   Ventas               260930101
--   Inversion            260930102
--   Venta vs Resultados  260930103
-- La pestaña Cotizaciones (teléfonos y correos de prospectos) NO se descarga.
--
-- Cómo funciona:
--   1. lr_suite_financial_refresh() descarga las tres pestañas como CSV desde la propia base de datos
--      (extensión http) y guarda el texto en lr_suite_private_data, clave "financial". Si Google no
--      devuelve el CSV esperado, lanza un error y se conservan los datos anteriores.
--   2. pg_cron la ejecuta todos los días a las 06:00 de Lima (11:00 UTC).
--   3. El botón "Actualizar" del index.html llama a sync_lr_suite_financial() (RPC), que solo pueden
--      usar Jorge Luis y Diego (is_lr_suite_pending_user()).
--   El index.html interpreta el CSV en el navegador. El ID de la hoja no aparece en el index.html
--   público y el navegador nunca llama a Google.
--
-- Requisito: la hoja debe seguir compartida como "Cualquier persona con el enlace: Lector".
-- Egress: el navegador lee una sola fila (~5 KB) al iniciar sesión y al pulsar "Actualizar".
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── Descarga de una pestaña como CSV ───────────────────────────────────────
-- p_marker: texto que debe aparecer en el CSV (un encabezado propio de la pestaña). Evita guardar una
-- página de inicio de sesión de Google o una pestaña equivocada si la hoja se reorganiza.
create or replace function public.lr_suite_fetch_sheet_csv(p_gid text, p_marker text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text := 'https://docs.google.com/spreadsheets/d/1SgnvjANYBDeyrPfcbHWpXOmu-2a6DcvzFJWNHFYPPz8/export?format=csv&gid=' || p_gid;
  v_response extensions.http_response;
  v_location text;
  v_hops integer := 0;
begin
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
  exception when others then
    null; -- version de la extension sin esta opcion: se usa su timeout por defecto
  end;

  -- Google responde 307 hacia googleusercontent.com; se sigue la redireccion aqui por si la extension
  -- no lo hace sola.
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
      raise exception 'Google Sheets redirigio la pestaña % sin un destino valido', p_gid;
    end if;
    v_url := v_location;
  end loop;

  if v_response.status <> 200 then
    raise exception 'Google Sheets respondio % para la pestaña %', v_response.status, p_gid;
  end if;

  if coalesce(v_response.content_type, '') not ilike 'text/csv%'
    or position(p_marker in coalesce(v_response.content, '')) = 0 then
    raise exception 'La pestaña % no devolvio el CSV esperado (falta "%"). Revisa que la hoja siga compartida con "Cualquier persona con el enlace" y que la pestaña no se haya reemplazado.', p_gid, p_marker;
  end if;

  return v_response.content;
end;
$$;

-- ── Descarga las tres pestañas y guarda la fila "financial" ────────────────
create or replace function public.lr_suite_financial_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'source', 'Google Sheets · Perdidas y ganancias - Lima Retail',
    'syncedAt', now(),
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'tabs', jsonb_build_object(
      'ventas', public.lr_suite_fetch_sheet_csv('260930101', 'Servicio vendido'),
      'inversion', public.lr_suite_fetch_sheet_csv('260930102', 'Plataforma'),
      'resultados', public.lr_suite_fetch_sheet_csv('260930103', 'Tasa cierre')
    )
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('financial', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_payload;
end;
$$;

-- ── RPC del botón "Actualizar" ──────────────────────────────────────────────
create or replace function public.sync_lr_suite_financial()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.lr_suite_private_data%rowtype;
  v_email text;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'Sin permiso para actualizar Pérdidas y Ganancias' using errcode = '42501';
  end if;

  -- Doble clic o los dos usuarios a la vez: no se vuelve a descargar la hoja si se actualizo hace
  -- menos de 30 segundos.
  select * into v_row from public.lr_suite_private_data where key = 'financial';
  if found and v_row.updated_at > now() - interval '30 seconds' then
    return v_row.payload;
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  return public.lr_suite_financial_refresh('manual', v_email);
end;
$$;

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira.
revoke execute on function public.lr_suite_fetch_sheet_csv(text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_financial_refresh(text, text) from public, anon, authenticated;
revoke execute on function public.sync_lr_suite_financial() from public, anon;
grant execute on function public.sync_lr_suite_financial() to authenticated;

-- ── Actualizacion diaria: 06:00 de Lima (UTC-5, sin horario de verano) ─────
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-financial-daily',
  '0 11 * * *',
  $cron$select public.lr_suite_financial_refresh('automatica')$cron$
);

-- Primera carga, para no esperar al cron.
select public.lr_suite_financial_refresh('instalacion') ->> 'syncedAt' as primera_sincronizacion;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Ultima sincronizacion guardada:
--   select updated_at, payload ->> 'trigger' as origen, payload ->> 'requestedBy' as usuario
--   from public.lr_suite_private_data where key = 'financial';
-- Ultimas ejecuciones del cron:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-financial-daily')
--   order by start_time desc limit 5;
-- Cambiar la hora (ej. 07:30 de Lima = 12:30 UTC):
--   select cron.schedule('lr-suite-financial-daily', '30 12 * * *',
--     $cron$select public.lr_suite_financial_refresh('automatica')$cron$);
-- Desinstalar el cron:
--   select cron.unschedule('lr-suite-financial-daily');
