-- ============================================================================
-- Análisis de Palabras Clave: sincronización con la carpeta de Google Drive
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Fuente: carpeta de Drive con un "Informe de palabras clave de búsqueda" de Google Ads por mes
-- (hojas de Google Sheets o CSV). El ID de la carpeta NO está en este archivo ni en el index.html,
-- que son públicos: se guarda en Supabase con lr_suite_keywords_set_folder() (ver el final).
--
-- Cómo funciona:
--   1. lr_suite_keywords_refresh() lista la carpeta (Drive API con una key guardada en Vault, si existe;
--      si no, la vista pública embeddedfolderview; si falla, el último manifiesto), descarga cada
--      informe como CSV y guarda:
--        - lr_suite_private_data "keywords-status": manifiesto, fecha de la sincronización, hash del
--          contenido y avisos (~4 KB). Se reescribe en cada ejecución.
--        - lr_suite_private_data "keywords": copia cruda de cada informe (~75 KB por mes). Solo se
--          reescribe si cambió el contenido (compara el hash, no las fechas).
--      Si un informe no se puede descargar, conserva su copia anterior.
--   2. pg_cron la ejecuta todos los días a las 06:20 de Lima (11:20 UTC).
--   3. El botón "Actualizar" del index.html llama a list_lr_suite_keyword_files() (RPC) para conocer
--      los archivos de la carpeta al instante, y descarga cada hoja directo de Google desde el navegador.
--   El index.html interpreta los CSV con src/modules/analisis-palabras-clave/keyword-report.js y
--   aplica ahí la lista de campañas excluidas.
--
-- Requisito: la carpeta y sus hojas deben seguir compartidas como "Cualquier persona con el enlace".
-- Egress: al abrir el módulo el navegador lee "keywords-status"; "keywords" solo cuando cambió el hash.
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

-- ── Sincronización completa (cron diario) ──────────────────────────────────
create or replace function public.lr_suite_keywords_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder text;
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
  select payload ->> 'folderId' into v_folder from public.lr_suite_private_data where key = 'keywords-config';
  if coalesce(v_folder, '') = '' then
    raise exception 'Falta configurar la carpeta de Drive: select public.lr_suite_keywords_set_folder(''<ID>'');';
  end if;
  select payload into v_status from public.lr_suite_private_data where key = 'keywords-status';
  select payload into v_data from public.lr_suite_private_data where key = 'keywords';

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
      raise exception 'No se pudo listar la carpeta de Drive: %', v_errors;
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
    raise exception 'No se pudo descargar ningun informe: %', v_errors;
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
    values ('keywords', jsonb_build_object(
      'schemaVersion', 1,
      'contentHash', v_hash,
      'lastChange', now(),
      'files', v_reports
    ), now())
    on conflict (key) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at;
  end if;

  v_status := jsonb_build_object(
    'schemaVersion', 1,
    'source', 'Google Drive · Informes de palabras clave de Google Ads',
    'folderId', v_folder,
    'discovery', v_discovery,
    'lastSync', now(),
    'lastChange', case when v_changed then to_jsonb(now()) else coalesce(v_status -> 'lastChange', to_jsonb(now())) end,
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'contentHash', v_hash,
    'changed', v_changed,
    'files', v_manifest,
    'errors', v_errors
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('keywords-status', v_status, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_status;
end;
$$;

-- ── RPC del botón "Actualizar": archivos actuales de la carpeta ────────────
-- Una sola petición a Google (cabe en el statement_timeout de la API). Si no se puede listar,
-- devuelve el último manifiesto. El navegador descarga cada hoja directo de Google.
create or replace function public.list_lr_suite_keyword_files()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder text;
  v_listing jsonb;
  v_status jsonb;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'Sin permiso para leer la carpeta de palabras clave' using errcode = '42501';
  end if;

  select payload ->> 'folderId' into v_folder from public.lr_suite_private_data where key = 'keywords-config';
  if coalesce(v_folder, '') = '' then
    raise exception 'Falta configurar la carpeta de Drive en Supabase' using errcode = 'P0001';
  end if;

  v_listing := public.lr_suite_keywords_list(v_folder, 6000);
  if jsonb_array_length(coalesce(v_listing -> 'files', '[]'::jsonb)) > 0 then
    return jsonb_build_object(
      'folderId', v_folder,
      'discovery', v_listing ->> 'discovery',
      'files', v_listing -> 'files',
      'errors', v_listing -> 'errors'
    );
  end if;

  select payload into v_status from public.lr_suite_private_data where key = 'keywords-status';
  return jsonb_build_object(
    'folderId', v_folder,
    'discovery', 'manifest',
    'files', coalesce(v_status -> 'files', '[]'::jsonb),
    'errors', v_listing -> 'errors'
  );
end;
$$;

-- ── Configuración de la carpeta (solo desde el SQL Editor) ─────────────────
-- Guarda el ID en lr_suite_private_data "keywords-config" y hace la primera sincronización.
create or replace function public.lr_suite_keywords_set_folder(p_folder text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_folder, '') !~ '^[A-Za-z0-9_-]{10,}$' then
    raise exception 'ID de carpeta no valido: %', p_folder;
  end if;
  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('keywords-config', jsonb_build_object('folderId', p_folder), now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;
  return public.lr_suite_keywords_refresh('instalacion');
end;
$$;

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira.
revoke execute on function public.lr_suite_keywords_http_get(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_list(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_download(jsonb) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_refresh(text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_keywords_set_folder(text) from public, anon, authenticated;
revoke execute on function public.list_lr_suite_keyword_files() from public, anon;
grant execute on function public.list_lr_suite_keyword_files() to authenticated;

-- ── Actualizacion diaria: 06:20 de Lima (UTC-5, sin horario de verano) ─────
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-keywords-daily',
  '20 11 * * *',
  $cron$select public.lr_suite_keywords_refresh('automatica')$cron$
);

-- ── Paso final (una sola vez, NO se guarda en el repo) ─────────────────────
-- Reemplaza <ID_DE_LA_CARPETA> por el ID de la carpeta de Drive y ejecuta esta línea sola:
--   select public.lr_suite_keywords_set_folder('<ID_DE_LA_CARPETA>') ->> 'lastSync' as primera_sincronizacion;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Ultima sincronizacion, origen del listado y avisos:
--   select payload ->> 'lastSync' as sincronizado, payload ->> 'discovery' as listado,
--          payload ->> 'changed' as hubo_cambios, jsonb_array_length(payload -> 'files') as archivos,
--          payload -> 'errors' as avisos
--   from public.lr_suite_private_data where key = 'keywords-status';
-- Ultimas ejecuciones del cron:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-keywords-daily')
--   order by start_time desc limit 5;
-- Forzar una sincronizacion ahora:
--   select public.lr_suite_keywords_refresh('manual') ->> 'changed' as hubo_cambios;
-- Desinstalar el cron:
--   select cron.unschedule('lr-suite-keywords-daily');
