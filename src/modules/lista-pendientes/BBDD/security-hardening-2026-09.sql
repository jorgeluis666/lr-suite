-- ============================================================================
-- Endurecimiento de seguridad (septiembre 2026)
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente: se puede correr mas de una vez.
--
-- ANTES de ejecutarlo, guardar una copia del estado actual para poder volver atras:
--   select * from pg_policies where schemaname in ('public', 'realtime');
--   select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('is_lr_superadmin', 'complete_pending_task', 'cleanup_pending_data',
--                        'reorder_pending_tasks', 'guard_workspace_member_role');
--
-- Cierra:
--   1. Pendientes compartidos (estado, historial, respaldos) legibles y escribibles con la anon key.
--   2. Canal Realtime "lr-suite-pending-live" publico.
--   3. Escalada de privilegios en workspace_members: insertarse en workspaces ajenos, asignarse
--      superadmin/owner, mover una invitacion a otro workspace, cambiarse el propio rol.
--   4. Viewers que escribian pendientes directamente o a traves de las RPC security definer.
--   5. Tablas de Control ROAS (empresas, costos, registros_roas) y mc_leads sin RLS versionado.
--   6. Cotizaciones con datos de contacto escritas en el index.html publico (ahora en lr_suite_private_data).
--   7. Superadmin decidido solo por el email del JWT (ahora exige cuenta con email confirmado).
--
-- Requisitos en el panel de Supabase (no se pueden hacer desde SQL):
--   - Authentication > Providers > Email: desactivar "Allow new users to sign up" si no se usa el
--     registro publico, y dejar activado "Confirm email".
--   - Realtime > Settings: desactivar "Allow public access" para que solo existan canales privados.
--   - Cambiar las contraseñas de jorgeluis@ y diegomachuca@ (las anteriores estuvieron publicadas en
--     el index.html del repositorio).
--
-- Despues de ejecutarlo, revisar que no queden politicas permisivas ajenas a este script en
-- realtime.messages:  select * from pg_policies where schemaname = 'realtime';
-- ============================================================================

-- ── 0. Identidad: los dos usuarios de LR Suite, con email confirmado ───────
-- Se comprueba contra auth.users (no solo el claim del JWT) y se exige email confirmado: si una de las
-- cuentas se borrara y el registro estuviera abierto, recrearla sin confirmar no da acceso.
create or replace function public.is_lr_suite_pending_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com')
  );
$$;

create or replace function public.is_lr_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_lr_suite_pending_user();
$$;

-- ── 1. Pendientes compartidos: solo Jorge Luis y Diego ─────────────────────
-- Se borran TODAS las politicas de estas tablas (no solo las de nombre conocido): una politica vieja
-- con otro nombre que aceptara anon seguiria abierta, porque las politicas permisivas se suman.
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('lr_suite_pending_state', 'lr_suite_pending_history', 'lr_suite_pending_backups')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.lr_suite_pending_state enable row level security;
alter table public.lr_suite_pending_history enable row level security;
alter table public.lr_suite_pending_backups enable row level security;
revoke all on public.lr_suite_pending_state, public.lr_suite_pending_history, public.lr_suite_pending_backups from anon;

create policy "allowed users can read pending state"
  on public.lr_suite_pending_state for select to authenticated
  using (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can insert pending state"
  on public.lr_suite_pending_state for insert to authenticated
  with check (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can update pending state"
  on public.lr_suite_pending_state for update to authenticated
  using (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user())
  with check (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can read pending history"
  on public.lr_suite_pending_history for select to authenticated
  using (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can insert pending history"
  on public.lr_suite_pending_history for insert to authenticated
  with check (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can read pending backups"
  on public.lr_suite_pending_backups for select to authenticated
  using (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can insert pending backups"
  on public.lr_suite_pending_backups for insert to authenticated
  with check (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

-- La vista es security_invoker; ademas se le quita el permiso a anon.
do $$
begin
  if to_regclass('public.lr_suite_pending_tasks_view') is not null then
    revoke all on public.lr_suite_pending_tasks_view from anon;
    grant select on public.lr_suite_pending_tasks_view to authenticated;
  end if;
end $$;

-- ── 1b. Datos comerciales privados (cotizaciones) ───────────────────────────
-- index.html y /cotizaciones leen de aqui despues del login. La carga inicial esta en
-- LR-suite/private/cotizaciones-seed.local.sql (fuera de git).
create table if not exists public.lr_suite_private_data (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.lr_suite_private_data enable row level security;
revoke all on public.lr_suite_private_data from anon;

drop policy if exists "lr suite users can read private data" on public.lr_suite_private_data;
drop policy if exists "lr suite users can insert private data" on public.lr_suite_private_data;
drop policy if exists "lr suite users can update private data" on public.lr_suite_private_data;

create policy "lr suite users can read private data"
  on public.lr_suite_private_data for select to authenticated
  using (public.is_lr_suite_pending_user());

create policy "lr suite users can insert private data"
  on public.lr_suite_private_data for insert to authenticated
  with check (public.is_lr_suite_pending_user());

create policy "lr suite users can update private data"
  on public.lr_suite_private_data for update to authenticated
  using (public.is_lr_suite_pending_user())
  with check (public.is_lr_suite_pending_user());

-- ── 2. Canal Realtime privado ──────────────────────────────────────────────
-- index.html se une a "lr-suite-pending-live" con config.private = true. Si el proyecto no tiene
-- realtime.messages (Realtime Authorization), el bloque avisa y sigue.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages no existe: activar Realtime Authorization en el panel de Supabase';
    return;
  end if;
  execute 'drop policy if exists "lr suite pending users can receive live events" on realtime.messages';
  execute 'drop policy if exists "lr suite pending users can send live events" on realtime.messages';
  execute $p$
    create policy "lr suite pending users can receive live events"
      on realtime.messages for select to authenticated
      using (realtime.topic() = 'lr-suite-pending-live' and public.is_lr_suite_pending_user())
  $p$;
  execute $p$
    create policy "lr suite pending users can send live events"
      on realtime.messages for insert to authenticated
      with check (realtime.topic() = 'lr-suite-pending-live' and public.is_lr_suite_pending_user())
  $p$;
end $$;

-- ── 3. Workspaces y membresias ─────────────────────────────────────────────
-- Quien crea un workspace tiene que poder leerlo antes de ser miembro: sin esto el alta del primer
-- workspace (insert ... select, y la politica de alta de miembros de abajo) falla.
drop policy if exists "owners can read own workspaces" on public.workspaces;
create policy "owners can read own workspaces"
  on public.workspaces for select to authenticated
  using (owner_id = auth.uid());

-- Alta de miembros: managers del workspace, superadmins, o el dueño agregandose a su propio workspace.
drop policy if exists "workspace managers can invite members" on public.workspace_members;
create policy "workspace managers can invite members"
  on public.workspace_members for insert to authenticated
  with check (
    public.is_workspace_manager(workspace_id)
    or public.is_lr_superadmin()
    or (
      user_id = auth.uid()
      and rol = 'owner'
      and exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.owner_id = auth.uid()
      )
    )
  );

-- El invitado tiene que poder ver su propia invitacion pendiente: un UPDATE con WHERE solo alcanza
-- filas visibles por alguna politica de SELECT, y "members can read workspace members" no la cubre
-- (todavia no es miembro ni tiene user_id). Sin esta politica aceptar una invitacion no hace nada.
drop policy if exists "users can read own invitations" on public.workspace_members;
create policy "users can read own invitations"
  on public.workspace_members for select to authenticated
  using (lower(email) = lower(auth.email()));

-- Aceptar una invitacion: solo la propia (por email) y sin cambiar de email.
drop policy if exists "users can accept own invitations" on public.workspace_members;
create policy "users can accept own invitations"
  on public.workspace_members for update to authenticated
  using (lower(email) = lower(auth.email()) and estado = 'pendiente')
  with check (user_id = auth.uid() and estado = 'activo' and lower(email) = lower(auth.email()));

-- Borrar miembros: managers, pero la fila del owner solo la toca el dueño del workspace.
drop policy if exists "workspace managers can delete members" on public.workspace_members;
create policy "workspace managers can delete members"
  on public.workspace_members for delete to authenticated
  using (
    public.is_workspace_manager(workspace_id)
    and (
      rol <> 'owner'
      or exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.owner_id = auth.uid()
      )
    )
  );

-- Reglas que las politicas no pueden expresar (comparar con la fila anterior):
--   - nadie se asigna 'superadmin' (salvo los superadmins);
--   - nadie cambia su propio rol ni mueve una membresia a otro workspace;
--   - solo el dueño del workspace asigna o quita el rol owner;
--   - nadie se agrega a un workspace que no es suyo.
create or replace function public.guard_workspace_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_superadmin boolean := false;
  caller_owns_workspace boolean := false;
begin
  -- SQL Editor / migraciones y el backend con service_role: sin restriccion.
  if session_user <> 'authenticator' or auth.role() = 'service_role' then
    return new;
  end if;
  if to_regprocedure('public.is_lr_superadmin()') is not null then
    execute 'select public.is_lr_superadmin()' into caller_is_superadmin;
  end if;
  if caller_is_superadmin then
    return new;
  end if;
  if new.rol = 'superadmin' then
    raise exception 'Rol no permitido';
  end if;

  select exists (
    select 1 from public.workspaces w
    where w.id = new.workspace_id and w.owner_id = auth.uid()
  ) into caller_owns_workspace;

  if tg_op = 'INSERT' then
    if new.user_id = auth.uid() and not caller_owns_workspace then
      raise exception 'No puedes agregarte a un workspace ajeno';
    end if;
    if new.rol = 'owner' and not caller_owns_workspace then
      raise exception 'Solo el dueño del workspace asigna el rol owner';
    end if;
    return new;
  end if;

  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'No se puede mover una membresia a otro workspace';
  end if;
  if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, ''))
     and not public.is_workspace_manager(old.workspace_id) then
    raise exception 'Solo un owner o admin puede cambiar el email de una membresia';
  end if;
  if new.rol is distinct from old.rol then
    if old.user_id = auth.uid() then
      raise exception 'No puedes cambiar tu propio rol';
    end if;
    if not public.is_workspace_manager(old.workspace_id) then
      raise exception 'Solo un owner o admin puede cambiar roles';
    end if;
    if (new.rol = 'owner' or old.rol = 'owner') and not caller_owns_workspace then
      raise exception 'Solo el dueño del workspace asigna o quita el rol owner';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_workspace_member_role on public.workspace_members;
create trigger guard_workspace_member_role
  before insert or update on public.workspace_members
  for each row execute function public.guard_workspace_member_role();

-- ── 4. lista_pendientes: los viewers solo leen ─────────────────────────────
create or replace function public.is_workspace_editor(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.estado = 'activo'
      and wm.rol in ('superadmin', 'owner', 'admin', 'editor')
  );
$$;

grant execute on function public.is_workspace_editor(uuid) to authenticated;

-- LR-suite guarda la prioridad como 'Media' y LR-Pendientes como 'media' en la misma tabla; cada
-- schema.sql instalaba un check que solo aceptaba uno de los dos formatos. Se aceptan ambos.
alter table public.lista_pendientes drop constraint if exists lista_pendientes_prioridad_check;
alter table public.lista_pendientes
  add constraint lista_pendientes_prioridad_check
  check (lower(prioridad) in ('alta', 'media', 'baja'));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lista_pendientes_completadas' and column_name = 'prioridad'
  ) then
    alter table public.lista_pendientes_completadas drop constraint if exists lista_pendientes_completadas_prioridad_check;
    alter table public.lista_pendientes_completadas
      add constraint lista_pendientes_completadas_prioridad_check
      check (lower(prioridad) in ('alta', 'media', 'baja'));
  end if;
end $$;

drop policy if exists "workspace members can insert pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can update pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can delete pending tasks" on public.lista_pendientes;

create policy "workspace members can insert pending tasks"
  on public.lista_pendientes for insert to authenticated
  with check (public.is_workspace_editor(workspace_id));

create policy "workspace members can update pending tasks"
  on public.lista_pendientes for update to authenticated
  using (public.is_workspace_editor(workspace_id))
  with check (public.is_workspace_editor(workspace_id));

create policy "workspace members can delete pending tasks"
  on public.lista_pendientes for delete to authenticated
  using (public.is_workspace_editor(workspace_id));

drop policy if exists "workspace members can insert completed tasks" on public.lista_pendientes_completadas;
drop policy if exists "workspace members can delete completed tasks" on public.lista_pendientes_completadas;

create policy "workspace members can insert completed tasks"
  on public.lista_pendientes_completadas for insert to authenticated
  with check (public.is_workspace_editor(workspace_id));

create policy "workspace members can delete completed tasks"
  on public.lista_pendientes_completadas for delete to authenticated
  using (public.is_workspace_editor(workspace_id));

-- Las RPC son security definer (se saltan RLS): antes bastaba ser miembro para completar, eliminar,
-- reordenar o purgar. Mismo cuerpo que LR-Pendientes/.../lista-pendientes/BBDD/schema.sql, con la
-- comprobacion cambiada a is_workspace_editor.
create or replace function public.complete_pending_task(
  task_id uuid,
  task_action text,
  actor_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_task public.lista_pendientes%rowtype;
  completed_id uuid;
  total_seconds bigint;
begin
  if task_action not in ('completada', 'eliminada') then
    raise exception 'Accion invalida para completar pendiente: %', task_action;
  end if;

  select *
    into pending_task
  from public.lista_pendientes
  where id = task_id
  for update;

  if not found then
    raise exception 'Pendiente no encontrado o no disponible';
  end if;

  if not public.is_workspace_editor(pending_task.workspace_id) then
    raise exception 'No tienes permiso para completar este pendiente';
  end if;

  total_seconds :=
    pending_task.tiempo_acumulado_segundos +
    case
      when pending_task.temporizador_inicio is null then 0
      else greatest(0, floor(extract(epoch from (now() - pending_task.temporizador_inicio)))::bigint)
    end;

  insert into public.lista_pendientes_completadas (
    workspace_id,
    original_task_id,
    titulo,
    responsable,
    fecha_creacion,
    fecha_finalizacion,
    usuario_accion_id,
    usuario_accion_nombre,
    accion,
    prioridad,
    fecha_inicio,
    fecha_fin,
    tiempo_total_segundos,
    subtareas
  )
  values (
    pending_task.workspace_id,
    pending_task.id,
    pending_task.titulo,
    pending_task.responsable,
    pending_task.fecha_creacion,
    now(),
    auth.uid(),
    coalesce(nullif(actor_name, ''), auth.email(), 'Usuario'),
    task_action,
    pending_task.prioridad,
    pending_task.fecha_inicio,
    pending_task.fecha_fin,
    total_seconds,
    pending_task.subtareas
  )
  returning id into completed_id;

  delete from public.lista_pendientes
  where id = pending_task.id;

  return completed_id;
end;
$$;

create or replace function public.cleanup_pending_data(
  target_workspace_id uuid,
  retention_days integer default 90
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  if not public.is_workspace_editor(target_workspace_id) then
    raise exception 'No tienes permiso para limpiar este workspace';
  end if;

  delete from public.lista_pendientes_completadas
  where workspace_id = target_workspace_id
    and accion = 'eliminada'
    and fecha_finalizacion < now() - make_interval(days => greatest(retention_days, 30));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.reorder_pending_tasks(
  target_workspace_id uuid,
  ordered_task_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_task_count bigint;
  supplied_task_count bigint;
begin
  if not public.is_workspace_editor(target_workspace_id) then
    raise exception 'No tienes permiso para ordenar este workspace';
  end if;

  select count(*) into active_task_count
  from public.lista_pendientes
  where workspace_id = target_workspace_id;

  select count(distinct task_id) into supplied_task_count
  from unnest(ordered_task_ids) as task_id;

  if active_task_count <> supplied_task_count
    or exists (
      select 1
      from unnest(ordered_task_ids) as task_id
      where not exists (
        select 1
        from public.lista_pendientes pending
        where pending.id = task_id
          and pending.workspace_id = target_workspace_id
      )
    )
  then
    raise exception 'La lista cambio durante el ordenamiento; vuelve a intentarlo';
  end if;

  update public.lista_pendientes pending
  set
    orden = ordered.position - 1,
    updated_at = now()
  from unnest(ordered_task_ids) with ordinality as ordered(task_id, position)
  where pending.id = ordered.task_id
    and pending.workspace_id = target_workspace_id;

  perform public.cleanup_pending_data(target_workspace_id, 90);
end;
$$;

-- Postgres concede EXECUTE a PUBLIC por defecto: las RPC que modifican datos quedan solo para usuarios
-- autenticados. Las funciones is_* no se tocan: las usan politicas sin "to authenticated" y para anon
-- devuelven false.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_workspace_with_owner(text)',
    'public.complete_pending_task(uuid,text,text)',
    'public.cleanup_pending_data(uuid,integer)',
    'public.reorder_pending_tasks(uuid,uuid[])'
  ] loop
    if to_regprocedure(fn) is null then
      raise notice 'No existe %, se omite', fn;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ── 5. Control ROAS (empresas, costos, registros_roas) ─────────────────────
-- No habia RLS versionado. Se reemplazan todas sus politicas por: leer = miembros del workspace o
-- superadmin; escribir = editores del workspace o superadmin. En costos y registros_roas la empresa
-- tiene que ser del mismo workspace (no se puede apuntar a empresas de otro cliente).
do $$
declare
  t text;
  r record;
  empresa_check text;
begin
  foreach t in array array['empresas', 'costos', 'registros_roas'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'No existe la tabla %, se omite', t;
      continue;
    end if;

    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);

    empresa_check := case
      when t = 'empresas' then 'true'
      else format(
        '(empresa_id is null or exists (select 1 from public.empresas e where e.id = %I.empresa_id and e.workspace_id = %I.workspace_id))',
        t, t
      )
    end;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id) or public.is_lr_superadmin())',
      'members can read ' || t, t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((public.is_workspace_editor(workspace_id) or public.is_lr_superadmin()) and %s)',
      'editors can insert ' || t, t, empresa_check
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_workspace_editor(workspace_id) or public.is_lr_superadmin()) with check ((public.is_workspace_editor(workspace_id) or public.is_lr_superadmin()) and %s)',
      'editors can update ' || t, t, empresa_check
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_workspace_editor(workspace_id) or public.is_lr_superadmin())',
      'editors can delete ' || t, t
    );
  end loop;
end $$;

-- ── 6. mc_leads (datos personales de leads de ManyChat) ────────────────────
-- Solo lectura para los dos usuarios de LR Suite. No se borran sus politicas ni se quita INSERT a anon
-- porque no se sabe si un proceso externo (webhook) escribe con la anon key; si escribe con
-- service_role, conviene revocar tambien INSERT: revoke insert on public.mc_leads from anon;
do $$
begin
  if to_regclass('public.mc_leads') is null then
    raise notice 'No existe la tabla mc_leads, se omite';
    return;
  end if;
  alter table public.mc_leads enable row level security;
  revoke select, update, delete on public.mc_leads from anon;
  drop policy if exists "lr suite users can read leads" on public.mc_leads;
  create policy "lr suite users can read leads"
    on public.mc_leads for select to authenticated
    using (public.is_lr_suite_pending_user());
end $$;
