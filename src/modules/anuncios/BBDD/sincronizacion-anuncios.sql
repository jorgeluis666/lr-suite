-- ============================================================================
-- Anuncios: sincronización con Google Sheets y Google Drive
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Fuente, por marca, dentro de su carpeta en "02_Clientes de la agencia":
--   01 Meta Ads/  una hoja de Google por mes, pestaña "Raw Data Report" (export de Meta Ads)
--   06 Artes/     una subcarpeta por campaña, y dentro la pieza de cada anuncio:
--                 un archivo suelto (video o imagen), o una subcarpeta "<anuncio> (Carrusel)"
--                 con una imagen por lámina.
-- Los IDs de esas carpetas NO estan en este archivo ni en el index.html, que son publicos: se
-- guardan en Supabase con lr_suite_ads_set_brand() (ver el final).
--
-- Como funciona:
--   1. El export trae una fila por dia, edad y sexo: para octubre de Royal Baby son 2.121 filas y
--      unos 700 KB. No se descarga entero: el Web App de apps-script/Codigo.gs lo suma por anuncio
--      y devuelve unas decenas de filas (~10 KB).
--   2. El mismo Web App lista las campañas de "06 Artes" y sus piezas.
--   3. Cada anuncio se empareja con su pieza por el nombre, ignorando mayusculas, acentos y signos:
--      el del archivo sin extension, o el de la subcarpeta sin el "(Carrusel)" del final. Un anuncio
--      sin pieza queda con "creativo": null y el modulo lo muestra igual, con el hueco a la vista.
--   4. El resultado se guarda en lr_suite_private_data, clave "ads". Si no cambio nada, no se
--      reescribe la fila (se compara un hash), asi el modulo no vuelve a descargarla.
--   5. pg_cron la ejecuta todos los dias a las 06:40 de Lima (11:40 UTC), despues de Pérdidas y
--      Ganancias (06:00) y Palabras clave (06:20).
--   6. El boton "Actualizar" del modulo llama a sync_lr_suite_ads(), que solo pueden usar Jorge Luis
--      y Diego (is_lr_suite_pending_user()).
--
-- Lectura: las carpetas de cliente estan en "Restringido" a proposito, asi que Drive no se puede
-- leer sin credenciales. Todo pasa por el Web App de apps-script/Codigo.gs, que corre con la cuenta
-- dueña de las carpetas; su URL y su token se guardan una vez con lr_suite_ads_set_endpoint(). Las
-- miniaturas y los videos si los pide el navegador a Drive, con la sesion de Google de quien mira el
-- tablero: solo se ven si esa cuenta tiene acceso a la carpeta de la marca.
-- Egress: el navegador lee una sola fila (~12 KB por marca y mes) al iniciar sesion.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── GET que sigue redirecciones ─────────────────────────────────────────────
-- Google responde 307 hacia googleusercontent.com al exportar; se sigue aqui por si la extension no
-- lo hace sola.
create or replace function public.lr_suite_ads_http_get(p_url text, p_timeout_ms integer default 20000)
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

-- ── Clave con la que se emparejan anuncio y pieza ───────────────────────────
-- "40% OFF - Daniela.mp4" y "40% OFF Daniela" tienen que caer en la misma clave: se quita la
-- extension, el "(Carrusel)" del final, los acentos y todo lo que no sea letra o numero.
create or replace function public.lr_suite_ads_key(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    lower(translate(
      regexp_replace(
        regexp_replace(coalesce(p_name, ''), '\s*\((carrusel|carousel)\)\s*$', '', 'i'),
        '\.(mp4|mov|m4v|webm|png|jpe?g|gif|webp)$', '', 'i'
      ),
      'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
    )),
    '[^a-z0-9]+', '', 'g'
  );
$$;

-- ── Mes de una hoja, a partir de su nombre ─────────────────────────────────
-- "Royal Baby - Octubre 2026" -> "2026-10". Sirve para quedarse con los meses mas nuevos: por
-- nombre no se puede, porque en alfabetico Septiembre va despues de Octubre. Devuelve '' si el
-- nombre no dice el mes, y entonces esa hoja queda al final.
create or replace function public.lr_suite_ads_month_key(p_name text)
returns text
language sql
immutable
as $$
  with limpio as (
    select lower(translate(coalesce(p_name, ''),
      'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) as texto
  ),
  mes as (
    select case
      when texto like '%enero%' then '01'
      when texto like '%febrero%' then '02'
      when texto like '%marzo%' then '03'
      when texto like '%abril%' then '04'
      when texto like '%mayo%' then '05'
      when texto like '%junio%' then '06'
      when texto like '%julio%' then '07'
      when texto like '%agosto%' then '08'
      when texto like '%septiembre%' or texto like '%setiembre%' then '09'
      when texto like '%octubre%' then '10'
      when texto like '%noviembre%' then '11'
      when texto like '%diciembre%' then '12'
    end as numero,
    substring(texto from '(20[0-9]{2})') as anio
    from limpio
  )
  select case when numero is null or anio is null then '' else anio || '-' || numero end from mes;
$$;

-- ── El Web App que lee Drive ────────────────────────────────────────────────
-- Devuelve {url, token} de la clave "ads-config". Se guardan una vez con
-- lr_suite_ads_set_endpoint(): ni la URL ni el token van en este archivo, que es publico.
create or replace function public.lr_suite_ads_endpoint()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
begin
  select payload into v_config from public.lr_suite_private_data where key = 'ads-config';
  if coalesce(v_config ->> 'endpoint', '') = '' or coalesce(v_config ->> 'token', '') = '' then
    raise exception 'Falta el Web App de Drive: select public.lr_suite_ads_set_endpoint(''<URL /exec>'', ''<TOKEN>'');';
  end if;
  return jsonb_build_object('url', v_config ->> 'endpoint', 'token', v_config ->> 'token');
end;
$$;

-- GET al Web App con una accion y un id. Devuelve el JSON ya parseado y levanta excepcion si el
-- script responde {ok:false} o algo que no es JSON.
create or replace function public.lr_suite_ads_call(
  p_accion text,
  p_id text,
  p_timeout_ms integer default 25000
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_endpoint jsonb := public.lr_suite_ads_endpoint();
  v_response extensions.http_response;
  v_json jsonb;
begin
  v_response := public.lr_suite_ads_http_get(
    (v_endpoint ->> 'url')
      || '?accion=' || extensions.urlencode(p_accion)
      || '&id=' || extensions.urlencode(p_id)
      || '&token=' || extensions.urlencode(v_endpoint ->> 'token'),
    p_timeout_ms
  );
  if v_response.status <> 200 then
    raise exception 'El Web App de Drive respondio %', v_response.status;
  end if;

  begin
    v_json := coalesce(v_response.content, '')::jsonb;
  exception when others then
    raise exception 'El Web App de Drive no devolvio JSON. Revisa que la implementacion siga publicada.';
  end;

  if coalesce(v_json ->> 'ok', '') <> 'true' then
    raise exception 'El Web App de Drive no pudo leer %: %', p_id, coalesce(v_json ->> 'error', 'sin detalle');
  end if;
  return v_json;
end;
$$;

-- ── Lista una carpeta de Drive ──────────────────────────────────────────────
-- Devuelve [{id, name, tipo}] ordenado por nombre, con tipo 'carpeta', 'hoja', 'video', 'imagen' u
-- 'otro'. Devuelve el array vacio si no se pudo leer: una carpeta ilegible deja a la marca sin
-- meses o sin piezas, pero no tumba la sincronizacion de las demas.
create or replace function public.lr_suite_ads_list_folder(p_folder text, p_timeout_ms integer default 20000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(p_folder, '') !~ '^[A-Za-z0-9_-]{10,}$' then
    return '[]'::jsonb;
  end if;
  return coalesce(public.lr_suite_ads_call('carpeta', p_folder, p_timeout_ms) -> 'archivos', '[]'::jsonb);
exception when others then
  return '[]'::jsonb;
end;
$$;

-- ── Anuncios de una hoja, ya sumados por el Web App ─────────────────────────
-- El script agrupa por "Nombre del anuncio" y suma las metricas, asi no se descargan las miles de
-- filas que trae el export partido por dia, edad y sexo. Busca las columnas por su cabecera, no por
-- su letra: Meta renombra alguna entre descargas y una hoja reconstruida desde la API trae menos
-- columnas y en otro orden. Devuelve [{nombre, campana, conjunto, tipoResultado, preview, desde,
-- hasta, gasto, impresiones, clics, interacciones, compras, ingresos, conversaciones, resultados}].
-- Levanta excepcion si la hoja no es un export de Meta: ese mes queda como aviso y no se guarda.
create or replace function public.lr_suite_ads_sheet_rows(p_sheet text, p_timeout_ms integer default 25000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows jsonb;
begin
  v_rows := coalesce(public.lr_suite_ads_call('hoja', p_sheet, p_timeout_ms) -> 'anuncios', '[]'::jsonb);
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'El Web App de Drive devolvio los anuncios en un formato inesperado';
  end if;

  -- Se descartan las filas sin nombre: el modulo empareja la pieza por ese nombre.
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(v_rows)
  where btrim(coalesce(value ->> 'nombre', '')) <> '';

  return v_rows;
end;
$$;

-- ── Piezas de "06 Artes", por clave de nombre ───────────────────────────────
-- Recorre las campañas y arma {"<clave>": {creativo}}. Una subcarpeta que termina en "(Carrusel)"
-- es un anuncio de formato carrusel: se guardan sus laminas. Hoy las laminas no traen numero en el
-- nombre, asi que van ordenadas alfabeticamente y marcadas con ordenIncierto.
create or replace function public.lr_suite_ads_creatives(p_artes text, p_timeout_ms integer default 20000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaigns jsonb;
  v_campaign jsonb;
  v_entries jsonb;
  v_entry jsonb;
  v_slides jsonb;
  v_map jsonb := '{}'::jsonb;
  v_requests integer := 0;
begin
  v_campaigns := public.lr_suite_ads_list_folder(p_artes, p_timeout_ms);
  v_requests := v_requests + 1;

  for v_campaign in select value from jsonb_array_elements(v_campaigns) loop
    -- Una pieza suelta en la raiz de "06 Artes" tambien vale.
    if v_campaign ->> 'tipo' <> 'carpeta' then
      continue when (v_campaign ->> 'tipo') not in ('video', 'imagen');
      v_map := jsonb_build_object(
        public.lr_suite_ads_key(v_campaign ->> 'name'),
        jsonb_build_object('tipo', v_campaign ->> 'tipo', 'nombre', v_campaign ->> 'name', 'archivoId', v_campaign ->> 'id', 'campana', '')
      ) || v_map;
      continue;
    end if;

    exit when v_requests > 40; -- tope para que una carpeta enorme no deje el cron colgado
    v_entries := public.lr_suite_ads_list_folder(v_campaign ->> 'id', p_timeout_ms);
    v_requests := v_requests + 1;

    for v_entry in select value from jsonb_array_elements(v_entries) loop
      if v_entry ->> 'tipo' = 'carpeta' then
        -- Solo una subcarpeta "(Carrusel)" es un anuncio; cualquier otra se ignora.
        continue when (v_entry ->> 'name') !~* '\((carrusel|carousel)\)\s*$';
        exit when v_requests > 40;
        v_slides := public.lr_suite_ads_list_folder(v_entry ->> 'id', p_timeout_ms);
        v_requests := v_requests + 1;
        v_map := jsonb_build_object(
          public.lr_suite_ads_key(v_entry ->> 'name'),
          jsonb_build_object(
            'tipo', 'carrusel',
            'nombre', v_entry ->> 'name',
            'carpetaId', v_entry ->> 'id',
            'campana', v_campaign ->> 'name',
            'ordenIncierto', true,
            'laminas', (
              select coalesce(jsonb_agg(s ->> 'id' order by s ->> 'name'), '[]'::jsonb)
              from jsonb_array_elements(v_slides) as s
              where s ->> 'tipo' = 'imagen'
            )
          )
        ) || v_map;
      elsif (v_entry ->> 'tipo') in ('video', 'imagen') then
        v_map := jsonb_build_object(
          public.lr_suite_ads_key(v_entry ->> 'name'),
          jsonb_build_object('tipo', v_entry ->> 'tipo', 'nombre', v_entry ->> 'name', 'archivoId', v_entry ->> 'id', 'campana', v_campaign ->> 'name')
        ) || v_map;
      end if;
    end loop;
  end loop;

  return v_map;
end;
$$;

-- ── Sincronizacion completa (cron diario y boton "Actualizar") ──────────────
create or replace function public.lr_suite_ads_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_brand jsonb;
  v_months integer;
  v_sheets jsonb;
  v_sheet jsonb;
  v_creatives jsonb;
  v_rows jsonb;
  v_ads jsonb;
  v_brand_months jsonb;
  v_brands jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_previous jsonb;
  v_hash text;
  v_changed boolean;
  v_count integer;
begin
  select payload into v_config from public.lr_suite_private_data where key = 'ads-config';
  if coalesce(jsonb_array_length(v_config -> 'marcas'), 0) = 0 then
    raise exception 'Falta configurar alguna marca: select public.lr_suite_ads_set_brand(''<marca>'', ''<ID 01 Meta Ads>'', ''<ID 06 Artes>'');';
  end if;
  -- Antes del bucle: si falta el Web App, el error se ve de una vez y no como "no se pudo leer
  -- ningun mes" en cada marca.
  perform public.lr_suite_ads_endpoint();

  for v_brand in select value from jsonb_array_elements(v_config -> 'marcas') loop
    begin
      v_months := greatest(1, least(coalesce((v_brand ->> 'meses')::integer, 3), 12));
      v_creatives := public.lr_suite_ads_creatives(v_brand ->> 'artesFolderId');
      v_sheets := public.lr_suite_ads_list_folder(v_brand ->> 'metaFolderId');
      v_brand_months := '[]'::jsonb;
      v_count := 0;

      -- Primero los meses mas nuevos, leyendo el mes del nombre de la hoja. Las que no dicen el mes
      -- quedan al final, para que no desplacen a una que si lo dice.
      for v_sheet in
        select value from jsonb_array_elements(v_sheets)
        where value ->> 'tipo' = 'hoja'
        order by public.lr_suite_ads_month_key(value ->> 'name') desc, value ->> 'name' desc
      loop
        exit when v_count >= v_months;
        begin
          v_rows := public.lr_suite_ads_sheet_rows(v_sheet ->> 'id');
          if jsonb_array_length(v_rows) = 0 then
            continue;
          end if;

          select jsonb_agg(
                   a || jsonb_build_object(
                     'creativo',
                     coalesce(v_creatives -> public.lr_suite_ads_key(a ->> 'nombre'), 'null'::jsonb)
                   )
                 )
          into v_ads
          from jsonb_array_elements(v_rows) as a;

          v_brand_months := v_brand_months || jsonb_build_object(
            'mes', nullif(public.lr_suite_ads_month_key(v_sheet ->> 'name'), ''),
            'etiqueta', v_sheet ->> 'name',
            'hoja', 'https://docs.google.com/spreadsheets/d/' || (v_sheet ->> 'id') || '/edit',
            'artes', 'https://drive.google.com/drive/folders/' || (v_brand ->> 'artesFolderId'),
            'anuncios', coalesce(v_ads, '[]'::jsonb)
          );
          v_count := v_count + 1;
        exception when others then
          v_errors := v_errors || to_jsonb(format('%s · %s: %s', v_brand ->> 'marca', v_sheet ->> 'name', sqlerrm));
        end;
      end loop;

      if jsonb_array_length(v_brand_months) = 0 then
        v_errors := v_errors || to_jsonb(format('%s: no se pudo leer ningun mes', v_brand ->> 'marca'));
      else
        v_brands := v_brands || jsonb_build_object('marca', v_brand ->> 'marca', 'meses', v_brand_months);
      end if;
    exception when others then
      v_errors := v_errors || to_jsonb(format('%s: %s', v_brand ->> 'marca', sqlerrm));
    end;
  end loop;

  if jsonb_array_length(v_brands) = 0 then
    raise exception 'No se pudo armar ninguna marca: %', v_errors;
  end if;

  -- Se compara sin la fecha de sincronizacion: si nada cambio, la fila no se reescribe y el modulo
  -- no vuelve a descargarla.
  v_hash := md5(v_brands::text);
  select payload into v_previous from public.lr_suite_private_data where key = 'ads';
  v_changed := v_hash is distinct from (v_previous ->> 'contentHash');

  v_payload := jsonb_build_object(
    'version', 1,
    'contentHash', v_hash,
    'updatedAt', now(),
    'lastChange', case when v_changed then to_jsonb(now()) else coalesce(v_previous -> 'lastChange', to_jsonb(now())) end,
    'changed', v_changed,
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'moneda', 'PEN',
    'errors', v_errors,
    'marcas', v_brands
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('ads', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  -- Se devuelve entero: el boton "Actualizar" lo usa tal cual y se ahorra una segunda lectura.
  return v_payload;
end;
$$;

-- ── RPC del boton "Actualizar" ──────────────────────────────────────────────
create or replace function public.sync_lr_suite_ads()
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
    raise exception 'Sin permiso para actualizar los anuncios' using errcode = '42501';
  end if;

  -- Doble clic o los dos usuarios a la vez: no se vuelve a pedir nada a Google si se actualizo hace
  -- menos de 30 segundos.
  select * into v_row from public.lr_suite_private_data where key = 'ads';
  if found and v_row.updated_at > now() - interval '30 seconds' then
    return v_row.payload;
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  return public.lr_suite_ads_refresh('manual', v_email);
end;
$$;

-- ── El Web App de Drive (una sola vez, desde el SQL Editor) ─────────────────
-- Guarda la URL /exec y el token del script en "ads-config", junto a las marcas. Hay que ejecutarla
-- antes de configurar la primera marca: sin esto no se puede leer Drive.
create or replace function public.lr_suite_ads_set_endpoint(p_url text, p_token text)
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

  select payload into v_config from public.lr_suite_private_data where key = 'ads-config';
  v_config := coalesce(v_config, '{}'::jsonb) || jsonb_build_object('endpoint', p_url, 'token', p_token);

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('ads-config', v_config, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  -- No muestra el token: esta consulta se ejecuta en el editor y su resultado queda a la vista.
  return jsonb_build_object(
    'endpoint', p_url,
    'marcas', coalesce(jsonb_array_length(v_config -> 'marcas'), 0)
  );
end;
$$;

-- ── Configuracion de las marcas (solo desde el SQL Editor) ──────────────────
-- Guarda los IDs en lr_suite_private_data "ads-config". p_meses es cuantos meses se guardan de esa
-- marca, de los mas nuevos hacia atras (3 por defecto): cada mes son unos 12 KB.
create or replace function public.lr_suite_ads_set_brand(
  p_marca text,
  p_meta_folder text,
  p_artes_folder text,
  p_meses integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_brands jsonb;
begin
  if coalesce(btrim(p_marca), '') = '' then
    raise exception 'Falta el nombre de la marca';
  end if;
  if coalesce(p_meta_folder, '') !~ '^[A-Za-z0-9_-]{10,}$'
    or coalesce(p_artes_folder, '') !~ '^[A-Za-z0-9_-]{10,}$' then
    raise exception 'Alguno de los dos IDs de carpeta no es valido';
  end if;

  select payload into v_config from public.lr_suite_private_data where key = 'ads-config';
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_brands
  from jsonb_array_elements(coalesce(v_config -> 'marcas', '[]'::jsonb))
  where value ->> 'marca' is distinct from btrim(p_marca);

  v_brands := v_brands || jsonb_build_object(
    'marca', btrim(p_marca),
    'metaFolderId', p_meta_folder,
    'artesFolderId', p_artes_folder,
    'meses', greatest(1, least(coalesce(p_meses, 3), 12))
  );

  -- Se conserva el resto de la configuracion (la URL y el token del Web App).
  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('ads-config', coalesce(v_config, '{}'::jsonb) || jsonb_build_object('marcas', v_brands), now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return public.lr_suite_ads_refresh('instalacion');
end;
$$;

create or replace function public.lr_suite_ads_remove_brand(p_marca text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_brands jsonb;
begin
  select payload into v_config from public.lr_suite_private_data where key = 'ads-config';
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_brands
  from jsonb_array_elements(coalesce(v_config -> 'marcas', '[]'::jsonb))
  where value ->> 'marca' is distinct from btrim(p_marca);

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('ads-config', coalesce(v_config, '{}'::jsonb) || jsonb_build_object('marcas', v_brands), now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return jsonb_build_object('marcas', jsonb_array_length(v_brands));
end;
$$;

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira.
revoke execute on function public.lr_suite_ads_http_get(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_key(text) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_month_key(text) from public, anon, authenticated;
-- El endpoint y la llamada guardan el token: nadie mas que el cron y las funciones los ejecutan.
revoke execute on function public.lr_suite_ads_endpoint() from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_call(text, text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_set_endpoint(text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_list_folder(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_sheet_rows(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_creatives(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_refresh(text, text) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_set_brand(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_ads_remove_brand(text) from public, anon, authenticated;
revoke execute on function public.sync_lr_suite_ads() from public, anon;
grant execute on function public.sync_lr_suite_ads() to authenticated;

-- ── Actualizacion diaria: 06:40 de Lima (UTC-5, sin horario de verano) ─────
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-ads-daily',
  '40 11 * * *',
  $cron$select public.lr_suite_ads_refresh('automatica')$cron$
);

-- ── La pieza en el Control de Automatizacion (si ese modulo esta instalado) ─
-- El Control de Automatizacion es independiente: puede no estar instalado en este proyecto. Si su
-- tabla no existe, esto no hace nada, porque el editor de Supabase corre todo el script en una sola
-- transaccion y un error aqui desharia tambien las funciones y el cron de arriba. Al instalar
-- despues control-automatizacion.sql, basta con volver a ejecutar este archivo.
do $$
begin
  if to_regclass('public.lr_suite_automation_components') is null then
    raise notice 'Control de Automatizacion no esta instalado: la pieza "ads" no se registro. La sincronizacion funciona igual.';
    return;
  end if;

  insert into public.lr_suite_automation_components
    (id, stage, name, brand, source, description, status, cadence, cron_job, run_function, data_key, data_path, sort)
  values
    ('ads', 'carga', 'Carga de anuncios', null, 'meta',
     'pg_cron suma el export de Meta Ads de cada marca y lo empareja con las piezas de Drive todos los dias a las 6:40 a. m.',
     'activo', 'diaria', 'lr-suite-ads-daily', 'public.lr_suite_ads_refresh', 'ads', '{updatedAt}', 65)
  on conflict (id) do update
    set status = 'activo',
        cron_job = excluded.cron_job,
        run_function = excluded.run_function,
        data_key = excluded.data_key,
        data_path = excluded.data_path,
        updated_at = now();

  update public.lr_suite_automation_components
  set status = 'activo', data_key = 'ads', data_path = '{updatedAt}', updated_at = now()
  where id = 'modulo-anuncios';
end;
$$;

-- ── Pasos finales (NO se guardan en el repo) ───────────────────────────────
-- 1. Una sola vez, el Web App de apps-script/Codigo.gs ya implementado:
--   select public.lr_suite_ads_set_endpoint('<URL que termina en /exec>', '<TOKEN del script>');
-- 2. Una vez por marca, con los IDs de sus dos carpetas:
--   select public.lr_suite_ads_set_brand('Royal Baby', '<ID de 01 Meta Ads>', '<ID de 06 Artes>')
--     ->> 'updatedAt' as primera_sincronizacion;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Ultima sincronizacion, si hubo cambios y los avisos:
--   select payload ->> 'updatedAt' as sincronizado, payload ->> 'changed' as hubo_cambios,
--          payload ->> 'trigger' as origen, payload -> 'errors' as avisos
--   from public.lr_suite_private_data where key = 'ads';
-- Cuantos anuncios y cuantos sin pieza quedaron, por marca y mes:
--   select m ->> 'marca' as marca, s ->> 'etiqueta' as mes,
--          jsonb_array_length(s -> 'anuncios') as anuncios,
--          count(*) filter (where a -> 'creativo' = 'null'::jsonb) as sin_pieza
--   from public.lr_suite_private_data d,
--        jsonb_array_elements(d.payload -> 'marcas') as m,
--        jsonb_array_elements(m -> 'meses') as s,
--        jsonb_array_elements(s -> 'anuncios') as a
--   where d.key = 'ads'
--   group by 1, 2, 3;
-- Si el Web App esta configurado (no muestra el token):
--   select payload ->> 'endpoint' as web_app, (payload ? 'token') as tiene_token
--   from public.lr_suite_private_data where key = 'ads-config';
-- Probar el Web App con una carpeta, sin tocar la sincronizacion:
--   select jsonb_array_length(public.lr_suite_ads_call('carpeta', '<ID de carpeta>') -> 'archivos');
-- Marcas configuradas (no muestra los IDs):
--   select jsonb_array_elements(payload -> 'marcas') ->> 'marca'
--   from public.lr_suite_private_data where key = 'ads-config';
-- Ultimas ejecuciones del cron:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-ads-daily')
--   order by start_time desc limit 5;
-- Forzar una sincronizacion ahora:
--   select public.lr_suite_ads_refresh('manual') ->> 'changed' as hubo_cambios;
-- Desinstalar el cron:
--   select cron.unschedule('lr-suite-ads-daily');
