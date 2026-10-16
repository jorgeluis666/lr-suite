-- ============================================================================
-- Clientes: qué carpetas tiene cada marca dentro de su carpeta de Drive
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- El mapa del módulo "Clientes" dibujaba una cadena fija de cuatro pasos para todas las marcas, y
-- eso es mentira: Royal Baby tiene Meta Ads, Google Ads, artes y reportes; Aquarius solo las de
-- Google Ads y sus reportes. Para dibujar lo que cada marca tiene de verdad hace falta saberlo, y
-- el navegador no puede preguntárselo a Drive.
--
-- Esto recorre las carpetas de "clientes-drive" (una por marca) y guarda en "clientes-carpetas" los
-- nombres de sus subcarpetas, sin bajar ningún archivo:
--   { "<clave de la marca>": [ { "nombre": "01 Meta Ads", "id": "...", "estandar": true }, ... ] }
--
-- "estandar" dice si el nombre sigue el estándar acordado (el prefijo numérico de la hoja
-- "Conexiones Drive Dashboard"). El módulo pinta en rojo las que no lo siguen, que son las que hay
-- que renombrar.
--
-- Reutiliza lr_suite_ads_list_folder() de la sincronización de anuncios, que ya lee la vista pública
-- de una carpeta sin credenciales. Es una petición por marca: 12 hoy.
--
-- Requisito: src/modules/anuncios/BBDD/sincronizacion-anuncios.sql instalado (de ahí sale
-- lr_suite_ads_list_folder) y la fila "clientes-drive" cargada.
-- Egress: el navegador lee una fila de ~3 KB al iniciar sesión.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- ── ¿El nombre sigue el estándar? ──────────────────────────────────────────
-- Las carpetas acordadas llevan prefijo numérico: 01 Meta Ads, 02 Google Ads, 03 Objetivos y
-- ventas, 04 Reportes, 05 Looker, 06 Artes, 07 Administración, 99 Archivos sueltos. Una sub-marca
-- (Excambiare) es una carpeta con nombre propio que contiene las suyas, así que también vale.
create or replace function public.lr_suite_clientes_carpeta_estandar(p_nombre text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_nombre, '') ~ '^(0[1-7]|99) ' ;
$$;

-- ── Recorre las carpetas de las marcas ─────────────────────────────────────
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
  v_links jsonb;
  v_clave text;
  v_url text;
  v_id text;
  v_items jsonb;
  v_marcas jsonb := '{}'::jsonb;
  v_errores jsonb := '[]'::jsonb;
  v_payload jsonb;
begin
  select payload into v_links from public.lr_suite_private_data where key = 'clientes-drive';
  if v_links is null or jsonb_typeof(v_links) <> 'object' then
    raise exception 'Falta la fila "clientes-drive" con la carpeta de cada marca';
  end if;

  for v_clave, v_url in select key, value from jsonb_each_text(v_links) loop
    v_id := substring(coalesce(v_url, '') from 'folders/([A-Za-z0-9_-]+)');
    if v_id is null then
      v_errores := v_errores || to_jsonb(format('%s: el link no tiene un id de carpeta', v_clave));
      continue;
    end if;

    v_items := public.lr_suite_ads_list_folder(v_id);
    -- Una carpeta vacía y una que dejó de estar compartida se ven igual desde fuera: se avisa.
    if jsonb_array_length(v_items) = 0 then
      v_errores := v_errores || to_jsonb(format('%s: la carpeta no devolvió nada (¿vacía o sin compartir?)', v_clave));
    end if;

    v_marcas := v_marcas || jsonb_build_object(v_clave, (
      select coalesce(jsonb_agg(jsonb_build_object(
               'nombre', e ->> 'name',
               'id', e ->> 'id',
               'estandar', public.lr_suite_clientes_carpeta_estandar(e ->> 'name')
             ) order by e ->> 'name'), '[]'::jsonb)
      from jsonb_array_elements(v_items) as e
      where e ->> 'tipo' = 'carpeta'
    ));
  end loop;

  v_payload := jsonb_build_object(
    'version', 1,
    'updatedAt', now(),
    'trigger', p_trigger,
    'requestedBy', p_requested_by,
    'errors', v_errores,
    'marcas', v_marcas
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

-- Supabase da EXECUTE a anon y authenticated en cada funcion nueva de public: se retira.
revoke execute on function public.lr_suite_clientes_carpeta_estandar(text) from public, anon, authenticated;
revoke execute on function public.lr_suite_clientes_carpetas_refresh(text, text) from public, anon, authenticated;
revoke execute on function public.sync_lr_suite_clientes_carpetas() from public, anon;
grant execute on function public.sync_lr_suite_clientes_carpetas() to authenticated;

-- ── Actualizacion diaria: 06:50 de Lima, despues de la carga de anuncios ───
select cron.schedule(
  'lr-suite-clientes-carpetas-daily',
  '50 11 * * *',
  $cron$select public.lr_suite_clientes_carpetas_refresh('automatica')$cron$
);

-- Primera carga, para no esperar al cron.
select public.lr_suite_clientes_carpetas_refresh('instalacion') ->> 'updatedAt' as primera_lectura;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Cuantas carpetas vio cada marca y cuantas estan fuera del estandar:
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
