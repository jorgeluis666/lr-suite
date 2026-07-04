create table if not exists public.lista_pendientes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  titulo text not null,
  responsable text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'bloqueado')),
  fecha_creacion timestamptz not null default now(),
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  prioridad text not null default 'Media' check (prioridad in ('Alta', 'Media', 'Baja')),
  tiempo_trabajado integer not null default 0,
  checklist jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Migración para tablas existentes: ejecutar este bloque en el SQL Editor de Supabase.
alter table public.lista_pendientes
  add column if not exists checklist jsonb not null default '[]'::jsonb;

alter table public.lista_pendientes
  add column if not exists prioridad text not null default 'Media';

alter table public.lista_pendientes
  add column if not exists tiempo_trabajado integer not null default 0;

alter table public.lista_pendientes
  drop constraint if exists lista_pendientes_estado_check;

alter table public.lista_pendientes
  add constraint lista_pendientes_estado_check
  check (estado in ('pendiente', 'en_proceso', 'bloqueado'));

alter table public.lista_pendientes
  drop constraint if exists lista_pendientes_prioridad_check;

alter table public.lista_pendientes
  add constraint lista_pendientes_prioridad_check
  check (prioridad in ('Alta', 'Media', 'Baja'));

alter table public.lista_pendientes_completadas
  add column if not exists tiempo_trabajado integer not null default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lista_pendientes'
      and column_name = 'fecha_inicio'
      and data_type = 'date'
  ) then
    alter table public.lista_pendientes
      alter column fecha_inicio type timestamptz
      using fecha_inicio::timestamp at time zone 'America/Lima';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lista_pendientes'
      and column_name = 'fecha_fin'
      and data_type = 'date'
  ) then
    alter table public.lista_pendientes
      alter column fecha_fin type timestamptz
      using fecha_fin::timestamp at time zone 'America/Lima';
  end if;
end $$;

create table if not exists public.lista_pendientes_completadas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  original_task_id uuid,
  titulo text not null,
  responsable text,
  fecha_creacion timestamptz not null,
  fecha_finalizacion timestamptz not null default now(),
  usuario_accion_id uuid references auth.users(id) on delete set null,
  usuario_accion_nombre text not null,
  accion text not null check (accion in ('completada', 'eliminada')),
  tiempo_trabajado integer not null default 0
);

create index if not exists lista_pendientes_workspace_idx
  on public.lista_pendientes(workspace_id, fecha_creacion);

create index if not exists lista_pendientes_completadas_workspace_idx
  on public.lista_pendientes_completadas(workspace_id, fecha_finalizacion desc);

alter table public.lista_pendientes enable row level security;
alter table public.lista_pendientes_completadas enable row level security;

drop policy if exists "workspace members can read pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can insert pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can update pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can delete pending tasks" on public.lista_pendientes;

create policy "workspace members can read pending tasks"
  on public.lista_pendientes for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can insert pending tasks"
  on public.lista_pendientes for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can update pending tasks"
  on public.lista_pendientes for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can delete pending tasks"
  on public.lista_pendientes for delete
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

drop policy if exists "workspace members can read completed tasks" on public.lista_pendientes_completadas;
drop policy if exists "workspace members can insert completed tasks" on public.lista_pendientes_completadas;

create policy "workspace members can read completed tasks"
  on public.lista_pendientes_completadas for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes_completadas.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can insert completed tasks"
  on public.lista_pendientes_completadas for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes_completadas.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

do $$
begin
  begin
    alter publication supabase_realtime add table public.lista_pendientes;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.lista_pendientes_completadas;
  exception
    when duplicate_object then null;
  end;
end $$;
