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


create table if not exists public.lr_suite_pending_history (
  record_id text primary key,
  app_id text not null,
  completed_at timestamptz not null,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);

create index if not exists lr_suite_pending_history_app_completed_idx
  on public.lr_suite_pending_history(app_id, completed_at desc);

alter table public.lr_suite_pending_history enable row level security;

drop policy if exists "allowed users can read pending history" on public.lr_suite_pending_history;
drop policy if exists "allowed users can insert pending history" on public.lr_suite_pending_history;

create policy "allowed users can read pending history"
  on public.lr_suite_pending_history for select
  using (
    app_id = 'lr-suite-pending'
    and public.is_lr_suite_pending_user()
  );

create policy "allowed users can insert pending history"
  on public.lr_suite_pending_history for insert
  with check (
    app_id = 'lr-suite-pending'
    and public.is_lr_suite_pending_user()
  );

do $$
begin
  begin
    alter publication supabase_realtime add table public.lr_suite_pending_history;
  exception
    when duplicate_object then null;
  end;
end $$;

-- Initial recovery: preserve any history still present in the shared snapshot.
-- The dynamic statement keeps this migration valid if the snapshot table has
-- not been installed yet.
do $$
begin
  if to_regclass('public.lr_suite_pending_state') is not null then
    execute $recovery$
      insert into public.lr_suite_pending_history (record_id, app_id, completed_at, payload)
      select
        coalesce(
          item->>'completedRecordId',
          concat(
            'recovered-',
            coalesce(item->>'id', 'task'),
            '-',
            md5(item::text)
          )
        ),
        state.app_id,
        coalesce((item->>'completedAt')::timestamptz, state.updated_at),
        item
      from public.lr_suite_pending_state state
      cross join lateral jsonb_array_elements(state.completed_tasks) item
      where state.app_id = 'lr-suite-pending'
      on conflict (record_id) do nothing
    $recovery$;
  end if;
end $$;
