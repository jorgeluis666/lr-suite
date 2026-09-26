-- ============================================================================
-- Instalacion completa de LR Suite (index.html) en un proyecto Supabase NUEVO
-- Proyecto: brfsipssqfsuoplxxcth (organizacion "Lima Retail Pendientes", plan gratuito)
--
-- El proyecto anterior (ucyhnwuxmcwnyllrdzds) quedo restringido el 2026-09-25 por exceder la cuota
-- de egress del plan gratuito. Este script junta en un solo archivo lo que index.html necesita:
-- pendientes compartidos, historial, respaldos, cotizaciones privadas y el canal Realtime privado.
-- Mismas reglas de acceso que security-hardening-2026-09.sql.
--
-- Ejecutar completo en Supabase > SQL Editor del proyecto nuevo. Es idempotente.
-- Despues: crear las dos cuentas en Authentication > Users (ver README de esta carpeta).
-- ============================================================================

-- ── Identidad: solo Jorge Luis y Diego, con email confirmado ───────────────
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

revoke execute on function public.is_lr_suite_pending_user() from public, anon;
grant execute on function public.is_lr_suite_pending_user() to authenticated;

-- ── Estado compartido de pendientes (una fila) ─────────────────────────────
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

-- ── Historial de completadas (append-only) ─────────────────────────────────
create table if not exists public.lr_suite_pending_history (
  record_id text primary key,
  app_id text not null,
  completed_at timestamptz not null,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);

create index if not exists lr_suite_pending_history_app_completed_idx
  on public.lr_suite_pending_history(app_id, completed_at desc);

-- ── Respaldos del estado (append-only) ─────────────────────────────────────
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

-- ── Datos comerciales privados (cotizaciones) ──────────────────────────────
create table if not exists public.lr_suite_private_data (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── Permisos: nada para anon; lo justo para authenticated (el resto lo filtra RLS) ──
revoke all on public.lr_suite_pending_state, public.lr_suite_pending_history,
  public.lr_suite_pending_backups, public.lr_suite_private_data from anon;
grant select, insert, update on public.lr_suite_pending_state to authenticated;
grant select, insert on public.lr_suite_pending_history to authenticated;
grant select, insert on public.lr_suite_pending_backups to authenticated;
grant select, insert, update on public.lr_suite_private_data to authenticated;

alter table public.lr_suite_pending_state enable row level security;
alter table public.lr_suite_pending_history enable row level security;
alter table public.lr_suite_pending_backups enable row level security;
alter table public.lr_suite_private_data enable row level security;

drop policy if exists "allowed users can read pending state" on public.lr_suite_pending_state;
drop policy if exists "allowed users can insert pending state" on public.lr_suite_pending_state;
drop policy if exists "allowed users can update pending state" on public.lr_suite_pending_state;
drop policy if exists "allowed users can read pending history" on public.lr_suite_pending_history;
drop policy if exists "allowed users can insert pending history" on public.lr_suite_pending_history;
drop policy if exists "allowed users can read pending backups" on public.lr_suite_pending_backups;
drop policy if exists "allowed users can insert pending backups" on public.lr_suite_pending_backups;
drop policy if exists "lr suite users can read private data" on public.lr_suite_private_data;
drop policy if exists "lr suite users can insert private data" on public.lr_suite_private_data;
drop policy if exists "lr suite users can update private data" on public.lr_suite_private_data;

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

-- Fila compartida vacia: el primer navegador que entra sube su copia local (la fusion es por union).
insert into public.lr_suite_pending_state (app_id)
values ('lr-suite-pending')
on conflict (app_id) do nothing;

-- ── Respaldo automatico en cada cambio, con limpieza ───────────────────────
-- En el proyecto anterior los respaldos crecian sin limite (cada cambio guarda el tablero entero) y
-- ocupaban buena parte de los 0,5 GB del plan gratuito. Se conservan los ultimos 7 dias y, como minimo,
-- los 50 mas recientes.
create or replace function public.backup_lr_suite_pending_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.tasks = old.tasks
    and new.completed_tasks = old.completed_tasks
    and new.task_timer = old.task_timer then
    return new;
  end if;

  insert into public.lr_suite_pending_backups (
    backup_key, app_id, state_version, tasks, completed_tasks, task_timer, actor_name, reason
  )
  values (
    concat(
      new.app_id, '-', new.state_version, '-', extract(epoch from clock_timestamp())::bigint, '-',
      substr(md5(new.tasks::text || new.completed_tasks::text || new.task_timer::text), 1, 12)
    ),
    new.app_id, new.state_version, new.tasks, new.completed_tasks, new.task_timer, new.actor_name,
    'trigger-bbdd'
  )
  on conflict (backup_key) do nothing;

  delete from public.lr_suite_pending_backups b
  where b.app_id = new.app_id
    and b.created_at < now() - interval '7 days'
    and b.backup_key not in (
      select recent.backup_key
      from public.lr_suite_pending_backups recent
      where recent.app_id = new.app_id
      order by recent.created_at desc
      limit 50
    );

  return new;
end;
$$;

drop trigger if exists lr_suite_pending_state_backup_trigger on public.lr_suite_pending_state;
create trigger lr_suite_pending_state_backup_trigger
after insert or update on public.lr_suite_pending_state
for each row execute function public.backup_lr_suite_pending_state();

-- ── Canal Realtime privado "lr-suite-pending-live" ─────────────────────────
-- index.html solo usa broadcast (aviso "changed", presencia, temporizador); no usa postgres_changes,
-- por eso las tablas no se agregan a la publicacion supabase_realtime.
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
