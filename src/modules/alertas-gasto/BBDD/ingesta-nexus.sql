-- Alertas de Gasto · la puerta por la que Nexus escribe el gasto del mes
--
-- El modulo compara el presupuesto asignado a cada cuenta con lo que ya gasto, y ese gasto tiene
-- que entrar solo. Hasta el 1 de noviembre de 2026 entraba por una barra de subida dentro del
-- tablero; se quito, y lo que iba a reemplazarla (`sincronizacion-gasto.sql`: informe programado de
-- Google Ads → carpeta de Drive → Web App → pg_cron) nunca llego a instalarse, asi que el modulo
-- lleva desde el 21 de octubre mostrando el mismo informe.
--
-- Esto lo reemplaza por el camino que ya usa el resto de la agencia: lo trae Nexus, que habla con
-- las APIs de Google Ads y de Meta Ads, y lo escribe aca.
--
--   Nexus (Google Ads API, cuentas del MCC) ─┐
--                                            ├─→ lr_suite_gasto_set_informe() → lr_suite_private_data
--   Nexus (Meta Ads API, cuentas por marca) ─┘
--
-- Una sola funcion, con clave, que escribe las cuentas de UNA plataforma en UN mes. Las de la otra
-- plataforma se conservan: entran por su propia llamada y en su propia ventana de dias.
--
-- Es todo o nada: si una sola fila viene mal, no se escribe ninguna. Un mes a medias se leeria como
-- marcas que no gastaron, que es peor que un mes viejo, porque el mes viejo si lo avisa la pantalla.
--
-- Se ejecuta entero en el SQL Editor de Supabase. Es idempotente, y al final muestra la clave que
-- hay que cargar en Nexus (`config/local.php`).
--
-- Requisito: public.is_lr_suite_pending_user() y la tabla de claves de alertas-gasto-correo.sql.

-- ── 1. La clave con la que entra Nexus ──────────────────────────────────────
-- Misma tabla y mismo patron que el correo de las 8:30: la clave no se lee por la API y se genera
-- una sola vez, asi que repetir este script no la cambia.
do $requisitos$
begin
  if to_regprocedure('public.is_lr_suite_pending_user()') is null then
    raise exception
      'Falta public.is_lr_suite_pending_user(). Ejecuta antes src/modules/lista-pendientes/BBDD/security-hardening-2026-09.sql';
  end if;
  if to_regclass('public.lr_suite_notificaciones_claves') is null then
    raise exception
      'Falta public.lr_suite_notificaciones_claves. Ejecuta antes src/modules/alertas-gasto/BBDD/alertas-gasto-correo.sql';
  end if;
end $requisitos$;

insert into public.lr_suite_notificaciones_claves (id, clave)
values (
  'gasto-ingesta',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

-- ── 2. La ingesta ───────────────────────────────────────────────────────────
-- p_cuentas es un arreglo de objetos, uno por cuenta publicitaria:
--   [{"id":"272-748-7488","nombre":"Royal Baby Brands","moneda":"PEN","coste":926.32,
--     "diario":40,"estado":"Activa"}]
-- Opcionales, para las cuentas que facturan en otra moneda (el modulo convierte con la razon entre
-- las dos): "monedaConvertida" y "costeConvertido".
create or replace function public.lr_suite_gasto_set_informe(
  p_clave text,
  p_mes text,
  p_plataforma text,
  p_desde date,
  p_hasta date,
  p_cuentas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuentas jsonb;
  v_otras jsonb;
  v_payload jsonb;
  v_informes jsonb;
  v_informe jsonb;
  v_status jsonb;
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_total numeric;
begin
  if p_clave is null or not exists (
    select 1 from public.lr_suite_notificaciones_claves
    where id = 'gasto-ingesta' and clave = p_clave
  ) then
    raise exception 'clave no valida' using errcode = '42501';
  end if;

  if coalesce(p_mes, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'El mes tiene que ser AAAA-MM';
  end if;
  if coalesce(p_plataforma, '') not in ('google', 'meta') then
    raise exception 'La plataforma tiene que ser google o meta';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El periodo tiene que ir de desde a hasta';
  end if;
  if to_char(p_desde, 'YYYY-MM') <> p_mes or to_char(p_hasta, 'YYYY-MM') <> p_mes then
    raise exception 'El periodo tiene que caer dentro de %', p_mes;
  end if;
  -- Un dia de margen: Nexus corre con su propio reloj y el de Lima puede ir detras.
  if p_hasta > v_hoy + 1 then
    raise exception 'El periodo termina en el futuro: %', p_hasta;
  end if;

  if jsonb_typeof(coalesce(p_cuentas, 'null'::jsonb)) <> 'array' then
    raise exception 'Las cuentas tienen que venir en un arreglo';
  end if;
  if jsonb_array_length(p_cuentas) = 0 then
    raise exception 'El informe no trae ninguna cuenta';
  end if;
  if jsonb_array_length(p_cuentas) > 200 then
    raise exception 'Demasiadas cuentas en una sola llamada: %', jsonb_array_length(p_cuentas);
  end if;

  -- Las filas, una por una. Lo que no cuadre corta la llamada entera.
  --
  -- Primero la forma, sin convertir nada: dentro de un OR el orden de evaluacion no esta
  -- garantizado, asi que un `::numeric` aqui reventaria con el error del motor en vez del de abajo.
  -- El id se limita al mismo juego de caracteres que acepta lr_suite_gasto_set_presupuesto(): es la
  -- clave con la que se guarda el presupuesto de la cuenta, y un id raro dejaria una fila a la que
  -- no se le puede asignar presupuesto.
  if exists (
    select 1 from jsonb_array_elements(p_cuentas) as c
    where jsonb_typeof(c) <> 'object'
       or coalesce(c ->> 'id', '') !~ '^[0-9A-Za-z._-]{1,64}$'
       or coalesce(c ->> 'nombre', '') = ''
       or coalesce(c ->> 'coste', '') !~ '^-?\d+(\.\d+)?$'
       or coalesce(c ->> 'diario', '0') !~ '^-?\d+(\.\d+)?$'
       or coalesce(c ->> 'moneda', 'PEN') !~ '^[A-Za-z]{3}$'
  ) then
    raise exception 'Alguna cuenta viene sin nombre, con un id que no es de la forma de un id de cuenta, con un coste no numerico o con una moneda que no es de tres letras';
  end if;

  -- Y ahora los signos, con el formato ya garantizado.
  if exists (
    select 1 from jsonb_array_elements(p_cuentas) as c
    where (c ->> 'coste')::numeric < 0
       or coalesce((c ->> 'diario')::numeric, 0) < 0
  ) then
    raise exception 'Alguna cuenta trae un coste o un tope diario negativo';
  end if;

  -- La misma cuenta dos veces sumaria su gasto dos veces sin que se note.
  if (select count(distinct c ->> 'id') from jsonb_array_elements(p_cuentas) as c)
     <> jsonb_array_length(p_cuentas) then
    raise exception 'La misma cuenta viene repetida en el informe';
  end if;

  select
    jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'plataforma', p_plataforma,
      'id', c ->> 'id',
      'nombre', c ->> 'nombre',
      'moneda', upper(coalesce(nullif(c ->> 'moneda', ''), 'PEN')),
      'coste', round((c ->> 'coste')::numeric, 2),
      'diario', round(coalesce((c ->> 'diario')::numeric, 0), 2),
      'estado', nullif(c ->> 'estado', ''),
      'monedaConvertida', upper(nullif(c ->> 'monedaConvertida', '')),
      'costeConvertido', case
        when coalesce(c ->> 'costeConvertido', '') ~ '^-?\d+(\.\d+)?$'
        then round((c ->> 'costeConvertido')::numeric, 2)
      end
    ))),
    sum(round((c ->> 'coste')::numeric, 2))
  into v_cuentas, v_total
  from jsonb_array_elements(p_cuentas) as c;

  -- La fila queda bloqueada hasta el final: si las dos plataformas llegan a la vez, se ordenan.
  select payload into v_payload
  from public.lr_suite_private_data
  where key = 'gasto-alertas'
  for update;

  v_payload := coalesce(v_payload, '{}'::jsonb);
  v_informes := coalesce(v_payload -> 'informes', '{}'::jsonb);
  v_informe := coalesce(v_informes -> p_mes, '{}'::jsonb);

  -- Las cuentas de la OTRA plataforma se conservan tal cual.
  v_otras := coalesce((
    select jsonb_agg(c)
    from jsonb_array_elements(coalesce(v_informe -> 'cuentas', '[]'::jsonb)) as c
    where coalesce(c ->> 'plataforma', 'google') <> p_plataforma
  ), '[]'::jsonb);

  v_informe := v_informe || jsonb_build_object(
    'plataforma', coalesce(v_informe ->> 'plataforma', p_plataforma),
    'desde', p_desde,
    'hasta', p_hasta,
    'subidoAt', to_jsonb(now()),
    'subidoPor', 'Nexus',
    'cuentas', v_cuentas || v_otras
  );

  v_payload := jsonb_set(v_payload, '{informes}', v_informes || jsonb_build_object(p_mes, v_informe), true);

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('gasto-alertas', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  -- El estado que mira el Control de Automatizacion y el aviso de informe atrasado.
  --
  -- `ventanas` guarda el periodo de CADA plataforma, que es lo unico que delata el problema que
  -- este modulo arrastra: el ritmo diario y la proyeccion se calculan sobre `desde`/`hasta` del
  -- informe, que es uno solo para las dos. Si Google llega al dia 30 y Meta se quedo en el 21, el
  -- pacing de una de las dos sale torcido, y la ultima llamada es la que manda. Arreglarlo de
  -- verdad es que cada plataforma lleve su propia ventana dentro del informe, y eso es un cambio
  -- del modulo, no de este archivo.
  v_status := coalesce((select payload from public.lr_suite_private_data where key = 'gasto-status'), '{}'::jsonb);
  v_status := v_status || jsonb_build_object(
    'schemaVersion', 2,
    'source', 'Nexus · API de ' || case p_plataforma when 'google' then 'Google Ads' else 'Meta Ads' end,
    'mes', p_mes,
    'desde', p_desde,
    'hasta', p_hasta,
    'lastSync', now(),
    'trigger', 'nexus',
    'requestedBy', p_plataforma,
    'ventanas', coalesce(v_status -> 'ventanas', '{}'::jsonb) || jsonb_build_object(
      p_plataforma, jsonb_build_object(
        'mes', p_mes,
        'desde', p_desde,
        'hasta', p_hasta,
        'cuentas', jsonb_array_length(v_cuentas),
        'gasto', v_total,
        'lastSync', now()
      )
    )
  );

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('gasto-status', v_status, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  -- Lo que Nexus anota en su propio registro. El payload entero no se devuelve: lleva el gasto de
  -- todas las marcas y Nexus no lo necesita para saber que su carga entro.
  return jsonb_build_object(
    'ok', true,
    'mes', p_mes,
    'plataforma', p_plataforma,
    'desde', p_desde,
    'hasta', p_hasta,
    'cuentas', jsonb_array_length(v_cuentas),
    'gasto', v_total,
    'cuentasOtraPlataforma', jsonb_array_length(v_otras)
  );
end;
$$;

-- ── 3. Permisos ─────────────────────────────────────────────────────────────
-- Nexus llama con la clave publicable (rol anon) y la clave de la tabla, igual que el workflow del
-- correo: la comprobacion de verdad es la clave, no el rol.
revoke all on function public.lr_suite_gasto_set_informe(text, text, text, date, date, jsonb) from public;
grant execute on function public.lr_suite_gasto_set_informe(text, text, text, date, date, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

-- ── 4. La pieza en el Control de Automatizacion ─────────────────────────────
-- La carga deja de ser un pg_cron de Supabase: la dispara Nexus desde su propio cron de cPanel, asi
-- que la pieza no tiene `cron_job` ni `run_function` y su estado se mide por la antiguedad del dato
-- (`gasto-status.lastSync`), que es lo unico que prueba que la carga sigue corriendo.
do $$
begin
  if to_regclass('public.lr_suite_automation_components') is null then
    raise notice 'Control de Automatizacion no esta instalado: la pieza "gasto" no se registro. La ingesta funciona igual.';
    return;
  end if;

  insert into public.lr_suite_automation_components
    (id, stage, name, brand, source, description, status, cadence, cron_job, run_function, data_key, data_path, sort)
  values
    ('gasto', 'carga', 'Carga del gasto por cuenta', 'Lima Retail', 'nexus',
     'Nexus lee el gasto de las cuentas de Google Ads del MCC y de las cuentas de Meta de cada marca, y lo escribe en LR Suite con lr_suite_gasto_set_informe().',
     'activo', 'diaria', null, null, 'gasto-status', '{lastSync}', 55)
  on conflict (id) do update
    set stage = excluded.stage,
        name = excluded.name,
        source = excluded.source,
        description = excluded.description,
        status = 'activo',
        cadence = excluded.cadence,
        cron_job = null,
        run_function = null,
        data_key = excluded.data_key,
        data_path = excluded.data_path,
        updated_at = now();
end;
$$;

-- ── 5. Comprobaciones y la clave para Nexus ─────────────────────────────────
-- La clave va a `config/local.php` de Nexus. Esta consulta la muestra: no la dejes en el historial
-- de un SQL Editor compartido mas tiempo del necesario.
select clave as clave_para_nexus
from public.lr_suite_notificaciones_claves
where id = 'gasto-ingesta';

-- Una prueba de extremo a extremo, con la clave de arriba (dos cuentas inventadas en un mes que no
-- existe, para no tocar los datos de verdad):
-- select public.lr_suite_gasto_set_informe(
--   '<CLAVE>', '2020-01', 'google', '2020-01-01', '2020-01-05',
--   '[{"id":"000-000-0001","nombre":"Prueba","moneda":"PEN","coste":10.5,"diario":2,"estado":"Activa"}]'::jsonb
-- );
-- Y para dejarlo como estaba:
-- update public.lr_suite_private_data
--    set payload = payload #- '{informes,2020-01}'
--  where key = 'gasto-alertas';
--
-- El gasto cargado de un mes, por plataforma:
-- select coalesce(c ->> 'plataforma', 'google') as plataforma,
--        count(*) as cuentas,
--        round(sum((c ->> 'coste')::numeric), 2) as gasto
-- from public.lr_suite_private_data d,
--      jsonb_array_elements(d.payload -> 'informes' -> '2026-11' -> 'cuentas') as c
-- where d.key = 'gasto-alertas'
-- group by 1;
