-- ============================================================================
-- Pérdidas y Ganancias: inversión mensual de Meta Ads (API de Meta)
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Fuente: cuenta publicitaria «Lima Retail» (act_1547666408881704), endpoint
-- /insights de la Marketing API con time_increment=monthly. Se guarda el gasto
-- de cada mes desde el 1 de enero del año anterior hasta hoy en
-- lr_suite_private_data, clave "meta-ads":
--   { syncedAt, trigger, requestedBy, account, currency, months: [{ month: "AAAA-MM", spend }] }
-- El index.html la usa como inversión mensual de Meta Ads (en lugar del total
-- anual de la hoja) en el estado de resultados y en Indicadores comerciales.
--
-- El token NO vive en el repositorio (es público) ni en el index.html: se guarda
-- en Supabase Vault con el nombre lr_suite_meta_ads_token.
--
-- ANTES DE EJECUTAR — token de acceso de Meta (una sola vez):
--   1. Business Manager de Lima Retail > Configuración del negocio > Usuarios >
--      Usuarios del sistema > Agregar (rol Empleado).
--   2. Asignar activos > Cuentas publicitarias > «Lima Retail» > permiso «Ver rendimiento».
--   3. Generar token: elegir la app de la empresa, permiso ads_read, sin vencimiento.
--   4. En Supabase > SQL Editor (reemplaza el texto entre comillas por el token):
--        select vault.create_secret('EL_TOKEN', 'lr_suite_meta_ads_token');
--      Para cambiarlo después:
--        select vault.update_secret(
--          (select id from vault.secrets where name = 'lr_suite_meta_ads_token'), 'TOKEN_NUEVO');
--
-- Cómo se actualiza:
--   - pg_cron todos los días a las 06:10 de Lima (11:10 UTC).
--   - El botón "Actualizar" de Pérdidas y Ganancias llama a sync_lr_suite_meta_ads()
--     (solo Jorge Luis y Diego: is_lr_suite_pending_user()).
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.lr_suite_meta_ads_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Versión de la Marketing API. v23.0 dejó de estar disponible el 9/6/2026; v25.0 (18/2/2026)
  -- sigue vigente hasta julio de 2028. Al cambiarla, revisar el changelog de la Marketing API.
  v_version constant text := 'v25.0';
  v_account constant text := 'act_1547666408881704';
  v_token text;
  v_today date := (now() at time zone 'America/Lima')::date;
  v_since date := make_date(extract(year from v_today)::int - 1, 1, 1);
  v_url text;
  v_response extensions.http_response;
  v_body jsonb;
  v_months jsonb := '[]'::jsonb;
  v_currency text := 'PEN';
  v_row jsonb;
  v_pages integer := 0;
  v_payload jsonb;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'lr_suite_meta_ads_token';
  if v_token is null or v_token = '' then
    raise exception 'Falta el token de Meta en Vault (lr_suite_meta_ads_token). Revisa las instrucciones al inicio de sincronizacion-meta-ads.sql.';
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');
  exception when others then
    null;
  end;

  v_url := format(
    'https://graph.facebook.com/%s/%s/insights?fields=spend,account_currency&time_increment=monthly&level=account&limit=50&time_range=%s&access_token=%s',
    v_version,
    v_account,
    extensions.urlencode(format('{"since":"%s","until":"%s"}', v_since, v_today)),
    extensions.urlencode(v_token)
  );

  -- La respuesta viene paginada; con meses alcanza una página, pero se sigue "next" por si acaso.
  loop
    v_response := extensions.http_get(v_url);
    v_body := v_response.content::jsonb;
    if v_response.status <> 200 or v_body ? 'error' then
      raise exception 'La API de Meta respondió %: %', v_response.status, coalesce(v_body -> 'error' ->> 'message', left(v_response.content, 300));
    end if;
    for v_row in select * from jsonb_array_elements(coalesce(v_body -> 'data', '[]'::jsonb)) loop
      v_currency := coalesce(v_row ->> 'account_currency', v_currency);
      v_months := v_months || jsonb_build_array(jsonb_build_object(
        'month', left(v_row ->> 'date_start', 7),
        'spend', coalesce((v_row ->> 'spend')::numeric, 0)
      ));
    end loop;
    v_url := v_body -> 'paging' ->> 'next';
    v_pages := v_pages + 1;
    exit when v_url is null or v_pages >= 10;
  end loop;

  v_payload := jsonb_build_object(
    'source', 'Meta Marketing API · Lima Retail',
    'syncedAt', now(),
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'account', v_account,
    'currency', v_currency,
    'months', v_months
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('meta-ads', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_payload;
end;
$$;

-- RPC del botón "Actualizar".
create or replace function public.sync_lr_suite_meta_ads()
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
    raise exception 'Sin permiso para actualizar Meta Ads' using errcode = '42501';
  end if;

  select * into v_row from public.lr_suite_private_data where key = 'meta-ads';
  if found and v_row.updated_at > now() - interval '30 seconds' then
    return v_row.payload;
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  return public.lr_suite_meta_ads_refresh('manual', v_email);
end;
$$;

revoke execute on function public.lr_suite_meta_ads_refresh(text, text) from public, anon, authenticated;
revoke execute on function public.sync_lr_suite_meta_ads() from public, anon;
grant execute on function public.sync_lr_suite_meta_ads() to authenticated;

select cron.schedule(
  'lr-suite-meta-ads-daily',
  '10 11 * * *',
  $cron$select public.lr_suite_meta_ads_refresh('automatica')$cron$
);

notify pgrst, 'reload schema';

-- Primera carga: debe devolver la fecha de sincronización y la cantidad de meses.
select payload ->> 'syncedAt' as sincronizado, jsonb_array_length(payload -> 'months') as meses
from (select public.lr_suite_meta_ads_refresh('instalacion') as payload) as primera;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Meses guardados:
--   select payload -> 'months' from public.lr_suite_private_data where key = 'meta-ads';
-- Últimas ejecuciones del cron:
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-meta-ads-daily')
--   order by start_time desc limit 5;
