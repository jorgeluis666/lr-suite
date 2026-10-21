-- ============================================================================
-- Agenda con asistente de WhatsApp
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Qué guarda:
--   · config        horario de atención, tipos de reunión y reglas de reserva
--   · estandares    cómo debe responder el asistente (lo escribe la agencia en el panel)
--   · conocimiento  lo que el asistente sabe y usa para asesorar (servicios, precios, casos…)
--   · conversaciones + mensajes   la memoria de cada chat de WhatsApp
--   · citas         las reuniones, con el id del evento de Google Calendar
--   · revisiones    cada respuesta: borrador, veredicto del filtro y lo que se envió
--   · solicitudes   lo que el asistente no resuelve solo (reprogramar, cancelar, dudas)
--
-- Quién escribe: la Edge Function "whatsapp" con la service_role key (salta RLS y nunca sale
-- del servidor). Quién lee: el módulo «Agenda» del index.html con la sesión de Jorge Luis o
-- Diego, con la misma puerta que el resto de la Suite: public.is_lr_suite_pending_user().
--
-- Ningún dato del negocio vive en el repositorio, que es público: los textos, precios y
-- horarios se escriben desde el panel.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

-- ── 1. Configuración: horario, tipos de reunión y reglas ───────────────────
-- Una sola fila: una sola agenda de la agencia.
--   horario: { "1": [["09:00","13:00"],["15:00","18:00"]], … } por día ISO (1 lunes … 7 domingo)
--   tipos:   [{ "id": "diagnostico", "nombre": "…", "duracion_min": 30, "modalidad": "Meet",
--              "descripcion": "…", "requisitos": ["marca", "rubro"] }]
create table if not exists public.lr_suite_agenda_config (
  app_id text primary key default 'lr-suite-agenda' check (app_id = 'lr-suite-agenda'),
  zona_horaria text not null default 'America/Lima',
  horario jsonb not null default '{}'::jsonb,
  tipos jsonb not null default '[]'::jsonb,
  duracion_default_min integer not null default 30 check (duracion_default_min between 10 and 480),
  granularidad_min integer not null default 30 check (granularidad_min between 5 and 120),
  anticipacion_min integer not null default 120 check (anticipacion_min >= 0),
  tope_dia integer not null default 4 check (tope_dia > 0),
  feriados jsonb not null default '[]'::jsonb,
  calendar_id text,
  bot_activo boolean not null default true,
  -- Se puede cambiar de modelo desde el panel sin desplegar nada: Haiku para conversar y
  -- validar, Sonnet si hace falta más criterio en la asesoría.
  modelo_conversacion text not null default 'claude-haiku-5-5',
  modelo_validacion text not null default 'claude-haiku-5-5',
  updated_at timestamptz not null default now()
);

-- Migración para una instalación anterior del módulo.
alter table public.lr_suite_agenda_config
  add column if not exists modelo_conversacion text not null default 'claude-haiku-5-5';

alter table public.lr_suite_agenda_config
  add column if not exists modelo_validacion text not null default 'claude-haiku-5-5';

insert into public.lr_suite_agenda_config (app_id) values ('lr-suite-agenda')
on conflict (app_id) do nothing;

-- ── 2. Estándares de respuesta: el input de la agencia ─────────────────────
-- Alimenta la redacción y, sobre todo, la validación del borrador antes de enviarlo.
create table if not exists public.lr_suite_agenda_estandares (
  app_id text primary key default 'lr-suite-agenda' check (app_id = 'lr-suite-agenda'),
  tono text not null default '',
  idioma text not null default 'es-PE',
  largo_max integer not null default 700 check (largo_max between 120 and 4000),
  siempre jsonb not null default '[]'::jsonb,
  nunca jsonb not null default '[]'::jsonb,
  limites jsonb not null default '{}'::jsonb,
  derivar_si jsonb not null default '[]'::jsonb,
  requisitos_cita jsonb not null default '[]'::jsonb,
  respuesta_segura text not null default 'Lo reviso con el equipo y te confirmo en un momento.',
  updated_at timestamptz not null default now()
);

insert into public.lr_suite_agenda_estandares (app_id) values ('lr-suite-agenda')
on conflict (app_id) do nothing;

-- ── 3. Conocimiento del negocio ────────────────────────────────────────────
create table if not exists public.lr_suite_agenda_conocimiento (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'faq'
    check (tipo in ('servicio', 'precio', 'caso', 'objecion', 'diagnostico', 'faq', 'regla')),
  titulo text not null,
  contenido text not null default '',
  orden integer not null default 100,
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists lr_suite_agenda_conocimiento_orden_idx
  on public.lr_suite_agenda_conocimiento(activo, tipo, orden);

-- ── 4. Conversaciones y mensajes (la memoria del chat) ─────────────────────
-- estado 'humano': alguien del equipo tomó la conversación y el asistente deja de responder.
create table if not exists public.lr_suite_agenda_conversaciones (
  wa_id text primary key,
  nombre text,
  estado text not null default 'bot' check (estado in ('bot', 'humano')),
  etapa text not null default 'nuevo'
    check (etapa in ('nuevo', 'diagnostico', 'asesoria', 'propuesta', 'datos', 'agendado', 'cerrado')),
  resumen text not null default '',
  atencion text check (atencion in ('validacion', 'solicitud', 'error')),
  mensajes_count integer not null default 0,
  ultimo_mensaje_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists lr_suite_agenda_conversaciones_ultimo_idx
  on public.lr_suite_agenda_conversaciones(ultimo_mensaje_at desc);

-- wa_message_id: Meta reintenta el mismo webhook, así que el id del mensaje es la defensa
-- contra contestar dos veces lo mismo.
create table if not exists public.lr_suite_agenda_mensajes (
  id bigserial primary key,
  wa_id text not null references public.lr_suite_agenda_conversaciones(wa_id) on delete cascade,
  rol text not null check (rol in ('cliente', 'asistente', 'equipo')),
  texto text not null default '',
  wa_message_id text unique,
  enviado_por text,
  creado_at timestamptz not null default now()
);

create index if not exists lr_suite_agenda_mensajes_chat_idx
  on public.lr_suite_agenda_mensajes(wa_id, creado_at desc);

-- ── 5. Citas ───────────────────────────────────────────────────────────────
-- diagnostico: lo que se averiguó en la conversación, para que quien atienda llegue informado.
create table if not exists public.lr_suite_agenda_citas (
  id uuid primary key default gen_random_uuid(),
  inicio timestamptz not null,
  fin timestamptz not null,
  tipo text not null default 'reunion',
  estado text not null default 'confirmada'
    check (estado in ('confirmada', 'cancelada', 'atendida', 'no_asistio')),
  nombre text not null,
  marca text,
  wa_id text,
  telefono text,
  correo text,
  motivo text,
  diagnostico jsonb not null default '{}'::jsonb,
  origen text not null default 'asistente' check (origen in ('asistente', 'equipo')),
  google_event_id text,
  meet_url text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lr_suite_agenda_citas_rango check (fin > inicio)
);

-- Dos citas confirmadas no pueden pisarse: lo garantiza la base, no el código del bot.
do $cita_choque$
begin
  alter table public.lr_suite_agenda_citas
    add constraint lr_suite_agenda_citas_sin_choque
    exclude using gist ((tstzrange(inicio, fin, '[)')) with &&)
    where (estado = 'confirmada');
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $cita_choque$;

create index if not exists lr_suite_agenda_citas_inicio_idx
  on public.lr_suite_agenda_citas(inicio);

create index if not exists lr_suite_agenda_citas_wa_idx
  on public.lr_suite_agenda_citas(wa_id, inicio desc);

-- ── 6. Revisiones: qué se corrigió o se frenó antes de enviar ──────────────
create table if not exists public.lr_suite_agenda_revisiones (
  id bigserial primary key,
  wa_id text,
  borrador text not null default '',
  enviado text not null default '',
  veredicto text not null check (veredicto in ('aprobado', 'corregido', 'frenado')),
  observaciones jsonb not null default '[]'::jsonb,
  intentos integer not null default 1,
  modelo text,
  creado_at timestamptz not null default now()
);

create index if not exists lr_suite_agenda_revisiones_creado_idx
  on public.lr_suite_agenda_revisiones(creado_at desc);

-- ── 7. Solicitudes: lo que el asistente no resuelve solo ───────────────────
create table if not exists public.lr_suite_agenda_solicitudes (
  id bigserial primary key,
  wa_id text,
  cita_id uuid references public.lr_suite_agenda_citas(id) on delete set null,
  tipo text not null default 'consulta'
    check (tipo in ('reprogramar', 'cancelar', 'consulta', 'otro')),
  detalle text not null default '',
  estado text not null default 'abierta' check (estado in ('abierta', 'resuelta')),
  creado_at timestamptz not null default now(),
  resuelta_at timestamptz,
  resuelta_por text
);

create index if not exists lr_suite_agenda_solicitudes_abiertas_idx
  on public.lr_suite_agenda_solicitudes(estado, creado_at desc);

-- ── 7 bis. Bitácora del asistente ──────────────────────────────────────────
-- Lo que hace la Edge Function: mensajes que entran, respuestas que salen y errores (Meta,
-- Claude, Google). Es lo que alimenta la tira de estado del módulo. Se conserva un mes.
create table if not exists public.lr_suite_agenda_log (
  id bigserial primary key,
  nivel text not null default 'info' check (nivel in ('info', 'error')),
  origen text not null check (origen in ('webhook', 'claude', 'validacion', 'calendar', 'panel')),
  evento text not null,
  wa_id text,
  detalle jsonb not null default '{}'::jsonb,
  creado_at timestamptz not null default now()
);

create index if not exists lr_suite_agenda_log_creado_idx
  on public.lr_suite_agenda_log(creado_at desc);

create index if not exists lr_suite_agenda_log_nivel_idx
  on public.lr_suite_agenda_log(nivel, creado_at desc);

-- Limpieza: la llama la propia función de vez en cuando, así no hace falta otro pg_cron.
create or replace function public.lr_suite_agenda_log_limpiar(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $limpiar$
declare
  v_borradas integer;
begin
  delete from public.lr_suite_agenda_log
  where creado_at < now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 7), 365));
  get diagnostics v_borradas = row_count;
  return v_borradas;
end $limpiar$;

revoke all on function public.lr_suite_agenda_log_limpiar(integer) from public, anon, authenticated;
grant execute on function public.lr_suite_agenda_log_limpiar(integer) to service_role;

-- ── 8. Seguridad: solo Jorge Luis y Diego, con sesión ──────────────────────
-- is_lr_suite_pending_user() es la misma puerta del resto de la Suite
-- (src/modules/lista-pendientes/BBDD/security-hardening-2026-09.sql). La service_role de la
-- Edge Function no pasa por aquí: salta RLS por diseño.
do $politicas$
declare
  v_tabla text;
  v_tablas text[] := array[
    'lr_suite_agenda_config',
    'lr_suite_agenda_estandares',
    'lr_suite_agenda_conocimiento',
    'lr_suite_agenda_conversaciones',
    'lr_suite_agenda_mensajes',
    'lr_suite_agenda_citas',
    'lr_suite_agenda_revisiones',
    'lr_suite_agenda_solicitudes',
    'lr_suite_agenda_log'
  ];
begin
  -- Sin esa función no hay puerta que valga: mejor parar aquí que dejar las tablas abiertas.
  if to_regprocedure('public.is_lr_suite_pending_user()') is null then
    raise exception
      'Falta public.is_lr_suite_pending_user(). Ejecuta antes src/modules/lista-pendientes/BBDD/security-hardening-2026-09.sql';
  end if;

  foreach v_tabla in array v_tablas loop
    execute format('alter table public.%I enable row level security', v_tabla);
    -- Supabase concede privilegios a anon y authenticated por defecto: anon se queda sin nada y
    -- authenticated pasa además por las políticas de abajo.
    execute format('revoke all on public.%I from anon', v_tabla);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_tabla);

    execute format('drop policy if exists "agenda lee" on public.%I', v_tabla);
    execute format('drop policy if exists "agenda inserta" on public.%I', v_tabla);
    execute format('drop policy if exists "agenda actualiza" on public.%I', v_tabla);
    execute format('drop policy if exists "agenda borra" on public.%I', v_tabla);

    execute format(
      'create policy "agenda lee" on public.%I for select to authenticated
         using (public.is_lr_suite_pending_user())', v_tabla);
    execute format(
      'create policy "agenda inserta" on public.%I for insert to authenticated
         with check (public.is_lr_suite_pending_user())', v_tabla);
    execute format(
      'create policy "agenda actualiza" on public.%I for update to authenticated
         using (public.is_lr_suite_pending_user())
         with check (public.is_lr_suite_pending_user())', v_tabla);
    execute format(
      'create policy "agenda borra" on public.%I for delete to authenticated
         using (public.is_lr_suite_pending_user())', v_tabla);
  end loop;
end $politicas$;

-- ── 9. Huecos libres ───────────────────────────────────────────────────────
-- Devuelve los huecos de p_duracion_min que caben dentro del horario de atención, respetan la
-- anticipación mínima y el tope del día, y no pisan ninguna cita confirmada. Lo ocupado en
-- Google Calendar lo descarta la Edge Function con freebusy: aquí no se sale a internet.
create or replace function public.lr_suite_agenda_huecos(
  p_desde date default null,
  p_dias integer default 7,
  p_duracion_min integer default null
)
returns table (inicio timestamptz, fin timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $huecos$
declare
  v_cfg public.lr_suite_agenda_config;
  v_tz text;
  v_desde date;
  v_dias integer := least(greatest(coalesce(p_dias, 7), 1), 60);
  v_dur interval;
  v_paso interval;
  v_minimo timestamptz;
  v_dia date;
  v_dow text;
  v_bloque jsonb;
  v_abre timestamptz;
  v_cierra timestamptz;
  v_slot timestamptz;
  v_del_dia integer;
begin
  select * into v_cfg from public.lr_suite_agenda_config where app_id = 'lr-suite-agenda';
  if not found then
    return;
  end if;

  v_tz := coalesce(nullif(v_cfg.zona_horaria, ''), 'America/Lima');
  v_desde := coalesce(p_desde, (now() at time zone v_tz)::date);
  v_dur := make_interval(mins => coalesce(p_duracion_min, v_cfg.duracion_default_min));
  v_paso := make_interval(mins => v_cfg.granularidad_min);
  v_minimo := now() + make_interval(mins => v_cfg.anticipacion_min);

  for v_dia in
    select d::date from generate_series(v_desde, v_desde + (v_dias - 1), interval '1 day') as d
  loop
    continue when v_cfg.feriados ? to_char(v_dia, 'YYYY-MM-DD');

    select count(*) into v_del_dia
    from public.lr_suite_agenda_citas c
    where c.estado = 'confirmada'
      and (c.inicio at time zone v_tz)::date = v_dia;

    continue when v_del_dia >= v_cfg.tope_dia;

    v_dow := to_char(v_dia, 'ID');

    for v_bloque in
      select jsonb_array_elements(coalesce(v_cfg.horario -> v_dow, '[]'::jsonb))
    loop
      -- Un bloque mal escrito en el panel se salta en lugar de tumbar la consulta.
      continue when coalesce(v_bloque ->> 0, '') !~ '^[0-9]{1,2}:[0-9]{2}$'
        or coalesce(v_bloque ->> 1, '') !~ '^[0-9]{1,2}:[0-9]{2}$';

      v_abre := (v_dia::text || ' ' || (v_bloque ->> 0))::timestamp at time zone v_tz;
      v_cierra := (v_dia::text || ' ' || (v_bloque ->> 1))::timestamp at time zone v_tz;

      v_slot := v_abre;
      while v_slot + v_dur <= v_cierra loop
        if v_slot >= v_minimo
          and not exists (
            select 1
            from public.lr_suite_agenda_citas c
            where c.estado = 'confirmada'
              and tstzrange(c.inicio, c.fin, '[)') && tstzrange(v_slot, v_slot + v_dur, '[)')
          )
        then
          inicio := v_slot;
          fin := v_slot + v_dur;
          return next;
        end if;
        v_slot := v_slot + v_paso;
      end loop;
    end loop;
  end loop;
end $huecos$;

revoke all on function public.lr_suite_agenda_huecos(date, integer, integer) from public, anon;
grant execute on function public.lr_suite_agenda_huecos(date, integer, integer) to authenticated, service_role;

-- ── 10. Reservar ───────────────────────────────────────────────────────────
-- Reserva atómica: si el hueco se ocupó entremedio, la restricción de solapamiento la rechaza y
-- devuelve { "ok": false, "motivo": "ocupado" } para que el asistente ofrezca otro horario.
-- p_forzar lo usa el panel para anotar algo fuera del horario de atención a propósito; el choque
-- con otra cita confirmada no se puede forzar nunca.
create or replace function public.lr_suite_agenda_reservar(
  p_inicio timestamptz,
  p_duracion_min integer,
  p_tipo text,
  p_nombre text,
  p_marca text default null,
  p_wa_id text default null,
  p_telefono text default null,
  p_correo text default null,
  p_motivo text default null,
  p_diagnostico jsonb default '{}'::jsonb,
  p_origen text default 'asistente',
  p_forzar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $reservar$
declare
  v_fin timestamptz;
  v_cita public.lr_suite_agenda_citas;
begin
  if p_inicio is null or coalesce(p_duracion_min, 0) <= 0 or coalesce(trim(p_nombre), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_incompletos');
  end if;

  v_fin := p_inicio + make_interval(mins => p_duracion_min);

  if not p_forzar then
    if not exists (
      select 1
      from public.lr_suite_agenda_huecos((p_inicio at time zone 'UTC')::date - 1, 3, p_duracion_min) h
      where h.inicio = p_inicio
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'fuera_de_horario');
    end if;
  end if;

  begin
    insert into public.lr_suite_agenda_citas
      (inicio, fin, tipo, nombre, marca, wa_id, telefono, correo, motivo, diagnostico, origen)
    values
      (p_inicio, v_fin, coalesce(nullif(p_tipo, ''), 'reunion'), trim(p_nombre), p_marca, p_wa_id,
       p_telefono, p_correo, p_motivo, coalesce(p_diagnostico, '{}'::jsonb),
       case when p_origen = 'equipo' then 'equipo' else 'asistente' end)
    returning * into v_cita;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  if p_wa_id is not null then
    update public.lr_suite_agenda_conversaciones
    set etapa = 'agendado'
    where wa_id = p_wa_id;
  end if;

  return jsonb_build_object('ok', true, 'cita', to_jsonb(v_cita));
end $reservar$;

revoke all on function public.lr_suite_agenda_reservar(
  timestamptz, integer, text, text, text, text, text, text, text, jsonb, text, boolean
) from public, anon;
grant execute on function public.lr_suite_agenda_reservar(
  timestamptz, integer, text, text, text, text, text, text, text, jsonb, text, boolean
) to authenticated, service_role;

-- ── 11. Mover y cancelar (las usa el panel) ────────────────────────────────
-- Devuelven el google_event_id para que la función del panel actualice o borre el evento.
create or replace function public.lr_suite_agenda_mover(
  p_cita_id uuid,
  p_inicio timestamptz,
  p_duracion_min integer default null,
  p_forzar boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $mover$
declare
  v_cita public.lr_suite_agenda_citas;
  v_dur integer;
begin
  select * into v_cita from public.lr_suite_agenda_citas where id = p_cita_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  v_dur := coalesce(p_duracion_min, (extract(epoch from (v_cita.fin - v_cita.inicio)) / 60)::integer);

  if not p_forzar and not exists (
    select 1
    from public.lr_suite_agenda_huecos((p_inicio at time zone 'UTC')::date - 1, 3, v_dur) h
    where h.inicio = p_inicio
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_horario');
  end if;

  begin
    update public.lr_suite_agenda_citas
    set inicio = p_inicio,
        fin = p_inicio + make_interval(mins => v_dur),
        updated_at = now()
    where id = p_cita_id
    returning * into v_cita;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  return jsonb_build_object('ok', true, 'cita', to_jsonb(v_cita));
end $mover$;

revoke all on function public.lr_suite_agenda_mover(uuid, timestamptz, integer, boolean) from public, anon;
grant execute on function public.lr_suite_agenda_mover(uuid, timestamptz, integer, boolean) to authenticated, service_role;

create or replace function public.lr_suite_agenda_cancelar(
  p_cita_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $cancelar$
declare
  v_cita public.lr_suite_agenda_citas;
begin
  update public.lr_suite_agenda_citas
  set estado = 'cancelada',
      notas = case
                when coalesce(trim(p_motivo), '') = '' then notas
                else trim(coalesce(notas || E'\n', '') || 'Cancelada: ' || trim(p_motivo))
              end,
      updated_at = now()
  where id = p_cita_id
  returning * into v_cita;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  return jsonb_build_object('ok', true, 'cita', to_jsonb(v_cita));
end $cancelar$;

revoke all on function public.lr_suite_agenda_cancelar(uuid, text) from public, anon;
grant execute on function public.lr_suite_agenda_cancelar(uuid, text) to authenticated, service_role;

-- ── 12. Resumen para el panel ──────────────────────────────────────────────
-- Una sola lectura por pantalla: citas del rango, conversaciones recientes, solicitudes
-- abiertas y contadores. Pensada para gastar poco egress (plan gratuito).
create or replace function public.lr_suite_agenda_resumen(
  p_desde date default null,
  p_dias integer default 7,
  p_chats integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $resumen$
declare
  v_cfg public.lr_suite_agenda_config;
  v_tz text;
  v_desde date;
  v_hasta date;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'sin permiso';
  end if;

  select * into v_cfg from public.lr_suite_agenda_config where app_id = 'lr-suite-agenda';
  v_tz := coalesce(nullif(v_cfg.zona_horaria, ''), 'America/Lima');
  v_desde := coalesce(p_desde, (now() at time zone v_tz)::date);
  v_hasta := v_desde + least(greatest(coalesce(p_dias, 7), 1), 60);

  return jsonb_build_object(
    'zona_horaria', v_tz,
    'bot_activo', coalesce(v_cfg.bot_activo, true),
    'desde', v_desde,
    'hasta', v_hasta,
    'citas', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.inicio)
      from public.lr_suite_agenda_citas c
      where c.inicio >= (v_desde::text || ' 00:00')::timestamp at time zone v_tz
        and c.inicio < (v_hasta::text || ' 00:00')::timestamp at time zone v_tz
    ), '[]'::jsonb),
    'conversaciones', coalesce((
      select jsonb_agg(to_jsonb(t))
      from (
        select *
        from public.lr_suite_agenda_conversaciones
        order by ultimo_mensaje_at desc
        limit least(greatest(coalesce(p_chats, 40), 1), 200)
      ) t
    ), '[]'::jsonb),
    'solicitudes', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.creado_at desc)
      from public.lr_suite_agenda_solicitudes s
      where s.estado = 'abierta'
    ), '[]'::jsonb),
    'salud', jsonb_build_object(
      'ultimo_entrante', (
        select max(creado_at) from public.lr_suite_agenda_mensajes where rol = 'cliente'
      ),
      'ultima_respuesta', (
        select max(creado_at) from public.lr_suite_agenda_mensajes where rol = 'asistente'
      ),
      'errores_7d', (
        select count(*)
        from public.lr_suite_agenda_log
        where nivel = 'error' and creado_at > now() - interval '7 days'
      ),
      'ultimo_error', (
        select to_jsonb(t)
        from (
          select origen, evento, detalle, creado_at
          from public.lr_suite_agenda_log
          where nivel = 'error'
          order by creado_at desc
          limit 1
        ) t
      ),
      'calendario', case when coalesce(nullif(v_cfg.calendar_id, ''), '') = '' then 'sin_configurar' else 'configurado' end
    ),
    'contadores', jsonb_build_object(
      'citas_hoy', (
        select count(*)
        from public.lr_suite_agenda_citas c
        where c.estado = 'confirmada'
          and (c.inicio at time zone v_tz)::date = (now() at time zone v_tz)::date
      ),
      'chats_atencion', (
        select count(*) from public.lr_suite_agenda_conversaciones where atencion is not null
      ),
      'chats_humano', (
        select count(*) from public.lr_suite_agenda_conversaciones where estado = 'humano'
      ),
      'revisiones_frenadas_7d', (
        select count(*)
        from public.lr_suite_agenda_revisiones
        where veredicto = 'frenado' and creado_at > now() - interval '7 days'
      )
    )
  );
end $resumen$;

revoke all on function public.lr_suite_agenda_resumen(date, integer, integer) from public, anon;
grant execute on function public.lr_suite_agenda_resumen(date, integer, integer) to authenticated;

-- ── 13. Historial de un chat ───────────────────────────────────────────────
create or replace function public.lr_suite_agenda_chat(
  p_wa_id text,
  p_limite integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $chat$
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'sin permiso';
  end if;

  return jsonb_build_object(
    'conversacion', (
      select to_jsonb(c) from public.lr_suite_agenda_conversaciones c where c.wa_id = p_wa_id
    ),
    'mensajes', coalesce((
      select jsonb_agg(to_jsonb(t) order by (t.creado_at))
      from (
        select *
        from public.lr_suite_agenda_mensajes
        where wa_id = p_wa_id
        order by creado_at desc
        limit least(greatest(coalesce(p_limite, 60), 1), 300)
      ) t
    ), '[]'::jsonb),
    'citas', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.inicio desc)
      from public.lr_suite_agenda_citas c
      where c.wa_id = p_wa_id
    ), '[]'::jsonb),
    'revisiones', coalesce((
      select jsonb_agg(to_jsonb(t))
      from (
        select *
        from public.lr_suite_agenda_revisiones
        where wa_id = p_wa_id
        order by creado_at desc
        limit 20
      ) t
    ), '[]'::jsonb)
  );
end $chat$;

revoke all on function public.lr_suite_agenda_chat(text, integer) from public, anon;
grant execute on function public.lr_suite_agenda_chat(text, integer) to authenticated;
