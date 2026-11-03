-- ============================================================================
-- Reglas y Optimización: sincronización de las hojas «Reglas_Nexus_<Marca>»
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Fuente: una hoja de reglas por marca, en «08 Reglas y Optimización» dentro de la carpeta de la
-- marca, con dos pestañas —«Reglas Google Ads» y «Reglas Meta Ads»—. Las crea y las puebla el Apps
-- Script de ../apps-script/. Aquí solo se leen, y cada regla sale con su «fuente».
--
-- Ningún ID vive en este archivo ni en el index.html, que son públicos: el ID del maestro
-- «Conexiones Drive Dashboard» se guarda con lr_suite_reglas_set_maestro() (ver el final).
--
-- Cómo funciona:
--   1. lr_suite_reglas_refresh() consigue las reglas de todas las marcas por uno de dos caminos:
--        a) El Web App del Apps Script (lr_suite_reglas_set_webapp). Corre con la cuenta del
--           dueño de las hojas, así que lee carpetas privadas, y devuelve el barrido completo en
--           una sola petición. Es el camino normal.
--        b) Leyendo Drive directamente: con una API key en Vault, o con la vista pública de cada
--           carpeta. Las dos piden que las hojas estén compartidas por enlace.
--      Las filas se leen como JSON (gviz o la API de Sheets), no como CSV: la instrucción
--      estratégica lleva comas y comillas y un CSV partido a mano se rompe con ellas.
--   2. Guarda todo en lr_suite_private_data «reglas-nexus» (~20 KB): las reglas por marca, la
--      fecha de la sincronización y los avisos. Si una marca no se pudo leer, conserva sus
--      reglas anteriores en lugar de dejarla vacía.
--   3. pg_cron la ejecuta todos los días a las 06:40 de Lima (11:40 UTC), veinte minutos después
--      de la sincronización de palabras clave para no pelear por la ventana de Google.
--   4. El index.html lee esa fila al abrir «Alertas de Gasto» y aplica el hito que toca según el
--      día del mes, uno por fuente: los dos ciclos se evalúan por separado.
--
-- Por qué el Web App y no la API key: las carpetas «08 Reglas y Optimización» tienen la herencia
-- de permisos apagada, para que el cliente de la marca no vea el método de trabajo de la agencia.
-- Una API key de Google NO autentica a nadie: solo abre archivos públicos, así que contra una
-- carpeta restringida falla igual que la vista pública. El Web App sí, porque se ejecuta como su
-- dueño. El camino (b) queda para una instalación donde las hojas sí estén compartidas.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── GET que sigue redirecciones ─────────────────────────────────────────────
-- Google responde 307 hacia googleusercontent.com en varios de estos endpoints; se sigue aquí por
-- si la extensión no lo hace sola.
create or replace function public.lr_suite_reglas_http_get(p_url text, p_timeout_ms integer default 15000)
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
  loop
    v_response := extensions.http(('GET', v_url, null, null, null)::extensions.http_request);
    exit when v_response.status not in (301, 302, 303, 307, 308);
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

-- ── La API key de Google, si alguien la guardó ─────────────────────────────
-- Se guarda una sola vez, fuera del repositorio:
--   select vault.create_secret('<API_KEY>', 'lr_suite_google_drive_api_key');
-- Es la misma key que usa el módulo de palabras clave. Sin ella todo sigue funcionando por la
-- vista pública, solo que con más peticiones.
create or replace function public.lr_suite_reglas_api_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  begin
    select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'lr_suite_google_drive_api_key'
    limit 1;
  exception when others then
    v_key := null;
  end;
  return v_key;
end;
$$;

-- ── El barrido del Apps Script ─────────────────────────────────────────────
-- El Web App corre con la cuenta de quien lo desplegó, así que lee las carpetas «08 Reglas y
-- Optimización» aunque tengan la herencia de permisos apagada, y devuelve todas las marcas en una
-- sola petición. La URL y el token se guardan con lr_suite_reglas_set_webapp() y no viven en este
-- archivo, que es público.
--
-- Devuelve null solo cuando no está configurado (entonces se intenta leer Drive directamente). Si
-- está configurado y falla, devuelve un objeto sin marcas y con el aviso: así la sincronización
-- conserva las reglas de ayer y dice qué pasó, en lugar de caer a un camino que tampoco va a poder.
create or replace function public.lr_suite_reglas_webapp(p_timeout_ms integer default 30000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_config jsonb;
  v_url text;
  v_token text;
  v_response extensions.http_response;
  v_json jsonb;
  v_falla text;
begin
  select payload into v_config
  from public.lr_suite_private_data
  where key = 'reglas-config';

  v_url := btrim(coalesce(v_config ->> 'webappUrl', ''));
  v_token := coalesce(v_config ->> 'webappToken', '');
  if v_url = '' or v_token = '' then return null; end if;

  begin
    v_response := public.lr_suite_reglas_http_get(
      v_url || '?token=' || extensions.urlencode(v_token),
      p_timeout_ms
    );
    if v_response.status <> 200 then
      v_falla := 'el barrido respondio ' || v_response.status;
    else
      v_json := v_response.content::jsonb;
      -- Un token que no cuadra responde {"error":"sin permiso"} con estado 200.
      if v_json ? 'error' then
        v_falla := 'el barrido rechazo el token: ' || coalesce(v_json ->> 'error', 'sin detalle');
      elsif not (v_json ? 'marcas') then
        v_falla := 'el barrido no devolvio marcas';
      end if;
    end if;
  exception when others then
    v_falla := 'no se pudo llamar al barrido: ' || sqlerrm;
  end;

  if v_falla is not null then
    return jsonb_build_object('marcas', '[]'::jsonb, 'avisos', jsonb_build_array(v_falla));
  end if;
  return v_json;
end;
$$;

-- ── Leer las filas de una hoja ─────────────────────────────────────────────
-- Devuelve un arreglo de filas, y cada fila un arreglo de celdas: [["R_01","Hito 1…",…], …].
-- La fila de encabezados no viene (headers=1), así que la primera fila ya es una regla.
--
-- Dos caminos, los dos devuelven JSON:
--   1. API de Sheets v4, si hay key en Vault.
--   2. gviz, el endpoint que usan los gráficos de Sheets. No pide credenciales mientras la hoja
--      siga compartida por enlace.
create or replace function public.lr_suite_reglas_leer(
  p_hoja text,
  p_pestana text default null,
  p_timeout_ms integer default 15000
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text := public.lr_suite_reglas_api_key();
  v_response extensions.http_response;
  v_cuerpo text;
  v_json jsonb;
  v_filas jsonb;
begin
  -- 1. API de Sheets: devuelve directamente {"values": [[…], […]]} y el encabezado va dentro, así
  --    que se descarta la primera fila para dejar solo datos.
  if v_key is not null then
    begin
      v_response := public.lr_suite_reglas_http_get(
        'https://sheets.googleapis.com/v4/spreadsheets/' || p_hoja || '/values/'
          || extensions.urlencode(coalesce(p_pestana, 'A:Z'))
          || '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&key=' || v_key,
        p_timeout_ms
      );
      if v_response.status = 200 then
        v_filas := coalesce(v_response.content::jsonb -> 'values', '[]'::jsonb);
        if jsonb_array_length(v_filas) <= 1 then return '[]'::jsonb; end if;
        return (select coalesce(jsonb_agg(fila order by orden), '[]'::jsonb)
                from jsonb_array_elements(v_filas) with ordinality as t(fila, orden)
                where orden > 1);
      end if;
    exception when others then
      -- Se cae a gviz: un 403 por una key restringida a Drive no debe dejar sin reglas al tablero.
      null;
    end;
  end if;

  -- 2. gviz. Responde JavaScript: /*O_o*/\ngoogle.visualization.Query.setResponse({…});
  --    De ahí sale el JSON entre el primer paréntesis y el último.
  v_response := public.lr_suite_reglas_http_get(
    'https://docs.google.com/spreadsheets/d/' || p_hoja || '/gviz/tq?tqx=out:json&headers=1'
      || case when p_pestana is null then '' else '&sheet=' || extensions.urlencode(p_pestana) end,
    p_timeout_ms
  );
  if v_response.status <> 200 then
    raise exception 'Google respondio % al leer la hoja', v_response.status;
  end if;

  -- Lo que va entre el primer parentesis y el ultimo, sin el «);» del final. El cuantificador es
  -- codicioso a proposito: el JSON lleva parentesis dentro de los textos de las reglas.
  v_cuerpo := substring(coalesce(v_response.content, '') from '\(([\s\S]*)\)\s*;?\s*$');
  if coalesce(v_cuerpo, '') = '' then
    raise exception 'la hoja no devolvio datos (revisa que siga compartida con "Cualquier persona con el enlace")';
  end if;

  v_json := v_cuerpo::jsonb;
  if coalesce(v_json ->> 'status', '') = 'error' then
    raise exception 'gviz rechazo la hoja: %', coalesce(v_json -> 'errors' -> 0 ->> 'detailed_message', 'sin detalle');
  end if;

  -- Cada fila trae sus celdas en «c», y una celda vacía puede venir como null: se normaliza a ''
  -- para que la posición de las columnas no se corra.
  select coalesce(jsonb_agg(celdas order by orden), '[]'::jsonb)
  into v_filas
  from (
    select orden,
           (select coalesce(jsonb_agg(coalesce(celda -> 'v', '""'::jsonb) order by pos), '[]'::jsonb)
            from jsonb_array_elements(fila -> 'c') with ordinality as c(celda, pos)) as celdas
    from jsonb_array_elements(v_json -> 'table' -> 'rows') with ordinality as r(fila, orden)
  ) as filas;

  return coalesce(v_filas, '[]'::jsonb);
end;
$$;

-- ── Ubicar las hojas de reglas ─────────────────────────────────────────────
-- Devuelve {"discovery": "...", "hojas": [{"marca": "...", "id": "..."}], "errors": [...]}.
create or replace function public.lr_suite_reglas_hojas(p_timeout_ms integer default 15000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_prefijo constant text := 'Reglas_Nexus_';
  v_carpeta constant text := '08 Reglas y Optimización';
  v_key text := public.lr_suite_reglas_api_key();
  v_maestro text;
  v_response extensions.http_response;
  v_hojas jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_marca text;
  v_link text;
  v_raiz text;
  v_sub text;
  v_archivo text;
  v_fila jsonb;
begin
  -- 1. Con API key: una sola consulta a Drive trae todas las hojas de todas las marcas, y la
  --    marca sale del nombre del archivo. Es una petición en lugar de veinticuatro.
  if v_key is not null then
    begin
      v_response := public.lr_suite_reglas_http_get(
        'https://www.googleapis.com/drive/v3/files?q='
          || extensions.urlencode(format('name contains ''%s'' and trashed = false', v_prefijo))
          || '&fields=files(id,name)&pageSize=1000&key=' || v_key,
        p_timeout_ms
      );
      if v_response.status = 200 then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'marca', btrim(substring(f ->> 'name' from length(v_prefijo) + 1)),
                 'id', f ->> 'id'
               ) order by f ->> 'name'), '[]'::jsonb)
        into v_hojas
        from jsonb_array_elements(v_response.content::jsonb -> 'files') as f
        where f ->> 'name' like v_prefijo || '%';
        if jsonb_array_length(v_hojas) > 0 then
          return jsonb_build_object('discovery', 'drive-api', 'hojas', v_hojas, 'errors', v_errors);
        end if;
        v_errors := v_errors || to_jsonb('Drive API no encontro ninguna hoja de reglas. Ejecuta crearReglas() en el Apps Script.'::text);
      else
        v_errors := v_errors || to_jsonb('Drive API respondio ' || v_response.status);
      end if;
    exception when others then
      v_errors := v_errors || to_jsonb('Drive API: ' || sqlerrm);
    end;
  end if;

  -- 2. Sin key: el maestro dice qué marcas hay y donde esta su carpeta; de ahi se baja a la
  --    subcarpeta de reglas y a la hoja, con la vista publica de Drive.
  select payload ->> 'maestro' into v_maestro
  from public.lr_suite_private_data
  where key = 'reglas-config';

  if coalesce(v_maestro, '') = '' then
    v_errors := v_errors || to_jsonb('Falta el ID del maestro. Ejecuta lr_suite_reglas_set_maestro(''<ID>'').'::text);
    return jsonb_build_object('discovery', null, 'hojas', v_hojas, 'errors', v_errors);
  end if;

  begin
    for v_fila in select fila from jsonb_array_elements(public.lr_suite_reglas_leer(v_maestro, 'Hoja 1', p_timeout_ms)) as t(fila)
    loop
      v_marca := btrim(coalesce(v_fila -> 0 #>> '{}', ''));
      v_link := coalesce(v_fila -> 2 #>> '{}', '');
      if v_marca = '' then continue; end if;

      v_raiz := substring(v_link from '/folders/([A-Za-z0-9_-]{10,})');
      if v_raiz is null then
        v_errors := v_errors || to_jsonb(v_marca || ': sin link de carpeta en el maestro.');
        continue;
      end if;

      v_sub := public.lr_suite_reglas_buscar(v_raiz, v_carpeta, true, p_timeout_ms);
      if v_sub is null then
        v_errors := v_errors || to_jsonb(v_marca || ': no tiene la carpeta «' || v_carpeta || '».');
        continue;
      end if;

      v_archivo := public.lr_suite_reglas_buscar(v_sub, v_prefijo || v_marca, false, p_timeout_ms);
      if v_archivo is null then
        v_errors := v_errors || to_jsonb(v_marca || ': la carpeta de reglas no tiene «' || v_prefijo || v_marca || '».');
        continue;
      end if;

      v_hojas := v_hojas || jsonb_build_object('marca', v_marca, 'id', v_archivo);
    end loop;
  exception when others then
    v_errors := v_errors || to_jsonb('No se pudo leer «Hoja 1» del maestro: ' || sqlerrm);
  end;

  return jsonb_build_object(
    'discovery', case when jsonb_array_length(v_hojas) > 0 then 'embeddedfolderview' else null end,
    'hojas', v_hojas,
    'errors', v_errors
  );
end;
$$;

-- Busca por nombre exacto dentro de una carpeta, con la vista publica. p_es_carpeta decide si se
-- quiere la subcarpeta o el archivo: en «08 Reglas y Optimización» hay uno de cada.
create or replace function public.lr_suite_reglas_buscar(
  p_carpeta text,
  p_nombre text,
  p_es_carpeta boolean,
  p_timeout_ms integer default 15000
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_folder constant text := 'application/vnd.google-apps.folder';
  v_response extensions.http_response;
  v_id text;
begin
  v_response := public.lr_suite_reglas_http_get(
    'https://drive.google.com/embeddedfolderview?id=' || p_carpeta,
    p_timeout_ms
  );
  if v_response.status <> 200 then return null; end if;

  select e.id into v_id
  from (
    select substring(chunk from 'id="entry-([A-Za-z0-9_-]+)"') as id,
           btrim(substring(chunk from 'flip-entry-title">([^<]*)<')) as name,
           substring(chunk from '/type/([^"]+)"') as mime
    from unnest((string_to_array(v_response.content, 'class="flip-entry"'))[2:]) as chunk
  ) as e
  where e.id is not null
    and (case when p_es_carpeta then e.mime = v_folder else coalesce(e.mime, '') <> v_folder end)
    -- La vista pública escapa el nombre, así que se compara ya desescapado.
    and replace(replace(replace(replace(replace(e.name, '&#39;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&amp;', '&') = p_nombre
  limit 1;

  return v_id;
end;
$$;

-- ── Una fila de la hoja a una regla ────────────────────────────────────────
-- El orden de las columnas es el contrato con el Apps Script y con el index.html:
-- ID Regla | Semana / Hito | Métrica | Operador | Valor | Acción | Activar IA | Instrucción.
-- Una fila sin ID o sin métrica no es una regla: suele ser una nota al pie de la hoja.
create or replace function public.lr_suite_reglas_fila(p_fila jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_fila -> 0 #>> '{}', '')) = ''
      or btrim(coalesce(p_fila -> 2 #>> '{}', '')) = ''
    then null
    else jsonb_build_object(
      'id', btrim(p_fila -> 0 #>> '{}'),
      'hito', btrim(coalesce(p_fila -> 1 #>> '{}', '')),
      'metrica', btrim(p_fila -> 2 #>> '{}'),
      'operador', btrim(coalesce(p_fila -> 3 #>> '{}', '')),
      'valor', nullif(btrim(coalesce(p_fila -> 4 #>> '{}', '')), '')::numeric,
      'accion', btrim(coalesce(p_fila -> 5 #>> '{}', '')),
      'ia', upper(btrim(coalesce(p_fila -> 6 #>> '{}', ''))) in ('TRUE', 'VERDADERO', '1', 'SI', 'SÍ'),
      'instruccion', btrim(coalesce(p_fila -> 7 #>> '{}', ''))
    )
  end;
$$;

-- ── Una pestaña de la hoja ─────────────────────────────────────────────────
-- Cada marca lleva su ciclo de Google y su ciclo de Meta en dos pestañas del mismo libro, y la
-- regla sale con el campo «fuente» para que el tablero las separe. Dos cosas que hay que tolerar:
--   · Una hoja que todavía no pasó por crearReglas() tiene una sola pestaña, «Reglas», con el ciclo
--     de Google. Para «google» se vuelve a leer sin nombre, que es la primera pestaña.
--   · Una hoja a la que le falta la pestaña de Meta devuelve vacío en lugar de romper la lectura de
--     la marca: sus reglas de Google sí tienen que llegar.
create or replace function public.lr_suite_reglas_pestana(
  p_hoja text,
  p_pestana text,
  p_fuente text,
  p_timeout_ms integer default 15000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas jsonb;
  v_reglas jsonb;
begin
  begin
    v_filas := public.lr_suite_reglas_leer(p_hoja, p_pestana, p_timeout_ms);
  exception when others then
    v_filas := null;
  end;

  if coalesce(jsonb_array_length(v_filas), 0) = 0 then
    if p_fuente <> 'google' then return '[]'::jsonb; end if;
    -- Sin la pestaña nueva y siendo el ciclo de Google: la hoja es de las de antes. Esta lectura sí
    -- puede fallar hacia arriba, porque una marca sin reglas de Google no tiene reglas.
    v_filas := public.lr_suite_reglas_leer(p_hoja, null, p_timeout_ms);
  end if;

  select coalesce(jsonb_agg(regla order by orden), '[]'::jsonb)
  into v_reglas
  from (
    select public.lr_suite_reglas_fila(fila) || jsonb_build_object('fuente', p_fuente) as regla,
           orden
    from jsonb_array_elements(v_filas) with ordinality as t(fila, orden)
  ) as filas
  where regla is not null;

  return v_reglas;
end;
$$;

-- ── Sincronización completa (cron diario) ──────────────────────────────────
create or replace function public.lr_suite_reglas_refresh(
  p_trigger text default 'automatica',
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior jsonb;
  v_webapp jsonb;
  v_listado jsonb;
  v_hoja jsonb;
  v_marca text;
  v_reglas jsonb;
  v_marcas jsonb := '{}'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_origen text;
  v_payload jsonb;
begin
  select payload into v_anterior
  from public.lr_suite_private_data
  where key = 'reglas-nexus';

  -- Camino normal: el barrido del Apps Script, que lee las carpetas privadas porque corre con la
  -- cuenta de su dueño, y trae todas las marcas en una sola petición.
  v_webapp := public.lr_suite_reglas_webapp();

  if v_webapp is not null then
    v_origen := 'webapp';
    v_errors := coalesce(v_webapp -> 'avisos', '[]'::jsonb);

    for v_hoja in select m from jsonb_array_elements(coalesce(v_webapp -> 'marcas', '[]'::jsonb)) as t(m)
    loop
      v_marca := btrim(coalesce(v_hoja ->> 'marca', ''));
      v_reglas := coalesce(v_hoja -> 'reglas', '[]'::jsonb);
      if v_marca = '' or jsonb_array_length(v_reglas) = 0 then
        v_errors := v_errors || to_jsonb(
          coalesce(nullif(v_marca, ''), '(fila sin marca)') || ': el barrido no devolvio reglas.'
        );
        continue;
      end if;
      v_marcas := v_marcas || jsonb_build_object(v_marca, jsonb_build_object(
        'archivo', v_hoja ->> 'archivo',
        'reglas', v_reglas
      ));
    end loop;

    -- Las marcas que el barrido no trajo conservan lo de la vuelta anterior, igual que abajo.
    if v_anterior -> 'marcas' is not null then
      for v_marca in select k from jsonb_object_keys(v_anterior -> 'marcas') as t(k)
      loop
        if not (v_marcas ? v_marca) then
          v_marcas := v_marcas || jsonb_build_object(v_marca, v_anterior -> 'marcas' -> v_marca);
        end if;
      end loop;
    end if;

    v_listado := jsonb_build_object('discovery', 'webapp');
  else

  v_listado := public.lr_suite_reglas_hojas();
  v_errors := coalesce(v_listado -> 'errors', '[]'::jsonb);

  for v_hoja in select h from jsonb_array_elements(v_listado -> 'hojas') as t(h)
  loop
    v_marca := v_hoja ->> 'marca';
    begin
      -- El ciclo de Google primero: si esa lectura falla, la marca entera se queda con lo de ayer y
      -- no tiene sentido pedir la pestaña de Meta.
      v_reglas := public.lr_suite_reglas_pestana(v_hoja ->> 'id', 'Reglas Google Ads', 'google');

      if jsonb_array_length(v_reglas) = 0 then
        raise exception 'la hoja no tiene ninguna regla con ID y metrica';
      end if;

      v_reglas := v_reglas || public.lr_suite_reglas_pestana(v_hoja ->> 'id', 'Reglas Meta Ads', 'meta');

      v_marcas := v_marcas || jsonb_build_object(v_marca, jsonb_build_object(
        'archivo', v_hoja ->> 'id',
        'reglas', v_reglas
      ));
    exception when others then
      -- Una marca que no se pudo leer conserva sus reglas de la vuelta anterior: dejar el tablero
      -- sin reglas por una lectura fallida es peor que mostrar las de ayer.
      v_errors := v_errors || to_jsonb(v_marca || ': ' || sqlerrm);
      if v_anterior -> 'marcas' ? v_marca then
        v_marcas := v_marcas || jsonb_build_object(v_marca, v_anterior -> 'marcas' -> v_marca);
      end if;
    end;
  end loop;

  end if;

  v_payload := jsonb_build_object(
    'lastSync', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'discovery', coalesce(to_jsonb(v_origen), v_listado -> 'discovery'),
    'marcas', v_marcas,
    'errors', v_errors
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('reglas-nexus', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'lastSync', v_payload ->> 'lastSync',
    'marcas', (select count(*) from jsonb_object_keys(v_marcas)),
    'errors', v_errors
  );
end;
$$;

-- ── Guardar la URL y el token del barrido (no se guardan en el repo) ───────
create or replace function public.lr_suite_reglas_set_webapp(p_url text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(p_url), '') = '' or coalesce(p_token, '') = '' then
    raise exception 'Faltan la URL del Web App o el token';
  end if;
  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('reglas-config', jsonb_build_object('webappUrl', btrim(p_url), 'webappToken', p_token), now())
  on conflict (key) do update
    set payload = lr_suite_private_data.payload || excluded.payload,
        updated_at = excluded.updated_at;
  return public.lr_suite_reglas_refresh('instalacion');
end;
$$;

-- ── Guardar el ID del maestro (no se guarda en el repo) ────────────────────
create or replace function public.lr_suite_reglas_set_maestro(p_maestro text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(p_maestro), '') = '' then
    raise exception 'Falta el ID del maestro';
  end if;
  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('reglas-config', jsonb_build_object('maestro', btrim(p_maestro)), now())
  on conflict (key) do update
    set payload = lr_suite_private_data.payload || excluded.payload,
        updated_at = excluded.updated_at;
  return public.lr_suite_reglas_refresh('instalacion');
end;
$$;

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira. Lo unico
-- que el navegador necesita es leer la fila, y eso lo dan las politicas RLS de la tabla.
revoke execute on function public.lr_suite_reglas_http_get(text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_api_key() from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_leer(text, text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_hojas(integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_buscar(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_fila(jsonb) from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_pestana(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_set_maestro(text) from public, anon, authenticated;
-- El token del barrido vive en esta fila: ninguna de las dos se deja llamar desde el navegador.
revoke execute on function public.lr_suite_reglas_webapp(integer) from public, anon, authenticated;
revoke execute on function public.lr_suite_reglas_set_webapp(text, text) from public, anon, authenticated;
-- El boton «Actualizar» del modulo la llama con la sesion del usuario, asi que esta si se concede.
revoke execute on function public.lr_suite_reglas_refresh(text, text) from public, anon;
grant execute on function public.lr_suite_reglas_refresh(text, text) to authenticated;

-- ── Actualizacion diaria: 06:40 de Lima (UTC-5, sin horario de verano) ─────
-- cron.schedule con un nombre existente reemplaza el job, asi que repetir el script no lo duplica.
select cron.schedule(
  'lr-suite-reglas-daily',
  '40 11 * * *',
  $cron$select public.lr_suite_reglas_refresh('automatica')$cron$
);

-- ── Pasos finales (una sola vez, NO se guardan en el repo) ─────────────────
-- 1. El barrido. Es el camino normal, porque las carpetas «08 Reglas y Optimización» tienen la
--    herencia de permisos apagada y solo el Web App (que corre como su dueño) puede leerlas.
--    Despliega ../apps-script/ como aplicación web y ejecuta esta linea sola:
--      select public.lr_suite_reglas_set_webapp('<URL_DEL_WEB_APP>', '<TOKEN>') ->> 'lastSync';
--
-- 2. Solo si NO se usa el Web App y las hojas estan compartidas por enlace, el ID del maestro
--    para el camino de lectura directa de Drive:
--      select public.lr_suite_reglas_set_maestro('<ID_DEL_MAESTRO>') ->> 'lastSync';

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Que marcas tienen reglas y cuantas:
--   select m.marca, jsonb_array_length(m.datos -> 'reglas') as reglas
--   from public.lr_suite_private_data d,
--        jsonb_each(d.payload -> 'marcas') as m(marca, datos)
--   where d.key = 'reglas-nexus'
--   order by m.marca;
-- Ultima sincronizacion, como se ubicaron las hojas y avisos:
--   select payload ->> 'lastSync' as sincronizado, payload ->> 'discovery' as listado,
--          payload -> 'errors' as avisos
--   from public.lr_suite_private_data where key = 'reglas-nexus';
-- Ultimas ejecuciones del cron:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'lr-suite-reglas-daily')
--   order by start_time desc limit 5;
-- Forzar una sincronizacion ahora:
--   select public.lr_suite_reglas_refresh('manual');
