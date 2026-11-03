-- ============================================================================
-- El asistente de la Agenda dentro del Control de Automatización
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- El módulo «Control de Automatización» dibuja el camino por el que llegan los datos de las
-- marcas: fuentes -> descarga -> Drive -> carga -> dashboard. El asistente de WhatsApp no viaja
-- por ahí: no baja informes ni alimenta un módulo. Por eso entra como una etapa aparte,
-- 'asistente', que el index.html dibuja debajo del proceso y sin flecha que la cuelgue del
-- dashboard, pero que sí cuenta en las métricas y en la lista de corridas.
--
-- Qué hace este script:
--   1. Amplía el check de lr_suite_automation_components.stage con 'asistente'.
--   2. Registra las tres piezas del asistente (webhook, asistente, Google Calendar).
--   3. Deja lr_suite_agenda_automation_anotar(), que es lo que llama la Edge Function del webhook en
--      cada atención: guarda una corrida correcta por pieza y por hora, y todos los errores.
--   4. Deja lr_suite_agenda_automation_sembrar(), que lee la bitácora del asistente
--      (lr_suite_agenda_log) y los mensajes y anota en el Control la actividad real que todavía
--      no estuviera registrada. Así las piezas muestran su estado desde el minuto en que se
--      instala, sin esperar al próximo mensaje de WhatsApp.
--
-- Cómo se mantienen al día después: la Edge Function "whatsapp" anota cada atención (ok y error) y
-- esas corridas terminan en lr_suite_automation_runs con public.lr_suite_automation_log_run(), el
-- camino que el propio Control deja para lo que no corre con pg_cron. Las tres piezas tienen
-- cadencia semanal y ninguna fuente de datos propia, así que su estado sale solo de ahí: si el número
-- lleva días sin recibir nada, la pieza no aparece «al día», pasa a «Atención» y luego a
-- «Atrasado». Ninguna se puede re-ejecutar a mano: no hay nada que volver a correr.
--
-- Requiere, ya instalados:
--   · src/modules/control-automatizacion/BBDD/control-automatizacion.sql
--   · src/modules/agenda/BBDD/agenda.sql
-- Es aditivo: no cambia ninguna tabla, función ni cron de los dos. En una instalación nueva va
-- después de los dos (control-automatizacion.sql crea el check con las cuatro etapas de las
-- marcas y este lo amplía).
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

do $requisitos$
begin
  if to_regclass('public.lr_suite_automation_components') is null then
    raise exception 'Falta el Control de Automatización: ejecuta antes src/modules/control-automatizacion/BBDD/control-automatizacion.sql';
  end if;
  if to_regclass('public.lr_suite_agenda_log') is null then
    raise exception 'Falta la Agenda: ejecuta antes src/modules/agenda/BBDD/agenda.sql';
  end if;
end $requisitos$;

-- ── 1. Una etapa más: el asistente ─────────────────────────────────────────
-- El check viene escrito en la columna, así que se reemplaza entero. Se busca por su definición y no
-- por su nombre: si Postgres le hubiera puesto otro, quedarían dos checks y el viejo seguiría
-- rechazando la etapa nueva. Volver a ejecutar control-automatizacion.sql no lo pisa: su
-- «create table if not exists» no toca la tabla que ya existe.
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
    check (stage in ('descarga', 'drive', 'carga', 'modulo', 'asistente'));
end $etapa$;

-- ── 2. Las tres piezas ─────────────────────────────────────────────────────
-- Sin cron_job (no corre con pg_cron), sin run_function (no hay nada que re-ejecutar) y sin
-- data_key (no deja un dato en lr_suite_private_data): su estado son sus corridas.
insert into public.lr_suite_automation_components
  (id, stage, name, brand, source, description, status, cadence, cron_job, run_function, data_key, data_path, sort)
values
  ('asistente-webhook', 'asistente', 'Webhook de WhatsApp', null, null,
   'Meta entrega aquí cada mensaje que llega al número de la agencia y la Edge Function lo guarda.',
   'activo', 'semanal', null, null, null, null, 130),
  ('asistente-agenda', 'asistente', 'Asistente de la agenda', null, null,
   'Redacta la respuesta, la pasa por el filtro de estándares y la envía por WhatsApp.',
   'activo', 'semanal', null, null, null, null, 140),
  ('asistente-calendar', 'asistente', 'Reuniones en Google Calendar', null, null,
   'Crea el evento y el enlace de Meet cuando el asistente cierra una reunión.',
   'activo', 'semanal', null, null, null, null, 150)
on conflict (id) do nothing;

-- ── 3. Lo que anota la Edge Function en cada atención ──────────────────────
-- Una corrida correcta por pieza y por hora; los errores, todos. Con eso basta para saber que el
-- asistente funciona y cuándo fue lo último que hizo, sin que cien mensajes al día tapen las
-- corridas de las marcas en la lista «Ejecuciones» ni hagan crecer la tabla sin freno.
create or replace function public.lr_suite_agenda_automation_anotar(
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
  v_ultima timestamptz;
begin
  if p_pieza not like 'asistente-%' then
    raise exception 'Esta función solo anota las piezas del asistente: %', p_pieza;
  end if;

  if p_estado = 'ok' then
    select max(r.requested_at) into v_ultima
    from public.lr_suite_automation_runs r
    where r.job = p_pieza and r.status = 'ok';
    if v_ultima is not null and v_ultima > now() - interval '1 hour' then
      return null;
    end if;
  end if;

  return public.lr_suite_automation_log_run(
    p_pieza,
    p_estado,
    coalesce(p_desde, now()),
    now(),
    null,
    p_detalle,
    p_error,
    'automatica',
    null
  );
end $anotar$;

-- ── 4. Traer al Control lo que ya está en la bitácora ──────────────────────
-- Para una pieza: si desde su última corrida registrada hubo un error suyo en la bitácora, se
-- anota ese error; si no, y hubo actividad correcta, se anota esa. Como mucho una corrida por
-- pieza y por llamada, así que se puede volver a ejecutar sin duplicar nada.
create or replace function public.lr_suite_agenda_automation_pieza(
  p_pieza text,
  p_ok timestamptz,
  p_origenes text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $pieza$
declare
  v_desde timestamptz;
  v_error public.lr_suite_agenda_log%rowtype;
begin
  select coalesce(max(r.requested_at), '-infinity'::timestamptz) into v_desde
  from public.lr_suite_automation_runs r
  where r.job = p_pieza;

  select * into v_error
  from public.lr_suite_agenda_log l
  where l.nivel = 'error'
    and l.origen = any (p_origenes)
    and l.creado_at > v_desde
    -- Una firma inválida es una petición de fuera que se descartó bien, no una falla nuestra.
    and l.evento not like 'firma inválida%'
  order by l.creado_at desc
  limit 1;

  if v_error.id is not null and (p_ok is null or v_error.creado_at >= p_ok) then
    perform public.lr_suite_automation_log_run(
      p_pieza, 'error', v_error.creado_at, v_error.creado_at, null,
      jsonb_build_object('bitacora', true, 'origen', v_error.origen),
      left(v_error.evento, 300), 'automatica', null
    );
    return 1;
  end if;

  if p_ok is not null and p_ok > v_desde then
    perform public.lr_suite_automation_log_run(
      p_pieza, 'ok', p_ok, p_ok, null,
      jsonb_build_object('bitacora', true), null, 'automatica', null
    );
    return 1;
  end if;

  return 0;
end $pieza$;

-- Qué cuenta como actividad correcta y qué errores de la bitácora hacen fallar a cada pieza.
create or replace function public.lr_suite_agenda_automation_sembrar()
returns integer
language plpgsql
security definer
set search_path = public
as $sembrar$
declare
  v_total integer := 0;
begin
  -- Webhook: llegó un mensaje del cliente y quedó guardado.
  v_total := v_total + public.lr_suite_agenda_automation_pieza(
    'asistente-webhook',
    (select max(creado_at) from public.lr_suite_agenda_mensajes where rol = 'cliente'),
    array['webhook']
  );
  -- Asistente: salió una respuesta suya. Falla si se cayó el modelo o el filtro de estándares.
  v_total := v_total + public.lr_suite_agenda_automation_pieza(
    'asistente-agenda',
    (select max(creado_at) from public.lr_suite_agenda_mensajes where rol = 'asistente'),
    array['claude', 'validacion']
  );
  -- Calendar: se creó el evento de una cita.
  v_total := v_total + public.lr_suite_agenda_automation_pieza(
    'asistente-calendar',
    (select max(created_at) from public.lr_suite_agenda_citas where google_event_id is not null),
    array['calendar']
  );
  return v_total;
end $sembrar$;

-- Supabase da EXECUTE a anon y authenticated en cada función nueva de public: se retira. La de
-- anotar la llama la Edge Function con service_role; las otras dos son de mantenimiento y las corre
-- Jorge Luis desde el SQL Editor.
revoke execute on function public.lr_suite_agenda_automation_anotar(text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.lr_suite_agenda_automation_anotar(text, text, jsonb, text, timestamptz) to service_role;
revoke execute on function public.lr_suite_agenda_automation_pieza(text, timestamptz, text[]) from public, anon, authenticated;
revoke execute on function public.lr_suite_agenda_automation_sembrar() from public, anon, authenticated;

-- Primera siembra: deja en el Control lo que el asistente ya hizo.
select public.lr_suite_agenda_automation_sembrar() as corridas_sembradas;

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Las tres piezas registradas:
--   select id, stage, name, status, cadence from public.lr_suite_automation_components
--   where stage = 'asistente' order by sort;
-- Sus corridas:
--   select job, trigger, status, started_at, finished_at, detail, error_detail
--   from public.lr_suite_automation_runs where job like 'asistente-%' order by requested_at desc limit 10;
-- Lo que ve el módulo (las tres piezas salen dentro de "components"):
--   select jsonb_pretty(public.lr_suite_automation_status(5));
-- Volver a traer lo nuevo de la bitácora (no duplica lo ya registrado):
--   select public.lr_suite_agenda_automation_sembrar();
-- Dejar de mostrarlas sin borrar su historial:
--   update public.lr_suite_automation_components set status = 'pausado', updated_at = now()
--   where stage = 'asistente';
