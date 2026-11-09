-- ============================================================================
-- Los correos automáticos dentro del Control de Automatización
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- El módulo «Control de Automatización» dibuja el camino por el que llegan los datos de las marcas:
-- fuentes -> descarga -> Drive -> carga -> dashboard. Los dos correos automáticos no viajan por ahí:
-- no traen datos, los sacan. Por eso entran como una etapa aparte, 'correos', que el index.html
-- dibuja debajo del proceso y sin flecha, igual que el asistente de la Agenda, pero que sí cuenta en
-- las métricas y en la lista de corridas.
--
-- Las dos piezas:
--   · correo-gasto       8:30 a. m. todos los días  · cron lr-suite-alertas-gasto
--   · correo-pendientes  1 y 5 p. m. de lunes a viernes · cron lr-suite-resumen-persona
--
-- Por qué hacía falta: hasta ahora un correo podía dejar de salir sin que nadie se enterara. Con la
-- pieza registrada, el módulo lo dice.
--
-- **Dos corridas por envío, y las dos importan.** pg_cron solo le pide a GitHub que arranque el
-- workflow: su corrida sale correcta en cuanto GitHub responde 204, aunque después el correo no se
-- envíe. Por eso cada script anota también SU corrida al terminar, con
-- lr_suite_correo_anotar(), y es esa la que dice si el correo salió de verdad. Si falta la segunda,
-- el workflow se cayó; si la segunda viene con error, falló el envío (casi siempre el SMTP).
--
-- Ninguna de las dos piezas lleva run_function: «Ejecutar ahora» mandaría correos de verdad a todo
-- el equipo con un clic, y eso no es un botón que deba existir en un tablero. Para reenviar a mano
-- están Actions -> Run workflow y las funciones lr_suite_disparar_*.
--
-- Requiere, ya instalados:
--   · src/modules/control-automatizacion/BBDD/control-automatizacion.sql
--   · src/modules/alertas-gasto/BBDD/alertas-gasto-correo.sql (la tabla de claves)
-- Es aditivo. Si ya se instaló la etapa 'asistente' (src/modules/agenda/BBDD/agenda-automatizacion.sql),
-- no importa el orden: el check se reescribe con las seis etapas.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

do $requisitos$
begin
  if to_regclass('public.lr_suite_automation_components') is null then
    raise exception 'Falta el Control de Automatización: ejecuta antes src/modules/control-automatizacion/BBDD/control-automatizacion.sql';
  end if;
  if to_regclass('public.lr_suite_notificaciones_claves') is null then
    raise exception 'Falta la tabla de claves: ejecuta antes src/modules/alertas-gasto/BBDD/alertas-gasto-correo.sql';
  end if;
end $requisitos$;

-- ── 1. Una etapa más: los correos ──────────────────────────────────────────
-- El check viene escrito en la columna, así que se reemplaza entero. Se busca por su definición y no
-- por su nombre: si Postgres le hubiera puesto otro, quedarían dos checks y el viejo seguiría
-- rechazando la etapa nueva.
do $etapa$
declare
  v_nombre text;
begin
  for v_nombre in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.lr_suite_automation_components'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%stage%'
  loop
    execute format('alter table public.lr_suite_automation_components drop constraint %I', v_nombre);
  end loop;

  alter table public.lr_suite_automation_components
    add constraint lr_suite_automation_components_stage_check
    check (stage in ('descarga', 'drive', 'carga', 'modulo', 'asistente', 'correos'));
end $etapa$;

-- ── 2. Las dos piezas ──────────────────────────────────────────────────────
-- Con cron_job: el módulo lee de cron.job si el job existe y está activo, y de cron.job_run_details
-- sus últimas corridas. Sin data_key (no dejan un dato en lr_suite_private_data): su antigüedad se
-- mide desde su última corrida correcta. Sin run_function, por lo dicho arriba.
insert into public.lr_suite_automation_components
  (id, stage, name, brand, source, description, status, cadence, cron_job, run_function, data_key, data_path, sort)
values
  ('correo-gasto', 'correos', 'Alertas de gasto (8:30 a. m.)', null, null,
   'Todos los días a las 8:30, pg_cron le pide a GitHub que mande por correo las mismas alertas que da la campana: pacing por marca y saltos del gasto diario.',
   'activo', 'diaria', 'lr-suite-alertas-gasto', null, null, null, 160),
  ('correo-pendientes', 'correos', 'Resumen personal de pendientes (1 y 5 p. m.)', null, null,
   'De lunes a viernes, a la 1 y a las 5, cada persona recibe su control: lo que cerró hoy, lo que lleva en el mes y lo que le queda abierto o vencido.',
   'activo', 'diaria', 'lr-suite-resumen-persona', null, null, null, 170)
on conflict (id) do nothing;

-- ── 3. Lo que anota cada script al terminar ────────────────────────────────
-- La llaman scripts/correo/alertas-gasto.mjs y scripts/correo/resumen-persona.mjs desde GitHub
-- Actions, con la misma clave que ya usan para pedir los datos: no hace falta ningún secreto nuevo
-- ni la clave de servicio de Supabase. Cada clave solo puede anotar su propia pieza.
create or replace function public.lr_suite_correo_anotar(
  p_clave text,
  p_pieza text,
  p_estado text,
  p_detalle jsonb default '{}'::jsonb,
  p_error text default null,
  p_desde timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $anotar$
declare
  v_clave_id text;
begin
  -- Qué clave manda sobre qué pieza. Una clave no puede anotar la corrida de la otra.
  v_clave_id := case p_pieza
    when 'correo-gasto' then 'alertas-gasto'
    when 'correo-pendientes' then 'pendientes-persona'
  end;
  if v_clave_id is null then
    raise exception 'Esta función solo anota los correos automáticos: %', p_pieza using errcode = '22023';
  end if;

  if p_clave is null or not exists (
    select 1 from public.lr_suite_notificaciones_claves
    where id = v_clave_id and clave = p_clave
  ) then
    raise exception 'clave no válida' using errcode = '42501';
  end if;

  return public.lr_suite_automation_log_run(
    p_pieza,
    case when p_estado = 'ok' then 'ok' else 'error' end,
    coalesce(p_desde, now()),
    now(),
    null,
    coalesce(p_detalle, '{}'::jsonb),
    left(nullif(btrim(coalesce(p_error, '')), ''), 1000),
    'automatica',
    null
  );
end $anotar$;

-- La llaman los workflows con la clave publicable, que es la de anon.
revoke all on function public.lr_suite_correo_anotar(text, text, text, jsonb, text, timestamptz) from public;
grant execute on function public.lr_suite_correo_anotar(text, text, text, jsonb, text, timestamptz) to anon, authenticated;

-- ── 4. Avisar a la API ─────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── 5. Comprobación ────────────────────────────────────────────────────────
-- Lo que debe devolver: las dos piezas, activas, con su job de pg_cron.
select c.id, c.name, c.status, c.cron_job,
       exists (select 1 from cron.job j where j.jobname = c.cron_job) as job_instalado
from public.lr_suite_automation_components c
where c.stage = 'correos'
order by c.sort;

-- Sus corridas (las de pg_cron se leen de cron.job_run_details, estas son las de los scripts):
--   select job, trigger, status, started_at, finished_at, detail, error_detail
--   from public.lr_suite_automation_runs where job like 'correo-%' order by requested_at desc limit 10;
-- Lo que ve el módulo (las dos piezas salen dentro de "components"):
--   select jsonb_pretty(public.lr_suite_automation_status(5));
-- Dejar de mostrarlas sin borrar su historial:
--   update public.lr_suite_automation_components set status = 'pausado', updated_at = now()
--   where stage = 'correos';
