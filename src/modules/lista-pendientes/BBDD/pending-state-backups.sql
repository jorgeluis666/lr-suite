create table if not exists public.lr_suite_pending_backups (
  backup_key text primary key,
  app_id text not null,
  state_version bigint not null default 0,
  tasks jsonb not null default '[]'::jsonb,
  completed_tasks jsonb not null default '[]'::jsonb,
  task_timer jsonb not null default '{}'::jsonb,
  actor_name text,
  reason text not null default 'cambio',
  created_at timestamptz not null default now()
);

create index if not exists lr_suite_pending_backups_app_created_idx
  on public.lr_suite_pending_backups(app_id, created_at desc);

alter table public.lr_suite_pending_backups enable row level security;

drop policy if exists "allowed users can read pending backups" on public.lr_suite_pending_backups;
drop policy if exists "allowed users can insert pending backups" on public.lr_suite_pending_backups;

create policy "allowed users can read pending backups"
  on public.lr_suite_pending_backups for select
  using (
    app_id = 'lr-suite-pending'
    and (auth.role() = 'anon' or auth.email() in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com'))
  );

create policy "allowed users can insert pending backups"
  on public.lr_suite_pending_backups for insert
  with check (
    app_id = 'lr-suite-pending'
    and (auth.role() = 'anon' or auth.email() in ('jorgeluis@limaretail.com', 'diegomachuca@limaretail.com'))
  );

-- No se crean politicas UPDATE o DELETE: cada snapshot es append-only.

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
  concat('initial-', state.app_id, '-', state.state_version, '-', extract(epoch from state.updated_at)::bigint),
  state.app_id,
  state.state_version,
  state.tasks,
  state.completed_tasks,
  state.task_timer,
  state.actor_name,
  'snapshot-inicial'
from public.lr_suite_pending_state state
where state.app_id = 'lr-suite-pending'
on conflict (backup_key) do nothing;

-- Instalar despues pending-backup-trigger-and-view.sql para que cada cambio
-- genere el snapshot desde la BBDD y para consultar un pendiente por fila.
