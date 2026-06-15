create or replace function public.backup_lr_suite_pending_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_key text;
begin
  if tg_op = 'UPDATE'
    and new.tasks = old.tasks
    and new.completed_tasks = old.completed_tasks
    and new.task_timer = old.task_timer then
    return new;
  end if;

  snapshot_key := concat(
    new.app_id,
    '-',
    new.state_version,
    '-',
    extract(epoch from clock_timestamp())::bigint,
    '-',
    substr(md5(new.tasks::text || new.completed_tasks::text || new.task_timer::text), 1, 12)
  );

  insert into public.lr_suite_pending_backups (
    backup_key,
    app_id,
    state_version,
    tasks,
    completed_tasks,
    task_timer,
    actor_name,
    reason
  )
  values (
    snapshot_key,
    new.app_id,
    new.state_version,
    new.tasks,
    new.completed_tasks,
    new.task_timer,
    new.actor_name,
    'trigger-bbdd'
  )
  on conflict (backup_key) do nothing;

  return new;
end;
$$;

drop trigger if exists lr_suite_pending_state_backup_trigger
  on public.lr_suite_pending_state;

create trigger lr_suite_pending_state_backup_trigger
after insert or update
on public.lr_suite_pending_state
for each row
execute function public.backup_lr_suite_pending_state();

create or replace view public.lr_suite_pending_tasks_view
with (security_invoker = true)
as
select
  state.app_id,
  task.item->>6 as task_id,
  task.item->>0 as tarea,
  task.item->>1 as responsable,
  nullif(task.item->>5, '')::timestamp as inicio,
  nullif(task.item->>2, '')::timestamp as fin,
  task.item->>4 as prioridad,
  task.item->>3 as estado,
  nullif(task.item->>7, '')::timestamptz as creada_en,
  state.updated_at as sincronizada_en,
  task.position as orden
from public.lr_suite_pending_state state
cross join lateral jsonb_array_elements(state.tasks)
  with ordinality as task(item, position)
where state.app_id = 'lr-suite-pending';

grant select on public.lr_suite_pending_tasks_view to anon, authenticated;

-- Crea una copia de control con la informacion que exista al instalar este cambio.
insert into public.lr_suite_pending_backups (
  backup_key,
  app_id,
  state_version,
  tasks,
  completed_tasks,
  task_timer,
  actor_name,
  reason
)
select
  concat(
    'trigger-install-',
    state.app_id,
    '-',
    state.state_version,
    '-',
    extract(epoch from clock_timestamp())::bigint
  ),
  state.app_id,
  state.state_version,
  state.tasks,
  state.completed_tasks,
  state.task_timer,
  state.actor_name,
  'trigger-instalado'
from public.lr_suite_pending_state state
where state.app_id = 'lr-suite-pending'
on conflict (backup_key) do nothing;
