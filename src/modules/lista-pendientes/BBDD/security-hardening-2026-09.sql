-- ============================================================================
-- Endurecimiento de seguridad (septiembre 2026)
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente: se puede correr mas de una vez.
--
-- Cierra:
--   1. Pendientes compartidos legibles y escribibles por cualquiera con la anon key
--      (las politicas aceptaban auth.role() = 'anon').
--   2. Canal Realtime "lr-suite-pending-live" publico: cualquiera podia escuchar y enviar eventos.
--   3. Escalada a superadmin: un usuario registrado podia insertarse en workspace_members con
--      rol 'superadmin' (o en un workspace ajeno) y is_lr_superadmin() le daba acceso global.
--   4. Al aceptar una invitacion se podia cambiar el propio rol (viewer -> owner).
--   5. Un viewer podia crear, editar y borrar pendientes de lista_pendientes.
--   6. Cotizaciones con datos de contacto escritas en el index.html publico (ahora en lr_suite_private_data).
--
-- Requisitos en el panel de Supabase (no se pueden hacer desde SQL):
--   - Authentication > Providers > Email: desactivar "Allow new users to sign up" si no se usa el
--     registro publico, y dejar activado "Confirm email".
--   - Realtime > Settings: desactivar "Allow public access" para que solo existan canales privados.
--   - Cambiar las contraseñas de jorgeluis@ y diegomachuca@ (las anteriores estuvieron publicadas en
--     el index.html del repositorio).
-- ============================================================================

-- ── 1. Pendientes compartidos: solo Jorge Luis y Diego, autenticados ────────
create or replace function public.is_lr_suite_pending_user()
returns boolean
language sql
stable
as $$
  select auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com');
$$;

drop policy if exists "allowed users can read pending state" on public.lr_suite_pending_state;
drop policy if exists "allowed users can insert pending state" on public.lr_suite_pending_state;
drop policy if exists "allowed users can update pending state" on public.lr_suite_pending_state;

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

drop policy if exists "allowed users can read pending history" on public.lr_suite_pending_history;
drop policy if exists "allowed users can insert pending history" on public.lr_suite_pending_history;

create policy "allowed users can read pending history"
  on public.lr_suite_pending_history for select to authenticated
  using (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can insert pending history"
  on public.lr_suite_pending_history for insert to authenticated
  with check (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

drop policy if exists "allowed users can read pending backups" on public.lr_suite_pending_backups;
drop policy if exists "allowed users can insert pending backups" on public.lr_suite_pending_backups;

create policy "allowed users can read pending backups"
  on public.lr_suite_pending_backups for select to authenticated
  using (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

create policy "allowed users can insert pending backups"
  on public.lr_suite_pending_backups for insert to authenticated
  with check (app_id = 'lr-suite-pending' and public.is_lr_suite_pending_user());

-- La vista es security_invoker, pero ademas se le quita el permiso a anon.
revoke all on public.lr_suite_pending_tasks_view from anon;
grant select on public.lr_suite_pending_tasks_view to authenticated;

-- ── 1b. Datos comerciales privados (cotizaciones) ───────────────────────────
-- index.html ya no trae las cotizaciones escritas en el codigo: las lee de aqui despues del login.
-- La carga inicial esta en LR-suite/private/cotizaciones-seed.local.sql (fuera de git).
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
-- index.html se une a "lr-suite-pending-live" con config.private = true.
-- Si el proyecto es anterior a Realtime Authorization y no existe realtime.messages, el bloque avisa y
-- sigue: en ese caso el canal privado no conecta y hay que actualizar Realtime desde el panel.
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

-- ── 3. Superadmin solo por email, nunca por una fila editable ──────────────
create or replace function public.is_lr_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com');
$$;

-- Alta de miembros: un usuario solo se agrega a si mismo como owner de un workspace que es suyo
-- (lo que hace la app al crear un workspace). Invitar a otros sigue siendo de owners/admins.
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

-- ── 4. Nadie cambia su propio rol ni se asigna 'superadmin' ────────────────
create or replace function public.guard_workspace_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SQL Editor / migraciones (no pasan por la API): sin restriccion.
  if session_user <> 'authenticator' then
    return new;
  end if;
  if public.is_lr_superadmin() then
    return new;
  end if;
  if new.rol = 'superadmin' then
    raise exception 'Rol no permitido';
  end if;
  if tg_op = 'UPDATE'
     and new.rol is distinct from old.rol
     and not public.is_workspace_manager(old.workspace_id) then
    raise exception 'Solo un owner o admin puede cambiar roles';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_workspace_member_role on public.workspace_members;
create trigger guard_workspace_member_role
  before insert or update on public.workspace_members
  for each row execute function public.guard_workspace_member_role();

-- ── 5. lista_pendientes: los viewers solo leen ─────────────────────────────
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
