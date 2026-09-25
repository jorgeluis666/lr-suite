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


create table if not exists public.lr_suite_pending_state (
  app_id text primary key,
  tasks jsonb not null default '[]'::jsonb,
  completed_tasks jsonb not null default '[]'::jsonb,
  task_timer jsonb not null default '{"activeTaskId": null, "activeUserKey": null, "activeUserName": null, "activeById": {}, "activeByKey": {}, "dailyById": {}, "dailyByUser": {}, "startedAt": null, "elapsedById": {}}'::jsonb,
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
    and public.is_lr_suite_pending_user()
  );

create policy "allowed users can insert pending state"
  on public.lr_suite_pending_state for insert
  with check (
    app_id = 'lr-suite-pending'
    and public.is_lr_suite_pending_user()
  );

create policy "allowed users can update pending state"
  on public.lr_suite_pending_state for update
  using (
    app_id = 'lr-suite-pending'
    and public.is_lr_suite_pending_user()
  )
  with check (
    app_id = 'lr-suite-pending'
    and public.is_lr_suite_pending_user()
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
