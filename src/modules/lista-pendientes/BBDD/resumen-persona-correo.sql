-- ============================================================================
-- Resumen personal de pendientes: a la 1 y a las 5 de la tarde
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Qué hace: dos veces al día, cada persona de la Suite recibe SU resumen —no el
-- del equipo—: cuántos pendientes cerró y cuántas tareas internas marcó hoy,
-- cuánto lleva trabajado, qué le queda abierto y qué tiene vencido. Lo arma
-- scripts/correo/resumen-persona.mjs desde .github/workflows/resumen-persona.yml.
--
-- A quién le llega: a las cuentas de la Suite, leídas de auth.users. No hay
-- lista de correos que mantener: el resumen es personal, así que los
-- destinatarios son exactamente los usuarios del panel. Un correo por persona,
-- con sus cifras y nada más.
--
-- Qué guarda: solo la clave con la que el workflow pide los datos, en
-- lr_suite_notificaciones_claves (id 'pendientes-persona'). Esa tabla no se lee
-- por la API: la crea alertas-gasto-correo.sql y aquí solo se le agrega la fila.
--
-- De dónde salen las cifras: del mismo estado compartido que ve el tablero
-- (lr_suite_pending_state) y del historial (lr_suite_pending_history). La
-- función no calcula el control: entrega los datos del mes ya recortados a lo
-- que el correo necesita, y la cuenta la hace el script, con las mismas reglas
-- que `pendingScoreForUser()` del index.html.
--
-- Requiere: static-authenticated-state.sql, completed-history-archive.sql y
-- alertas-gasto-correo.sql (la tabla de claves).
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente. Al final muestra
-- la clave: copiarla al secret LR_PERSONA_CLAVE del repositorio en GitHub.
-- ============================================================================

-- ── 1. Clave del envío automático ──────────────────────────────────────────
-- La tabla ya existe si se instaló el correo de gasto; si no, se crea igual.
create table if not exists public.lr_suite_notificaciones_claves (
  id text primary key,
  clave text not null,
  creada_en timestamptz not null default now()
);

insert into public.lr_suite_notificaciones_claves (id, clave)
values (
  'pendientes-persona',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

-- La clave no se lee por la API: RLS sin políticas y sin privilegios.
alter table public.lr_suite_notificaciones_claves enable row level security;
revoke all on public.lr_suite_notificaciones_claves from anon, authenticated;

-- ── 2. Los datos del resumen ───────────────────────────────────────────────
-- Devuelve cuatro cosas, todas recortadas al mes en curso para no bajar de más
-- (el plan es gratuito y cada lectura cuenta):
--   · personas  : las cuentas de la Suite, con el nombre tal como aparece en el
--                 tablero, que es con el que se firman los cierres.
--   · tareas    : los pendientes activos tal como los guarda la Suite (arreglos
--                 por posición: 0 título, 1 responsable, 2 fin, 3 estado,
--                 4 prioridad, 5 inicio, 6 id, 7 creado, 9 tareas internas).
--   · cerrados  : lo que se cerró este mes, con quién lo cerró, cuándo y la
--                 cuenta de tareas internas que se llevó al cerrarse.
--   · tiempos   : los segundos trabajados por día y por persona de este mes, y
--                 los cronómetros que están corriendo ahora mismo (sin ellos,
--                 el correo de la 1 no vería la mañana de quien no ha pausado).
create or replace function public.lr_suite_resumen_persona(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_mes text := to_char(now() at time zone 'America/Lima', 'YYYY-MM');
  v_desde timestamptz := date_trunc('month', now() at time zone 'America/Lima') at time zone 'America/Lima';
begin
  if p_clave is null or not exists (
    select 1 from public.lr_suite_notificaciones_claves
    where id = 'pendientes-persona' and clave = p_clave
  ) then
    raise exception 'clave no válida' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'mes', v_mes,
    -- Las mismas dos cuentas que deja entrar public.is_lr_suite_pending_user()
    -- (completed-history-archive.sql). El nombre se arma como suitePendingOwnerName()
    -- del index.html, porque los cierres se firman con ese nombre y no con el correo.
    'personas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', lower(u.email),
        'nombre', case
          when lower(u.email) like '%jorge%' then 'Jorge Luis'
          when lower(u.email) like '%diego%' then 'Diego'
          else split_part(lower(u.email), '@', 1)
        end
      ) order by lower(u.email))
      from auth.users u
      where u.email_confirmed_at is not null
        and lower(u.email) in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com')
    ), '[]'::jsonb),
    'tareas', coalesce(
      (select tasks from public.lr_suite_pending_state where app_id = 'lr-suite-pending'),
      '[]'::jsonb
    ),
    'cerrados', coalesce((
      select jsonb_agg(jsonb_build_object(
        'titulo', left(coalesce(h.payload->>'title', h.payload->>'titulo', ''), 200),
        'responsable', coalesce(h.payload->>'owner', h.payload->>'responsable', ''),
        'completadoPor', coalesce(h.payload->>'completedBy', ''),
        'completadoEn', coalesce(h.payload->>'completedAt', to_char(h.completed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')),
        'accion', coalesce(h.payload->>'action', h.payload->>'accion', 'completada'),
        'tareas', coalesce(h.payload->'subtasksDoneByUser', '{}'::jsonb)
      ) order by h.completed_at desc)
      from public.lr_suite_pending_history h
      where h.app_id = 'lr-suite-pending'
        and h.completed_at >= v_desde
    ), '[]'::jsonb),
    'tiempos', jsonb_build_object(
      'porDia', coalesce((
        select jsonb_object_agg(dia.clave, dia.valor)
        from public.lr_suite_pending_state estado
        cross join lateral jsonb_each(coalesce(estado.task_timer->'dailyByUser', '{}'::jsonb)) as dia(clave, valor)
        where estado.app_id = 'lr-suite-pending'
          and dia.clave like v_mes || '%'
      ), '{}'::jsonb),
      'corriendo', coalesce((
        select jsonb_build_object(
          'activeById', coalesce(estado.task_timer->'activeById', '{}'::jsonb),
          'activeByKey', coalesce(estado.task_timer->'activeByKey', '{}'::jsonb)
        )
        from public.lr_suite_pending_state estado
        where estado.app_id = 'lr-suite-pending'
      ), '{}'::jsonb)
    ),
    'sincronizado', (select updated_at from public.lr_suite_pending_state where app_id = 'lr-suite-pending')
  );
end;
$$;

revoke all on function public.lr_suite_resumen_persona(text) from public;
grant execute on function public.lr_suite_resumen_persona(text) to anon, authenticated;

-- ── 3. Avisar a la API ─────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── 4. Comprobación y clave ────────────────────────────────────────────────
-- Lo que debe devolver: personas = 2, y la clave para el secret LR_PERSONA_CLAVE
-- de GitHub.
select
  jsonb_array_length(
    public.lr_suite_resumen_persona(
      (select clave from public.lr_suite_notificaciones_claves where id = 'pendientes-persona')
    )->'personas'
  ) as personas,
  (select clave from public.lr_suite_notificaciones_claves where id = 'pendientes-persona') as clave_para_github;
