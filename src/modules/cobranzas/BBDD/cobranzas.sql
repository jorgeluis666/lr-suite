-- Ejecutar en el SQL Editor de Supabase. Requiere el control de acceso de LR Suite.
begin;
create table if not exists public.lr_suite_cobranzas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 1 and 200),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'),
  empresa text not null check (length(trim(empresa)) between 1 and 200),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'completado')),
  -- Metadatos operativos; no son campos de registro del contacto.
  ultimo_intento date,
  ultimo_envio timestamptz
);
-- No duplicar a una persona de la misma empresa por diferencias de mayúsculas/espacios.
create unique index if not exists lr_suite_cobranzas_contacto
  on public.lr_suite_cobranzas (lower(trim(email)), lower(trim(empresa)));
alter table public.lr_suite_cobranzas enable row level security;
revoke all on public.lr_suite_cobranzas from anon, authenticated;
grant select on public.lr_suite_cobranzas to authenticated;
grant insert (nombre, email, empresa) on public.lr_suite_cobranzas to authenticated;
grant update (nombre, email, empresa, estado) on public.lr_suite_cobranzas to authenticated;
drop policy if exists cobranzas_lectura on public.lr_suite_cobranzas;
create policy cobranzas_lectura on public.lr_suite_cobranzas for select to authenticated
  using ((select public.is_lr_suite_pending_user()));
drop policy if exists cobranzas_alta on public.lr_suite_cobranzas;
create policy cobranzas_alta on public.lr_suite_cobranzas for insert to authenticated
  with check ((select public.is_lr_suite_pending_user()));
drop policy if exists cobranzas_cambio on public.lr_suite_cobranzas;
create policy cobranzas_cambio on public.lr_suite_cobranzas for update to authenticated
  using ((select public.is_lr_suite_pending_user()))
  with check ((select public.is_lr_suite_pending_user()));
-- No añade datos de contacto: son eventos técnicos de cada intento.
alter table public.lr_suite_cobranzas add column if not exists seguimiento_pausado boolean not null default false;
grant update (seguimiento_pausado) on public.lr_suite_cobranzas to authenticated;
create table if not exists public.lr_suite_cobranzas_envios (
  id uuid primary key default gen_random_uuid(),
  contacto_id uuid not null references public.lr_suite_cobranzas(id),
  creado_en timestamptz not null default now(),
  dia date not null,
  remitente text not null,
  estado text not null default 'preparado' check (estado in ('preparado','aceptado_smtp','rechazado','error','cancelado')),
  codigo_smtp integer,
  seguimiento_apertura boolean not null default false,
  token_apertura uuid not null unique default gen_random_uuid(),
  primera_apertura timestamptz,
  unique (contacto_id, dia)
);
create index if not exists cobranzas_envios_contacto_fecha on public.lr_suite_cobranzas_envios(contacto_id, creado_en desc);
alter table public.lr_suite_cobranzas_envios enable row level security;
revoke all on public.lr_suite_cobranzas_envios from anon, authenticated;
-- El token de apertura no se devuelve al navegador ni permite consultar el contacto.
grant select (id, contacto_id, creado_en, dia, remitente, estado, codigo_smtp, seguimiento_apertura, primera_apertura)
  on public.lr_suite_cobranzas_envios to authenticated;
grant select, insert, update on public.lr_suite_cobranzas_envios to service_role;
drop policy if exists cobranzas_envios_lectura on public.lr_suite_cobranzas_envios;
create policy cobranzas_envios_lectura on public.lr_suite_cobranzas_envios for select to authenticated
  using ((select public.is_lr_suite_pending_user()));
commit;
