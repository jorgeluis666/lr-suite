-- ============================================================================
-- CRM · Prospectos de la hoja: descarga y barrido automático
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Fuente: la pestaña «Contactos» de la hoja «Prospección comercial – Lima Retail», que es donde se
-- trabaja la prospección semanal: una fila por persona, con su empresa, su dominio, su cargo
-- publicado y el enlace a su perfil. Pasó de 13 filas a más de doscientas y crece cada lunes.
-- El identificador de la hoja NO está en este archivo ni en el index.html, que son públicos: se
-- guarda en Supabase con la fila «prospeccion-hoja» de lr_suite_private_data (ver el final).
--
-- Cómo funciona:
--   1. lr_pros_hoja_sincronizar() descarga la pestaña como TSV desde la propia base de datos
--      (extensión http) y compara su md5 con el de la última vez. Si el texto no cambió, no escribe
--      nada y lo dice; si cambió, le pasa el texto a private.lr_acrm_prospecto_hoja() (migración
--      20261123090000), que lee las columnas por su título y da de alta cada fila como lead de
--      origen «Ads Library».
--   2. pg_cron la ejecuta todos los días a las 12:30 de Lima (17:30 UTC). Eso es la sincronización
--      automática: detecta la modificación por el contenido, no por la fecha de la hoja, que cambia
--      cada vez que alguien abre el archivo.
--   3. El botón «Sincronizar con la hoja» del panel «+ Prospectos de la hoja» llama a la misma
--      función (RPC), que solo pueden usar Jorge Luis y Diego (lr_pros_usuario_habilitado()).
--      Con «forzar» vuelve a dar de alta aunque el texto no haya cambiado.
--   El navegador nunca llama a Google: lee una fila pequeña con el estado del último barrido
--   (lr_pros_hoja_estado, ~400 B) y, cuando pulsa el botón, el resumen de lo que entró.
--
-- Requisitos:
--   · La hoja debe estar compartida como «Cualquier persona con el enlace: Lector». Sin eso Google
--     devuelve su pantalla de acceso y la función lo dice sin tocar nada de lo que ya hay.
--   · La pestaña Contactos tiene la columna «URL del perfil», que extrae el enlace de la columna
--     «Perfil LinkedIn» con una fórmula por fila (FORMULATEXT + REGEXEXTRACT, copiada hasta la fila
--     330): el TSV exporta el texto del =HYPERLINK («Abrir perfil»), no su destino. Con MAP la
--     exportación devolvía #REF!, aunque en pantalla se viera bien. Sin esa columna los prospectos
--     entran sin perfil de LinkedIn.
--
-- Egress: una descarga al día (~40 KB hoy) desde la base, no desde el navegador.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- Necesita aplicada la migración 20261123090000_acrm_hoja_texto.sql.
-- ============================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── GET que sigue redirecciones ─────────────────────────────────────────────
-- Google responde 307 hacia googleusercontent.com al exportar; se sigue acá por si la extensión no
-- lo hace sola. Es el mismo ayudante que usan los otros dos barridos de Drive.
create or replace function private.lr_pros_hoja_get(p_url text, p_timeout_ms integer default 20000)
returns extensions.http_response
language plpgsql
security definer
set search_path = ''
as $fn$
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
    select h.value into v_location from unnest(v_response.headers) as h
     where lower(h.field) = 'location' limit 1;
    exit when v_location is null;
    v_hops := v_hops + 1;
    exit when v_hops > 5;
    v_url := v_location;
  end loop;
  return v_response;
end $fn$;
revoke all on function private.lr_pros_hoja_get(text, integer) from public, anon, authenticated;

-- ── El barrido ──────────────────────────────────────────────────────────────
-- p_forzar: da de alta otra vez aunque el texto de la hoja no haya cambiado. Sirve cuando alguien
-- corrigió un lead en la tabla y quiere volver a traer lo de la hoja, y para la primera carga.
create or replace function private.lr_pros_hoja_sincronizar(p_forzar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_config jsonb;
  v_url text;
  v_respuesta extensions.http_response;
  v_texto text;
  v_hash text;
  v_marcador text;
  v_r jsonb;
  v_aviso text;
begin
  select coalesce(payload, '{}'::jsonb) into v_config
    from public.lr_suite_private_data where key = 'prospeccion-hoja';
  if coalesce(v_config->>'hoja_id', '') = '' then
    return jsonb_build_object('ok', false, 'cambio', false,
      'aviso', 'Falta configurar la hoja: la fila «prospeccion-hoja» de lr_suite_private_data no tiene hoja_id.');
  end if;
  v_marcador := coalesce(nullif(v_config->>'marcador', ''), 'Nombre público');
  v_url := 'https://docs.google.com/spreadsheets/d/' || (v_config->>'hoja_id')
        || '/export?format=tsv&gid=' || coalesce(v_config->>'gid', '0');
  v_respuesta := private.lr_pros_hoja_get(v_url);
  v_texto := coalesce(v_respuesta.content, '');
  -- El marcador es un título de la propia pestaña: evita guardar una pantalla de inicio de sesión de
  -- Google o la pestaña equivocada si alguien reordena la hoja.
  if v_respuesta.status <> 200 or position(v_marcador in v_texto) = 0 then
    v_aviso := case
      when v_respuesta.status <> 200
        then 'Google respondió ' || v_respuesta.status || ': comparte la hoja como «Cualquier persona con el enlace: Lector».'
      else 'Lo que devolvió Google no es la pestaña Contactos (no aparece «' || v_marcador || '»).'
    end;
    insert into public.lr_suite_private_data (key, payload, updated_at)
    values ('prospeccion-hoja', v_config || jsonb_build_object('revisado_en', now(), 'aviso', v_aviso), now())
    on conflict (key) do update
      set payload = public.lr_suite_private_data.payload
                 || jsonb_build_object('revisado_en', now(), 'aviso', v_aviso),
          updated_at = now();
    return jsonb_build_object('ok', false, 'cambio', false, 'aviso', v_aviso);
  end if;
  v_hash := md5(v_texto);
  -- Detectar la modificación por el contenido y no por la fecha: la hoja cambia de fecha cada vez
  -- que alguien la abre, y lo que importa es si sus filas son otras.
  if v_hash = coalesce(v_config->>'hash', '') and not p_forzar then
    insert into public.lr_suite_private_data (key, payload, updated_at)
    values ('prospeccion-hoja', v_config || jsonb_build_object('revisado_en', now(), 'aviso', null), now())
    on conflict (key) do update
      set payload = public.lr_suite_private_data.payload
                 || jsonb_build_object('revisado_en', now(), 'aviso', null),
          updated_at = now();
    return jsonb_build_object('ok', true, 'cambio', false,
      'filas', coalesce((v_config->>'filas')::int, 0),
      'sincronizado_en', v_config->>'sincronizado_en');
  end if;
  v_r := private.lr_acrm_prospecto_hoja(v_texto);
  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('prospeccion-hoja', v_config || jsonb_build_object(
    'hash', v_hash, 'filas', v_r->'filas', 'nuevos', v_r->'nuevos', 'repetidos', v_r->'repetidos',
    'errores', v_r->'errores', 'columnas', v_r->'columnas',
    'sincronizado_en', now(), 'revisado_en', now(), 'aviso', null), now())
  on conflict (key) do update
    set payload = public.lr_suite_private_data.payload || jsonb_build_object(
      'hash', v_hash, 'filas', v_r->'filas', 'nuevos', v_r->'nuevos', 'repetidos', v_r->'repetidos',
      'errores', v_r->'errores', 'columnas', v_r->'columnas',
      'sincronizado_en', now(), 'revisado_en', now(), 'aviso', null),
        updated_at = now();
  return v_r || jsonb_build_object('cambio', true);
end $fn$;
revoke all on function private.lr_pros_hoja_sincronizar(boolean) from public, anon, authenticated;

-- El botón del panel. Solo las cuentas habilitadas, como el resto del CRM.
create or replace function public.lr_pros_hoja_sincronizar(p_forzar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null or not public.lr_pros_usuario_habilitado() then
    raise exception 'Cuenta no autorizada' using errcode = '42501';
  end if;
  return private.lr_pros_hoja_sincronizar(p_forzar);
end $fn$;
revoke all on function public.lr_pros_hoja_sincronizar(boolean) from public, anon;
grant execute on function public.lr_pros_hoja_sincronizar(boolean) to authenticated;

-- ── El barrido diario ───────────────────────────────────────────────────────
-- 17:30 UTC = 12:30 de Lima. Va después de la tarea «Actualizar prospectos de Lima Retail», que
-- corre los lunes a las 9:00 de Lima: así lo que esa revisión añade a la hoja entra al CRM el mismo
-- lunes y no al día siguiente.
do $cron$
begin
  perform cron.unschedule('lr-pros-hoja-diario');
exception when others then
  null; -- no estaba programado
end $cron$;
select cron.schedule('lr-pros-hoja-diario', '30 17 * * *', $$select private.lr_pros_hoja_sincronizar()$$);

-- ── Configuración (NO va en el repositorio) ─────────────────────────────────
-- La hoja y su pestaña se dan de alta una sola vez, con su identificador:
--
--   insert into public.lr_suite_private_data (key, payload, updated_at)
--   values ('prospeccion-hoja',
--           jsonb_build_object('hoja_id', '<ID de la hoja>', 'gid', '<gid de Contactos>',
--                              'marcador', 'Nombre público'),
--           now())
--   on conflict (key) do update
--     set payload = public.lr_suite_private_data.payload || excluded.payload, updated_at = now();
--
-- Para ver cómo quedó y correrlo a mano la primera vez:
--   select private.lr_pros_hoja_sincronizar(true);
--   select payload from public.lr_suite_private_data where key = 'prospeccion-hoja';
