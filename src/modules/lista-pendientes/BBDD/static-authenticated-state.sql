create table if not exists public.lr_suite_pending_state (
  app_id text primary key,
  tasks jsonb not null default '[]'::jsonb,
  completed_tasks jsonb not null default '[]'::jsonb,
  task_timer jsonb not null default '{"activeTaskId": null, "activeUserKey": null, "activeUserName": null, "activeById": {}, "activeByKey": {}, "startedAt": null, "elapsedById": {}}'::jsonb,
  presence jsonb not null default '{}'::jsonb,
  source_id text,
  actor_name text,
  state_version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.lr_suite_pending_state
  add column if not exists actor_name text;

alter table public.lr_suite_pending_state
  add column if not exists state_version bigint not null default 0;

alter table public.lr_suite_pending_state enable row level security;

drop policy if exists "allowed users can read pending state" on public.lr_suite_pending_state;
drop policy if exists "allowed users can insert pending state" on public.lr_suite_pending_state;
drop policy if exists "allowed users can update pending state" on public.lr_suite_pending_state;

create policy "allowed users can read pending state"
  on public.lr_suite_pending_state for select
  using (
    app_id = 'lr-suite-pending'
    and auth.email() in ('jorgeluis@limaretail.com', 'diego@limaretail.com')
  );

create policy "allowed users can insert pending state"
  on public.lr_suite_pending_state for insert
  with check (
    app_id = 'lr-suite-pending'
    and auth.email() in ('jorgeluis@limaretail.com', 'diego@limaretail.com')
  );

create policy "allowed users can update pending state"
  on public.lr_suite_pending_state for update
  using (
    app_id = 'lr-suite-pending'
    and auth.email() in ('jorgeluis@limaretail.com', 'diego@limaretail.com')
  )
  with check (
    app_id = 'lr-suite-pending'
    and auth.email() in ('jorgeluis@limaretail.com', 'diego@limaretail.com')
  );

insert into public.lr_suite_pending_state (app_id)
values ('lr-suite-pending')
on conflict (app_id) do nothing;

do $$
begin
  begin
    alter publication supabase_realtime add table public.lr_suite_pending_state;
  exception
    when duplicate_object then null;
  end;
end $$;
