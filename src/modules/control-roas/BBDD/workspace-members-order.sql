alter table public.workspace_members
add column if not exists orden integer;

update public.workspace_members
set orden = 1
where lower(coalesce(email, '')) like '%diego%';

update public.workspace_members
set orden = 2
where lower(coalesce(email, '')) like '%jorge%'
   or lower(coalesce(email, '')) like '%jorgeluis%';

create index if not exists workspace_members_workspace_order_idx
  on public.workspace_members(workspace_id, orden, email);
