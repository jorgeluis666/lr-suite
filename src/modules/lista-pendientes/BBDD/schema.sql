create table if not exists public.lista_pendientes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  titulo text not null,
  responsable text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso')),
  fecha_creacion timestamptz not null default now(),
  fecha_inicio date,
  fecha_fin date,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

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
  accion text not null check (accion in ('completada', 'eliminada'))
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
