-- ============================================================================
-- Análisis de Palabras Clave: sincronización con la carpeta de Google Drive
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Fuente: UNA CARPETA POR MARCA en Drive, con un "Informe de palabras clave de búsqueda" de Google
-- Ads por mes (hojas de Google Sheets o CSV). Las escribe Nexus, que es quien habla con la API de
-- Google Ads: una marca aquí es una cuenta de Google Ads con su destino de palabras clave dado de
-- alta allá. Los ID de las carpetas NO están en este archivo ni en el index.html, que son públicos:
-- se guardan en Supabase con lr_suite_keywords_set_marca() (ver el final).
--
-- Cómo funciona:
--   1. lr_suite_keywords_refresh() recorre las marcas configuradas. Por cada una lista su carpeta
--      (Drive API con una key guardada en Vault, si existe; si no, la vista pública
--      embeddedfolderview; si falla, el último manifiesto), descarga cada informe como CSV y guarda:
--        - lr_suite_private_data "keywords-status": una fila pequeña (~4 KB) con TODAS las marcas,
--          su manifiesto, su hash y sus avisos. Se reescribe en cada ejecución.
--        - lr_suite_private_data "keywords" (la cuenta de la agencia) y "keywords:<marca>" (las
--          demás): copia cruda de cada informe (~75 KB por mes). Solo se reescribe si cambió el
--          contenido (compara el hash, no las fechas).
--      Si un informe no se puede descargar, conserva su copia anterior; si una marca entera falla,
--      las demás se sincronizan igual y el fallo queda anotado en su fila del estado.
--   2. pg_cron la ejecuta todos los días a las 06:20 de Lima (11:20 UTC).
--   3. El botón "Actualizar" del index.html llama a list_lr_suite_keyword_files(<marca>) (RPC) para
--      conocer los archivos de esa carpeta al instante, y descarga cada hoja directo de Google desde
--      el navegador.
--   El index.html interpreta los CSV con src/modules/analisis-palabras-clave/keyword-report.js y
--   aplica ahí la lista de campañas excluidas.
--
-- Requisito: cada carpeta y sus hojas deben estar compartidas como "Cualquier persona con el
-- enlace: Lector". Nexus puede compartir así lo que él mismo creó.
-- Egress: al abrir el módulo el navegador lee "keywords-status" y SOLO la fila de la marca que se
-- está mirando, y esa solo cuando cambió el hash. Con doce cuentas, traerlas todas en cada visita
-- serían más de diez megas para ver una.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── GET que sigue redirecciones ─────────────────────────────────────────────
-- Google responde 307 hacia googleusercontent.com al exportar; se sigue aquí por si la extensión no
-- lo hace sola.
create or replace function public.lr_suite_keywords_http_get(p_url text, p_timeout_ms integer default 15000)
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

-- ── Lista los informes de la carpeta ────────────────────────────────────────
-- Devuelve {"discovery": "drive-api" | "embeddedfolderview" | null, "files": [...], "errors": [...]}.
-- Cada archivo: {id, name, mimeType, modifiedTime}. Solo hojas de Google y CSV.
create or replace function public.lr_suite_keywords_list(p_folder text, p_timeout_ms integer default 15000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sheet constant text := 'application/vnd.google-apps.spreadsheet';
  v_key text;
  v_response extensions.http_response;
  v_files jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  -- 1. Drive API v3, solo si se guardó una key en Vault:
  --    select vault.create_secret('<API_KEY>', 'lr_suite_google_drive_api_key');
  begin
    select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'lr_suite_google_drive_api_key'
    limit 1;
  exception when others then
    v_key := null;
  end;

  if v_key is not null then
    begin
      v_response := public.lr_suite_keywords_http_get(
        'https://www.googleapis.com/drive/v3/files?q='
          || extensions.urlencode(format('''%s'' in parents and trashed = false', p_folder))
          || '&fields=files(id,name,mimeType,modifiedTime)&pageSize=1000&key=' || v_key,
        p_timeout_ms
      );
      if v_response.status = 200 then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', f ->> 'id',
                 'name', f ->> 'name',
                 'mimeType', f ->> 'mimeType',
                 'modifiedTime', f ->> 'modifiedTime'
               ) order by f ->> 'name'), '[]'::jsonb)
        into v_files
        from jsonb_array_elements(v_response.content::jsonb -> 'files') as f
        where f ->> 'mimeType' = v_sheet or f ->> 'mimeType' ilike '%csv%' or f ->> 'name' ilike '%.csv';
        return jsonb_build_object('discovery', 'drive-api', 'files', v_files, 'errors', v_errors);
      end if;
      v_errors := v_errors || to_jsonb('Drive API respondio ' || v_response.status);
    exception when others then
      v_errors := v_errors || to_jsonb('Drive API: ' || sqlerrm);
    end;
  end if;

  -- 2. Vista pública de la carpeta (sin credenciales mientras siga compartida por enlace).
  begin
    v_response := public.lr_suite_keywords_http_get(
      'https://drive.google.com/embeddedfolderview?id=' || p_folder,
      p_timeout_ms
    );
    if v_response.status = 200 then
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id,
               'name', replace(replace(replace(replace(replace(e.name, '&#39;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&amp;', '&'),
               'mimeType', coalesce(e.mime, ''),
               'modifiedTime', coalesce(e.modified, '')
             ) order by e.name), '[]'::jsonb)
      into v_files
      from (
        select substring(chunk from 'id="entry-([A-Za-z0-9_-]+)"') as id,
               btrim(substring(chunk from 'flip-entry-title">([^<]*)<')) as name,
               substring(chunk from '/type/([^"]+)"') as mime,
               btrim(substring(chunk from 'flip-entry-last-modified"><div>([^<]*)<')) as modified
        from unnest((string_to_array(v_response.content, 'class="flip-entry"'))[2:]) as chunk
      ) as e
      where e.id is not null
        and (e.mime = v_sheet or e.mime ilike '%csv%' or e.name ilike '%.csv');
      if jsonb_array_length(v_files) > 0 then
        return jsonb_build_object('discovery', 'embeddedfolderview', 'files', v_files, 'errors', v_errors);
      end if;
      v_errors := v_errors || to_jsonb('La vista publica de la carpeta no muestra hojas ni CSV. Revisa que siga compartida con "Cualquier persona con el enlace".'::text);
    else
      v_errors := v_errors || to_jsonb('La vista publica de la carpeta respondio ' || v_response.status);
    end if;
  exception when others then
    v_errors := v_errors || to_jsonb('Vista publica: ' || sqlerrm);
  end;

  return jsonb_build_object('discovery', null, 'files', '[]'::jsonb, 'errors', v_errors);
end;
$$;

-- ── Descarga un informe como CSV ───────────────────────────────────────────
create or replace function public.lr_suite_keywords_download(p_file jsonb)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_response extensions.http_response;
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
  -- Evita guardar una página de inicio de sesión o un archivo que no es el informe.
  if coalesce(v_response.content, '') !~* 'palabra clave' or coalesce(v_response.content, '') !~* 'campa' then
    raise exception 'no es un informe de palabras clave (faltan las columnas Palabra clave y Campaña)';
  end if;
  return v_response.content;
end;
$$;

-- ── Las marcas configuradas ────────────────────────────────────────────────
-- Una marca = una cuenta de Google Ads con su carpeta de informes en Drive. La cuenta de la agencia
-- ("lima-retail") conserva la clave "keywords" de siempre: así Pérdidas y Ganancias y las cachés que
-- ya tienen los navegadores siguen valiendo sin enterarse del cambio. Las demás guardan en
-- "keywords:<id>". El `folderId` suelto de la configuración anterior se lee como esa misma marca.
create or replace function public.lr_suite_keywords_marcas()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with config as (
    select payload from public.lr_suite_private_data where key = 'keywords-config'
  ),
  declaradas as (
    select value as marca from config, jsonb_array_elements(coalesce(payload -> 'marcas', '[]'::jsonb))
  ),
  todas as (
    select marca from declaradas
    union all
    select jsonb_build_object(
             'id', 'lima-retail',
             'nombre', 'Lima Retail',
             'folderId', (select payload ->> 'folderId' from config),
             'agencia', true
           )
    where coalesce((select payload ->> 'folderId' from config), '') <> ''
      and not exists (select 1 from declaradas where marca ->> 'id' = 'lima-retail')
  ),
  normalizadas as (
    select
      marca ->> 'id' as id,
      coalesce(nullif(marca ->> 'nombre', ''), marca ->> 'id') as nombre,
      marca ->> 'folderId' as folder_id,
      coalesce((marca ->> 'agencia')::boolean, marca ->> 'id' = 'lima-retail') as agencia
    from todas
    where coalesce(marca ->> 'id', '') <> '' and coalesce(marca ->> 'folderId', '') <> ''
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'nombre', nombre,
        'folderId', folder_id,
        'agencia', agencia,
        'dataKey', case when id = 'lima-retail' then 'keywords' else 'keywords:' || id end
      )
      order by agencia desc, nombre
    ),
    '[]'::jsonb
  )
  from normalizadas;
$$;

-- ── El estado anterior de una marca ────────────────────────────────────────
-- Antes de las marcas, el estado era una sola fila con sus campos sueltos: esa era la cuenta de la
-- agencia, y se lee así para no perder el hash ni la fecha del último cambio en la actualización.
create or replace function public.lr_suite_keywords_estado_marca(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.valor
      from public.lr_suite_private_data d,
           jsonb_array_elements(coalesce(d.payload -> 'marcas', '[]'::jsonb)) as m(valor)
      where d.key = 'keywords-status' and m.valor ->> 'id' = p_id
      limit 1
    ),
    (
      select d.payload
      from public.lr_suite_private_data d
      where d.key = 'keywords-status' and p_id = 'lima-retail' and d.payload -> 'marcas' is null
      limit 1
    )
  );
$$;

-- ── Sincronización de UNA marca ────────────────────────────────────────────
-- Devuelve su fila de estado. Si revienta, la llamada de arriba conserva la fila anterior y sigue
-- con las demás marcas.
create or replace function public.lr_suite_keywords_sync_marca(p_marca jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_marca ->> 'id';
  v_folder text := p_marca ->> 'folderId';
  v_key text := p_marca ->> 'dataKey';
  v_status jsonb;
  v_data jsonb;
  v_listing jsonb;
  v_files jsonb;
  v_discovery text;
  v_errors jsonb := '[]'::jsonb;
  v_file jsonb;
  v_previous text;
  v_reports jsonb := '[]'::jsonb;
  v_manifest jsonb := '[]'::jsonb;
  v_hash text;
  v_changed boolean;
begin
  if coalesce(v_folder, '') = '' then
    raise exception 'La marca % no tiene carpeta de Drive', v_id;
  end if;
  v_status := public.lr_suite_keywords_estado_marca(v_id);
  select payload into v_data from public.lr_suite_private_data where key = v_key;

  v_listing := public.lr_suite_keywords_list(v_folder);
  v_errors := v_errors || coalesce(v_listing -> 'errors', '[]'::jsonb);
  v_files := coalesce(v_listing -> 'files', '[]'::jsonb);
  v_discovery := v_listing ->> 'discovery';

  -- 3. Si no se pudo listar, el último manifiesto guardado.
  if jsonb_array_length(v_files) = 0 then
    if v_status ->> 'folderId' = v_folder and jsonb_array_length(coalesce(v_status -> 'files', '[]'::jsonb)) > 0 then
      v_files := (
        select jsonb_agg(f - 'status')
        from jsonb_array_elements(v_status -> 'files') as f
      );
      v_discovery := 'manifest';
    else
      raise exception 'No se pudo listar la carpeta de Drive de %: %', p_marca ->> 'nombre', v_errors;
    end if;
  end if;

  for v_file in select value from jsonb_array_elements(v_files) loop
    begin
      v_reports := v_reports || jsonb_build_object(
        'id', v_file ->> 'id',
        'name', v_file ->> 'name',
        'mimeType', v_file ->> 'mimeType',
        'csv', public.lr_suite_keywords_download(v_file)
      );
      v_manifest := v_manifest || (v_file || jsonb_build_object('status', 'ok'));
    exception when others then
      -- Un informe que falla conserva su copia anterior.
      v_previous := (
        select f ->> 'csv'
        from jsonb_array_elements(coalesce(v_data -> 'files', '[]'::jsonb)) as f
        where f ->> 'id' = v_file ->> 'id'
        limit 1
      );
      v_errors := v_errors || to_jsonb(format('%s: %s', v_file ->> 'name', sqlerrm));
      if v_previous is not null then
        v_reports := v_reports || jsonb_build_object(
          'id', v_file ->> 'id',
          'name', v_file ->> 'name',
          'mimeType', v_file ->> 'mimeType',
          'csv', v_previous
        );
        v_manifest := v_manifest || (v_file || jsonb_build_object('status', 'anterior'));
      else
        v_manifest := v_manifest || (v_file || jsonb_build_object('status', 'error'));
      end if;
    end;
  end loop;

  if jsonb_array_length(v_reports) = 0 then
    raise exception 'No se pudo descargar ningun informe de %: %', p_marca ->> 'nombre', v_errors;
  end if;

  -- Compara sin marcas de tiempo (la vista pública muestra "10:12 pm" hoy y una fecha mañana):
  -- id, nombre y contenido de cada informe.
  select md5(string_agg(
           (f ->> 'id') || '|' || coalesce(f ->> 'name', '') || '|' || coalesce(f ->> 'csv', ''),
           '||' order by f ->> 'id'))
  into v_hash
  from jsonb_array_elements(v_reports) as f;
  v_changed := v_hash is distinct from (v_status ->> 'contentHash');

  if v_changed then
    insert into public.lr_suite_private_data (key, payload, updated_at)
    values (v_key, jsonb_build_object(
      'schemaVersion', 1,
      'marca', v_id,
      'contentHash', v_hash,
      'lastChange', now(),
      'files', v_reports
    ), now())
    on conflict (key) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'nombre', p_marca ->> 'nombre',
    'folderId', v_folder,
    'dataKey', v_key,
    'agencia', coalesce((p_marca ->> 'agencia')::boolean, false),
    'discovery', v_discovery,
    'lastSync', now(),
    'lastChange', case when v_changed then to_jsonb(now()) else coalesce(v_status -> 'lastChange', to_jsonb(now())) end,
    'contentHash', v_hash,
    'changed', v_changed,
    'files', v_manifest,
    'errors', v_errors
  );
end;
$$;

-- ── Sincronización completa (cron diario) ──────────────────────────────────
-- Recorre todas las marcas, o solo una si se la nombra. Una marca caída no detiene a las demás: su
-- fila de estado anterior se conserva y el fallo queda anotado.
-- La firma cambió (antes dos parámetros): se borra la anterior para que la llamada del cron no
-- quede ambigua.
drop function if exists public.lr_suite_keywords_refresh(text, text);

create or replace function public.lr_suite_keywords_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null,
  p_marca text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marcas jsonb := public.lr_suite_keywords_marcas();
  v_marca jsonb;
  v_estado jsonb;
  v_anterior jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_ok integer := 0;
  v_agencia jsonb;
  v_status jsonb;
begin
  if jsonb_array_length(v_marcas) = 0 then
    raise exception 'No hay ninguna marca configurada: select public.lr_suite_keywords_set_marca(''<id>'', ''<Nombre>'', ''<ID_DE_LA_CARPETA>'');';
  end if;
  if p_marca is not null and not exists (
    select 1 from jsonb_array_elements(v_marcas) where value ->> 'id' = p_marca
  ) then
    raise exception 'No hay ninguna marca con el id %', p_marca;
  end if;

  for v_marca in select value from jsonb_array_elements(v_marcas) loop
    v_anterior := public.lr_suite_keywords_estado_marca(v_marca ->> 'id');
    if p_marca is null or p_marca = v_marca ->> 'id' then
      begin
        v_estado := public.lr_suite_keywords_sync_marca(v_marca);
        v_ok := v_ok + 1;
      exception when others then
        v_errors := v_errors || to_jsonb(format('%s: %s', v_marca ->> 'nombre', sqlerrm));
        v_estado := coalesce(v_anterior, v_marca) || jsonb_build_object('error', sqlerrm);
      end;
    else
      -- Marca que no tocaba en esta corrida: se conserva tal cual estaba.
      v_estado := coalesce(v_anterior, v_marca);
    end if;
    -- El nombre y la carpeta mandan desde la configuración, también en la fila conservada.
    v_estado := v_estado || jsonb_build_object(
      'id', v_marca ->> 'id',
      'nombre', v_marca ->> 'nombre',
      'folderId', v_marca ->> 'folderId',
      'dataKey', v_marca ->> 'dataKey',
      'agencia', coalesce((v_marca ->> 'agencia')::boolean, false)
    );
    v_resultados := v_resultados || jsonb_build_array(v_estado);
  end loop;

  if v_ok = 0 then
    raise exception 'Ninguna marca se pudo sincronizar: %', v_errors;
  end if;

  select value into v_agencia
  from jsonb_array_elements(v_resultados)
  where coalesce((value ->> 'agencia')::boolean, false)
  limit 1;

  v_status := jsonb_build_object(
    'schemaVersion', 2,
    'source', 'Google Drive · Informes de palabras clave de Google Ads por marca',
    'lastSync', now(),
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'marcas', v_resultados,
    'errors', v_errors
  );
  -- Los campos sueltos de la cuenta de la agencia se conservan arriba del todo: un navegador que
  -- todavía tenga el index.html anterior sigue leyendo de ahí y no se queda en blanco.
  v_status := coalesce(v_agencia - 'id' - 'nombre' - 'agencia' - 'dataKey', '{}'::jsonb) || v_status;

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('keywords-status', v_status, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_status;
end;
$$;

-- ── RPC del botón "Actualizar": archivos actuales de la carpeta de la marca ─
-- Una sola petición a Google (cabe en el statement_timeout de la API). Si no se puede listar,
-- devuelve el último manifiesto de esa marca. El navegador descarga cada hoja directo de Google.
-- Sin marca contesta por la cuenta de la agencia, como antes.
drop function if exists public.list_lr_suite_keyword_files();

create or replace function public.list_lr_suite_keyword_files(p_marca text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marca jsonb;
  v_listing jsonb;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'Sin permiso para leer la carpeta de palabras clave' using errcode = '42501';
  end if;

  select value into v_marca
  from jsonb_array_elements(public.lr_suite_keywords_marcas())
  where case
          when p_marca is null then coalesce((value ->> 'agencia')::boolean, false)
          else value ->> 'id' = p_marca
        end
  limit 1;
  if v_marca is null then
    raise exception 'Falta configurar la carpeta de Drive en Supabase' using errcode = 'P0001';
  end if;

  v_listing := public.lr_suite_keywords_list(v_marca ->> 'folderId', 6000);
  if jsonb_array_length(coalesce(v_listing -> 'files', '[]'::jsonb)) > 0 then
    return jsonb_build_object(
      'marca', v_marca ->> 'id',
      'nombre', v_marca ->> 'nombre',
      'folderId', v_marca ->> 'folderId',
      'discovery', v_listing ->> 'discovery',
      'files', v_listing -> 'files',
      'errors', v_listing -> 'errors'
    );
  end if;

  return jsonb_build_object(
    'marca', v_marca ->> 'id',
    'nombre', v_marca ->> 'nombre',
    'folderId', v_marca ->> 'folderId',
    'discovery', 'manifest',
    'files', coalesce(public.lr_suite_keywords_estado_marca(v_marca ->> 'id') -> 'files', '[]'::jsonb),
    'errors', v_listing -> 'errors'
  );
end;
$$;

-- ── Alta de una marca (solo desde el SQL Editor) ───────────────────────────
-- Guarda id, nombre y carpeta en lr_suite_private_data "keywords-config" y sincroniza esa marca.
-- El id es el que viaja en la clave de los datos y en el filtro de la pantalla: minúsculas y
-- guiones, sin tildes ni espacios (royal-baby, tierra-films…).
create or replace function public.lr_suite_keywords_set_marca(p_id text, p_nombre text, p_folder text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_marcas jsonb;
begin
  if coalesce(p_id, '') !~ '^[a-z0-9][a-z0-9-]{1,40}$' then
    raise exception 'Id de marca no valido (minusculas, numeros y guiones): %', p_id;
  end if;
  if coalesce(p_nombre, '') = '' then
    raise exception 'Falta el nombre de la marca';
  end if;
  if coalesce(p_folder, '') !~ '^[A-Za-z0-9_-]{10,}$' then
    raise exception 'ID de carpeta no valido: %', p_folder;
  end if;

  select coalesce(payload, '{}'::jsonb) into v_config from public.lr_suite_private_data where key = 'keywords-config';
  v_config := coalesce(v_config, '{}'::jsonb);
  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_marcas
  from jsonb_array_elements(coalesce(v_config -> 'marcas', '[]'::jsonb))
  where value ->> 'id' <> p_id;
  v_marcas := v_marcas || jsonb_build_array(jsonb_build_object(
    'id', p_id,
    'nombre', p_nombre,
    'folderId', p_folder,
    'agencia', p_id = 'lima-retail'
  ));
  v_config := v_config || jsonb_build_object('marcas', v_marcas);
  -- La cuenta de la agencia mantiene además el campo suelto de la configuración anterior.
  if p_id = 'lima-retail' then
    v_config := v_config || jsonb_build_object('folderId', p_folder);
  end if;

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('keywords-config', v_config, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return public.lr_suite_keywords_refresh('instalacion', null, p_id);
end;
$$;

-- Baja de una marca: sale de la configuración y se borra su copia de los informes.
create or replace function public.lr_suite_keywords_quitar_marca(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_marcas jsonb;
begin
  select coalesce(payload, '{}'::jsonb) into v_config from public.lr_suite_private_data where key = 'keywords-config';
  if v_config is null then
    raise exception 'No hay ninguna marca configurada';
  end if;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_marcas
  from jsonb_array_elements(coalesce(v_config -> 'marcas', '[]'::jsonb))
  where value ->> 'id' <> p_id;
  v_config := v_config || jsonb_build_object('marcas', v_marcas);
  if p_id = 'lima-retail' then
    v_config := v_config - 'folderId';
  end if;

  update public.lr_suite_private_data
     set payload = v_config, updated_at = now()
   where key = 'keywords-config';
  delete from public.lr_suite_private_data
   where key = case when p_id = 'lima-retail' then 'keywords' else 'keywords:' || p_id end;

  return public.lr_suite_keywords_marcas();
end;
$$;

-- Compatibilidad: la instalación anterior daba de alta la carpeta de la agencia con esta función.
create or replace function public.lr_suite_keywords_set_folder(p_folder text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.lr_suite_keywords_set_marca('lima-retail', 'Lima Retail', p_folder);
end;
$$;

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira.
revoke execute on function public.lr_suite_keywords_http_get(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_list(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_download(jsonb) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_marcas() from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_estado_marca(text) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_sync_marca(jsonb) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_refresh(text, text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_set_marca(text, text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_quitar_marca(text) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_set_folder(text) from public, anon, authenticated;
revoke execute on function public.list_lr_suite_keyword_files(text) from public, anon;
grant execute on function public.list_lr_suite_keyword_files(text) to authenticated;

-- ── Actualizacion diaria: 06:20 de Lima (UTC-5, sin horario de verano) ─────
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-keywords-daily',
  '20 11 * * *',
  $cron$select public.lr_suite_keywords_refresh('automatica')$cron$
);

-- ── Paso final: dar de alta cada marca (NO se guarda en el repo) ───────────
-- Una línea por cuenta de Google Ads, con el id de la carpeta de Drive donde Nexus deja sus
-- informes de palabras clave. La cuenta de la agencia es siempre 'lima-retail'.
--   select public.lr_suite_keywords_set_marca('lima-retail', 'Lima Retail', '<ID_DE_LA_CARPETA>') ->> 'lastSync';
--   select public.lr_suite_keywords_set_marca('royal-baby', 'Royal Baby', '<ID_DE_LA_CARPETA>') ->> 'lastSync';
-- Para ver las que hay:   select public.lr_suite_keywords_marcas();
-- Para quitar una:        select public.lr_suite_keywords_quitar_marca('<id>');

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Cómo quedó cada marca en la última sincronización:
--   select m ->> 'nombre' as marca, m ->> 'lastSync' as sincronizada, m ->> 'discovery' as listado,
--          m ->> 'changed' as hubo_cambios, jsonb_array_length(coalesce(m -> 'files', '[]'::jsonb)) as archivos,
--          m -> 'errors' as avisos, m ->> 'error' as fallo
--   from public.lr_suite_private_data d, jsonb_array_elements(d.payload -> 'marcas') as m
--   where d.key = 'keywords-status';
-- Lo que pesa cada copia de informes:
--   select key, pg_size_pretty(length(payload::text)::bigint) as peso
--   from public.lr_suite_private_data where key = 'keywords' or key like 'keywords:%' order by key;
-- Ultimas ejecuciones del cron:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-keywords-daily')
--   order by start_time desc limit 5;
-- Forzar una sincronizacion ahora:
--   select public.lr_suite_keywords_refresh('manual') ->> 'changed' as hubo_cambios;
-- Desinstalar el cron:
--   select cron.unschedule('lr-suite-keywords-daily');
