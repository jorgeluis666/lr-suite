alter table public.workspace_members
drop constraint if exists workspace_members_rol_check;

alter table public.workspace_members
add constraint workspace_members_rol_check
check (rol in ('superadmin', 'owner', 'admin', 'editor', 'viewer'));

update public.workspace_members
set rol = 'superadmin',
    estado = 'activo'
where lower(email) in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com');

create or replace function public.is_lr_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com')
    or exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = auth.uid()
        and wm.estado = 'activo'
        and wm.rol = 'superadmin'
    );
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
