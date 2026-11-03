alter table public.workspace_members
drop constraint if exists workspace_members_rol_check;

alter table public.workspace_members
add constraint workspace_members_rol_check
check (rol in ('superadmin', 'owner', 'admin', 'editor', 'viewer'));

update public.workspace_members
set rol = 'superadmin',
    estado = 'activo'
where lower(email) in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com');

-- Identidad: misma definicion que security-hardening-2026-09.sql (cuenta con email confirmado).
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

drop policy if exists "superadmins can read all workspaces" on public.workspaces;
create policy "superadmins can read all workspaces"
on public.workspaces
for select
using (public.is_lr_superadmin());

drop policy if exists "superadmins can manage all workspace members" on public.workspace_members;
create policy "superadmins can manage all workspace members"
on public.workspace_members
for all
using (public.is_lr_superadmin())
with check (public.is_lr_superadmin());
