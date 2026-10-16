-- ============================================================================
-- Clientes: qué carpetas tiene cada marca dentro de su carpeta de Drive
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- El mapa del módulo "Clientes" dibujaba la misma cadena de cuatro pasos para todas las marcas, y
-- eso es mentira: Royal Baby tiene Meta Ads, Google Ads, objetivos y ventas, reportes y artes;
-- Aquarius solo las de Google Ads. Para dibujar lo que cada marca tiene de verdad hace falta
-- saberlo, y el navegador no puede preguntárselo a Drive.
--
-- De dónde sale el inventario: de la hoja de la auditoría («Conexiones Drive Dashboard»), no de
-- Drive. Listar las carpetas de marca exigiría compartirlas con "cualquiera con el enlace", y
-- dentro hay administración y contratos. La hoja, en cambio, solo tiene nombres y enlaces: un
-- enlace a una carpeta privada no abre nada. Las carpetas siguen cerradas.
--
-- Cómo funciona:
--   1. Lee dos pestañas de la hoja con la Google Visualization API, que devuelve JSON:
--        "Hoja 1"      marca y link de su carpeta  → con qué marca va cada carpeta
--        "Subcarpetas" marca, subcarpeta y link    → el inventario
--   2. Empareja cada marca con la clave que usa el módulo (el nombre del repo) comparando el link
--      de su carpeta con el de la fila "clientes-drive". Así la hoja puede llamar a la marca "TP" o
--      "TLM" sin que haya que mantener una tabla de equivalencias.
--   3. Guarda "clientes-carpetas":
--        { "<clave>": [ { "nombre": "01 Meta Ads", "id": "...", "estandar": true }, ... ] }
--
-- "estandar" dice si el nombre sigue el estándar acordado (prefijo numérico). El módulo pinta en
-- rojo las que no lo siguen, que son las que hay que renombrar.
--
-- El id de la hoja NO está en este archivo ni en el index.html, que son públicos: se guarda con
-- lr_suite_clientes_set_sheet() (ver el final).
--
-- Requisito: la hoja compartida como "Cualquier persona con el enlace" y la fila "clientes-drive".
-- Egress: el navegador lee una fila de ~3 KB al iniciar sesión.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── ¿El nombre sigue el estándar? ──────────────────────────────────────────
-- Las carpetas acordadas llevan prefijo numérico: 01 Meta Ads, 02 Google Ads, 03 Objetivos y
-- ventas, 04 Reportes, 05 Looker, 06 Artes, 07 Administración, 99 Archivos sueltos. Una fila de la
-- hoja puede venir anidada ("Mex Cream / 04 Reportes"): manda el último tramo.
create or replace function public.lr_suite_clientes_carpeta_estandar(p_nombre text)
returns boolean
language sql
immutable
as $$
  select btrim(split_part(coalesce(p_nombre, ''), '/', array_length(string_to_array(coalesce(p_nombre, ''), '/'), 1)))
         ~ '^(0[1-7]|99) ';
$$;

-- ── Una consulta a la hoja, ya en JSON ─────────────────────────────────────
-- gviz acepta un "select" sobre la pestaña y devuelve JSON, que en SQL se lee mucho mejor que un
-- CSV. Devuelve las filas como arrays de texto.
create or replace function public.lr_suite_clientes_sheet_rows(
  p_sheet text,
  p_tab text,
  p_select text,
  p_timeout_ms integer default 20000
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_response extensions.http_response;
  v_body text;
  v_json jsonb;
begin
  v_url := 'https://docs.google.com/spreadsheets/d/' || p_sheet
    || '/gviz/tq?tqx=out:json&headers=1&sheet=' || extensions.urlencode(p_tab)
    || '&tq=' || extensions.urlencode('select ' || p_select);

  v_response := public.lr_suite_ads_http_get(v_url, p_timeout_ms);
  if v_response.status <> 200 then
    raise exception 'La hoja respondió % al pedir la pestaña «%»', v_response.status, p_tab;
  end if;

  -- gviz envuelve el JSON: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  v_body := coalesce(v_response.content, '');
  v_body := substring(v_body from position('{' in v_body));
  v_body := left(v_body, length(v_body) - position('}' in reverse(v_body)) + 1);
  begin
    v_json := v_body::jsonb;
  exception when others then
    raise exception 'La pestaña «%» no devolvió algo legible. Revisa que la hoja siga compartida con "Cualquier persona con el enlace".', p_tab;
  end;

  return (
    select coalesce(jsonb_agg(
             (select coalesce(jsonb_agg(coalesce(c ->> 'v', '') order by i), '[]'::jsonb)
              from jsonb_array_elements(r -> 'c') with ordinality as t(c, i))
           ), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_json #> '{table,rows}', '[]'::jsonb)) as r
  );
end;
$$;

-- ── Arma el inventario ─────────────────────────────────────────────────────
create or replace function public.lr_suite_clientes_carpetas_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet text;
  v_links jsonb;
  v_marcas_hoja jsonb;
  v_subcarpetas jsonb;
  v_por_id jsonb := '{}'::jsonb;   -- id de carpeta → clave del módulo
  v_por_marca jsonb := '{}'::jsonb; -- nombre en la hoja → clave del módulo
  v_clave text;
  v_url text;
  v_fila jsonb;
  v_marca text;
  v_id text;
  v_out jsonb := '{}'::jsonb;
  v_errores jsonb := '[]'::jsonb;
  v_payload jsonb;
begin
  select payload ->> 'sheetId' into v_sheet from public.lr_suite_private_data where key = 'clientes-carpetas-config';
  if coalesce(v_sheet, '') = '' then
    raise exception 'Falta la hoja del inventario: select public.lr_suite_clientes_set_sheet(''<ID>'');';
  end if;
  select payload into v_links from public.lr_suite_private_data where key = 'clientes-drive';
  if v_links is null then
    raise exception 'Falta la fila "clientes-drive" con la carpeta de cada marca';
  end if;

  -- Clave del módulo por id de carpeta.
  for v_clave, v_url in select key, value from jsonb_each_text(v_links) loop
    v_id := substring(coalesce(v_url, '') from 'folders/([A-Za-z0-9_-]+)');
    if v_id is not null then v_por_id := v_por_id || jsonb_build_object(v_id, v_clave); end if;
  end loop;

  -- "Hoja 1": nombre de la marca y link de su carpeta. Con eso, el nombre que use la hoja da igual.
  v_marcas_hoja := public.lr_suite_clientes_sheet_rows(v_sheet, 'Hoja 1', 'A, C');
  for v_fila in select value from jsonb_array_elements(v_marcas_hoja) loop
    v_marca := btrim(coalesce(v_fila ->> 0, ''));
    v_id := substring(coalesce(v_fila ->> 1, '') from 'folders/([A-Za-z0-9_-]+)');
    if v_marca = '' or v_id is null then continue; end if;
    if v_por_id ? v_id then
      v_por_marca := v_por_marca || jsonb_build_object(lower(v_marca), v_por_id ->> v_id);
    else
      v_errores := v_errores || to_jsonb(format('%s: su carpeta no está en «clientes-drive»', v_marca));
    end if;
  end loop;

  -- "Subcarpetas": marca, nombre de la carpeta y link.
  v_subcarpetas := public.lr_suite_clientes_sheet_rows(v_sheet, 'Subcarpetas', 'A, B, C');
  for v_fila in select value from jsonb_array_elements(v_subcarpetas) loop
    v_marca := lower(btrim(coalesce(v_fila ->> 0, '')));
    if v_marca = '' or not (v_por_marca ? v_marca) then continue; end if;
    v_clave := v_por_marca ->> v_marca;
    v_id := substring(coalesce(v_fila ->> 2, '') from 'folders/([A-Za-z0-9_-]+)');
    v_out := jsonb_set(
      v_out,
      array[v_clave],
      coalesce(v_out -> v_clave, '[]'::jsonb) || jsonb_build_object(
        'nombre', btrim(coalesce(v_fila ->> 1, '')),
        'id', v_id,
        'estandar', public.lr_suite_clientes_carpeta_estandar(v_fila ->> 1)
      ),
      true
    );
  end loop;

  -- Una marca de "clientes-drive" sin ninguna fila en la hoja se avisa: o no tiene carpetas, o la
  -- hoja se quedó atrás.
  for v_clave in select key from jsonb_each_text(v_links) loop
    if not (v_out ? v_clave) then
      v_errores := v_errores || to_jsonb(format('%s: la hoja no lista ninguna carpeta suya', v_clave));
      v_out := v_out || jsonb_build_object(v_clave, '[]'::jsonb);
    end if;
  end loop;

  v_payload := jsonb_build_object(
    'version', 2,
    'fuente', 'Hoja «Conexiones Drive Dashboard»',
    'updatedAt', now(),
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'errors', v_errores,
    'marcas', v_out
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('clientes-carpetas', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_payload;
end;
$$;

-- ── RPC del botón "Actualizar" del mapa ────────────────────────────────────
create or replace function public.sync_lr_suite_clientes_carpetas()
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
    raise exception 'Sin permiso para actualizar las carpetas de los clientes' using errcode = '42501';
  end if;
  select * into v_row from public.lr_suite_private_data where key = 'clientes-carpetas';
  if found and v_row.updated_at > now() - interval '30 seconds' then
    return v_row.payload;
  end if;
  select u.email into v_email from auth.users u where u.id = auth.uid();
  return public.lr_suite_clientes_carpetas_refresh('manual', v_email);
end;
$$;

-- ── Configuración de la hoja (solo desde el SQL Editor) ────────────────────
create or replace function public.lr_suite_clientes_set_sheet(p_sheet text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_sheet, '') !~ '^[A-Za-z0-9_-]{20,}$' then
    raise exception 'ID de hoja no valido: %', p_sheet;
  end if;
  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('clientes-carpetas-config', jsonb_build_object('sheetId', p_sheet), now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end;
$$;

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira.
revoke execute on function public.lr_suite_clientes_carpeta_estandar(text) from public, anon, authenticated;
revoke execute on function public.lr_suite_clientes_sheet_rows(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_clientes_carpetas_refresh(text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_clientes_set_sheet(text) from public, anon, authenticated;
revoke execute on function public.sync_lr_suite_clientes_carpetas() from public, anon;
grant execute on function public.sync_lr_suite_clientes_carpetas() to authenticated;

-- ── Actualizacion diaria: 06:50 de Lima, despues de la carga de anuncios ───
select cron.schedule(
  'lr-suite-clientes-carpetas-daily',
  '50 11 * * *',
  $cron$select public.lr_suite_clientes_carpetas_refresh('automatica')$cron$
);

-- ── Pasos finales (una sola vez, NO se guardan en el repo) ─────────────────
-- 1. Guardar el id de la hoja de la auditoria y 2. hacer la primera lectura, cada una por separado:
--
--   select public.lr_suite_clientes_set_sheet('<ID_DE_LA_HOJA>');
--   select public.lr_suite_clientes_carpetas_refresh('instalacion') ->> 'updatedAt' as primera_lectura;
--
-- La segunda no va dentro de este script: el editor corre todo en una transaccion y, si la lectura
-- se pasa del tiempo maximo, el error desharia tambien las funciones y el cron.

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Cuantas carpetas tiene cada marca y cuantas estan fuera del estandar:
--   select m.key as marca,
--          jsonb_array_length(m.value) as carpetas,
--          count(*) filter (where (c ->> 'estandar')::boolean is false) as fuera_del_estandar
--   from public.lr_suite_private_data d,
--        jsonb_each(d.payload -> 'marcas') as m,
--        jsonb_array_elements(m.value) as c
--   where d.key = 'clientes-carpetas'
--   group by 1, 2 order by 1;
-- Avisos de la ultima lectura:
--   select payload -> 'errors' from public.lr_suite_private_data where key = 'clientes-carpetas';
-- Desinstalar el cron:
--   select cron.unschedule('lr-suite-clientes-carpetas-daily');
