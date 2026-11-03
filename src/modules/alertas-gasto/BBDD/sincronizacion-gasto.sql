-- Alertas de Gasto · carga automática del informe de Google Ads
--
-- Hasta el 1 de noviembre de 2026 el informe entraba por una barra de subida dentro del módulo, y
-- esa barra se quitó: el último informe cargado quedó congelado en el 21 de octubre y nada iba a
-- reemplazarlo. Esto lo reemplaza. pg_cron le pide al Web App de `apps-script/Codigo.gs` el informe
-- más reciente de su carpeta de Drive —ya leído y sumado por cuenta— y lo escribe en el mes que le
-- toca, igual que hacía la barra.
--
--   Google Ads (informe programado) → carpeta de Drive → este cron → lr_suite_private_data
--
-- El Web App corre con la cuenta dueña de la carpeta, así que la carpeta no se comparte por enlace
-- y su id no vive en este repositorio, que es público: va en las propiedades del script.
--
-- **Las cuentas de Meta del mes no se tocan.** Entran por otro camino (hoy a mano, mañana por la
-- conexión de Meta de Nexus) y una carga de Google que las borrara dejaría media pantalla vacía,
-- que es lo mismo que hacía la barra de subida.
--
-- Lo que esta carga NO resuelve: que las dos plataformas cubran la misma ventana de días. El ritmo
-- diario y la proyección se calculan sobre los días que cubre el informe, así que si Google avanza
-- al día 30 y las cuentas de Meta se quedaron en el 21, el pacing de Meta sale corto. El estado
-- guarda cuántas cuentas de Meta se heredaron para que se vea; la salida de verdad es que cada
-- plataforma traiga su propia ventana, y eso es un cambio del módulo, no de este archivo.
--
-- Requisitos: la extensión http (la misma que usan palabras clave y anuncios).
--   create extension if not exists http with schema extensions;
--
-- Puesta en marcha, una sola vez y desde el SQL Editor:
--   1. Desplegar apps-script/Codigo.gs como Web App (ver su cabecera).
--   2. select public.lr_suite_gasto_set_endpoint('<URL que termina en /exec>', '<TOKEN del script>');
--   3. select public.lr_suite_gasto_refresh('manual');

-- ── GET que sigue redirecciones ─────────────────────────────────────────────
-- Google responde 302 hacia googleusercontent.com al llamar un Web App; se sigue aqui por si la
-- extension no lo hace sola.
create or replace function public.lr_suite_gasto_http_get(p_url text, p_timeout_ms integer default 20000)
returns extensions.http_response
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text := p_url;
  v_response extensions.http_response;
  v_location text;
  v_hops integer := 0;
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
      raise exception 'Google redirigio % sin un destino valido', p_url;
    end if;
    v_url := v_location;
  end loop;
  return v_response;
end;
$$;

-- ── El Web App que lee la carpeta ───────────────────────────────────────────
create or replace function public.lr_suite_gasto_set_endpoint(p_url text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
begin
  if coalesce(p_url, '') !~ '^https://script\.google\.com/.+/exec$' then
    raise exception 'La URL tiene que ser la implementacion del Web App, la que termina en /exec';
  end if;
  if length(coalesce(p_token, '')) < 16 then
    raise exception 'El token es demasiado corto: usa la misma cadena larga que pusiste en Script Properties';
  end if;

  select payload into v_config from public.lr_suite_private_data where key = 'gasto-config';
  v_config := coalesce(v_config, '{}'::jsonb) || jsonb_build_object('endpoint', p_url, 'token', p_token);

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('gasto-config', v_config, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  -- No muestra el token: esta consulta se ejecuta en el editor y su resultado queda a la vista.
  return jsonb_build_object('endpoint', p_url);
end;
$$;

create or replace function public.lr_suite_gasto_endpoint()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
begin
  select payload into v_config from public.lr_suite_private_data where key = 'gasto-config';
  if coalesce(v_config ->> 'endpoint', '') = '' or coalesce(v_config ->> 'token', '') = '' then
    raise exception 'Falta el Web App: select public.lr_suite_gasto_set_endpoint(''<URL /exec>'', ''<TOKEN>'');';
  end if;
  return jsonb_build_object('url', v_config ->> 'endpoint', 'token', v_config ->> 'token');
end;
$$;

-- ── El informe, ya leído por el Web App ─────────────────────────────────────
create or replace function public.lr_suite_gasto_fetch(p_timeout_ms integer default 30000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_endpoint jsonb := public.lr_suite_gasto_endpoint();
  v_response extensions.http_response;
  v_json jsonb;
begin
  v_response := public.lr_suite_gasto_http_get(
    (v_endpoint ->> 'url')
      || '?accion=informe'
      || '&token=' || extensions.urlencode(v_endpoint ->> 'token'),
    p_timeout_ms
  );
  if v_response.status <> 200 then
    raise exception 'El Web App del informe respondio %', v_response.status;
  end if;

  begin
    v_json := coalesce(v_response.content, '')::jsonb;
  exception when others then
    raise exception 'El Web App del informe no devolvio JSON. Revisa que la implementacion siga publicada.';
  end;

  if coalesce(v_json ->> 'ok', '') <> 'true' then
    raise exception 'El Web App no pudo leer el informe: %', coalesce(v_json ->> 'error', 'sin detalle');
  end if;
  if coalesce(v_json ->> 'hasta', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'El informe no trae un periodo valido: %', coalesce(v_json ->> 'hasta', '(vacio)');
  end if;
  if jsonb_array_length(coalesce(v_json -> 'cuentas', '[]'::jsonb)) = 0 then
    raise exception 'El informe no trae ninguna cuenta';
  end if;
  return v_json;
end;
$$;

-- ── Sincronización completa (cron diario) ───────────────────────────────────
create or replace function public.lr_suite_gasto_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body jsonb;
  v_mes text;
  v_payload jsonb;
  v_informes jsonb;
  v_meta jsonb;
  v_informe jsonb;
  v_status jsonb;
begin
  v_body := public.lr_suite_gasto_fetch();
  -- El mes del informe es el de su ULTIMA fecha: con un informe a mitad de mes, lo que se compara
  -- es el presupuesto de ese mes. Misma regla que tenia la barra de subida.
  v_mes := substring(v_body ->> 'hasta' from 1 for 7);

  v_payload := coalesce((select payload from public.lr_suite_private_data where key = 'gasto-alertas'), '{}'::jsonb);
  v_informes := coalesce(v_payload -> 'informes', '{}'::jsonb);

  -- Las cuentas de Meta que ya estaban en ese mes se conservan: entran por otro camino.
  v_meta := coalesce((
    select jsonb_agg(cuenta)
    from jsonb_array_elements(coalesce(v_informes -> v_mes -> 'cuentas', '[]'::jsonb)) as cuenta
    where cuenta ->> 'plataforma' = 'meta'
  ), '[]'::jsonb);

  v_informe := jsonb_build_object(
    'plataforma', 'google',
    'desde', v_body ->> 'desde',
    'hasta', v_body ->> 'hasta',
    'subidoAt', to_jsonb(now()),
    'subidoPor', 'carga automatica',
    'archivo', coalesce(v_body -> 'archivo', 'null'::jsonb),
    'cuentas', (v_body -> 'cuentas') || v_meta
  );

  v_payload := jsonb_set(v_payload, '{informes}', v_informes || jsonb_build_object(v_mes, v_informe), true);

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('gasto-alertas', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  v_status := jsonb_build_object(
    'schemaVersion', 1,
    'source', 'Google Drive · Informe de rendimiento de Google Ads',
    'mes', v_mes,
    'desde', v_body ->> 'desde',
    'hasta', v_body ->> 'hasta',
    'archivo', coalesce(v_body -> 'archivo', 'null'::jsonb),
    'cuentasGoogle', jsonb_array_length(v_body -> 'cuentas'),
    -- Cuantas cuentas de Meta se heredaron del mes: si son de otra ventana de dias, su ritmo
    -- diario sale calculado sobre los dias del informe de Google y queda corto.
    'cuentasMetaHeredadas', jsonb_array_length(v_meta),
    'lastSync', now(),
    'trigger', p_trigger,
    'requestedBy', p_requested_by
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('gasto-status', v_status, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_status;
end;
$$;

revoke execute on function public.lr_suite_gasto_http_get(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_gasto_set_endpoint(text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_gasto_endpoint() from public, anon, authenticated;
revoke execute on function public.lr_suite_gasto_fetch(integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_gasto_refresh(text, text) from public, anon, authenticated;

-- ── Actualizacion diaria: 06:10 de Lima (UTC-5, sin horario de verano) ──────
-- Antes que el correo de las 8:30, que es lo primero que lee el informe del dia.
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-gasto-daily',
  '10 11 * * *',
  $cron$select public.lr_suite_gasto_refresh('automatica')$cron$
);

-- ── La pieza en el Control de Automatizacion (si ese modulo esta instalado) ─
do $$
begin
  if to_regclass('public.lr_suite_automation_components') is null then
    raise notice 'Control de Automatizacion no esta instalado: la pieza "gasto" no se registro. La sincronizacion funciona igual.';
    return;
  end if;

  insert into public.lr_suite_automation_components
    (id, stage, name, brand, source, description, status, cadence, cron_job, run_function, data_key, data_path, sort)
  values
    ('gasto', 'carga', 'Carga del informe de gasto', 'Lima Retail', 'google',
     'pg_cron lee el informe de rendimiento de Google Ads de su carpeta de Drive todos los dias a las 6:10 a. m.',
     'activo', 'diaria', 'lr-suite-gasto-daily', 'public.lr_suite_gasto_refresh', 'gasto-status', '{lastSync}', 55)
  on conflict (id) do update
    set status = 'activo',
        cron_job = excluded.cron_job,
        run_function = excluded.run_function,
        data_key = excluded.data_key,
        data_path = excluded.data_path,
        updated_at = now();

  -- La descarga sigue siendo de Google Ads, que deja el informe programado en la carpeta: esa
  -- pieza se marca activa a mano cuando el informe programado existe, porque desde aqui no se ve.
end;
$$;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- select public.lr_suite_gasto_refresh('manual');
-- select payload from public.lr_suite_private_data where key = 'gasto-status';
-- select
--   coalesce(cuenta ->> 'plataforma', 'google') as plataforma,
--   count(*) as cuentas,
--   round(sum((cuenta ->> 'coste')::numeric), 2) as gasto
-- from public.lr_suite_private_data d,
--      jsonb_array_elements(d.payload -> 'informes' -> '2026-11' -> 'cuentas') as cuenta
-- where d.key = 'gasto-alertas'
-- group by 1;
