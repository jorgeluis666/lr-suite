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
-- El aviso que se envía: una sola fila editable desde el módulo. No guarda datos de contacto.
create table if not exists public.lr_suite_cobranzas_mensaje (
  id smallint primary key default 1 check (id = 1),
  asunto text not null check (length(trim(asunto)) between 1 and 200),
  cuerpo text not null check (length(trim(cuerpo)) between 1 and 5000),
  actualizado_en timestamptz not null default now()
);
-- La siembra es el mismo texto que `scripts/correo/cobranzas.mjs`; al reinstalar no pisa lo editado.
-- El replace deja saltos \n aunque este archivo se guarde con finales de línea de Windows.
insert into public.lr_suite_cobranzas_mensaje (id, asunto, cuerpo)
values (1, 'Aviso de saldo pendiente de regularización - Lima Retail', replace($msg$Estimados,

Nos ponemos en contacto desde la agencia Lima Retail para recordarles que mantenemos registrada una deuda pendiente a su nombre. Les solicitamos amablemente su apoyo para regularizar este pago a la brevedad posible. Si ya realizaron el abono correspondiente, por favor omitan este mensaje. En caso contrario, les pedimos nos contacten respondiendo a este correo o a través de nuestros canales habituales para coordinar el comprobante o resolver cualquier duda.

Quedamos atentos a su respuesta.

Área de Administración
Agencia Lima Retail
administracion@limaretail.com$msg$, E'\r\n', E'\n'))
on conflict (id) do nothing;
-- La fecha la pone la base: el navegador no la puede falsear.
create or replace function public.lr_suite_cobranzas_mensaje_fecha() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  new.id := 1;
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists cobranzas_mensaje_fecha on public.lr_suite_cobranzas_mensaje;
create trigger cobranzas_mensaje_fecha before update on public.lr_suite_cobranzas_mensaje
  for each row execute function public.lr_suite_cobranzas_mensaje_fecha();
alter table public.lr_suite_cobranzas_mensaje enable row level security;
revoke all on public.lr_suite_cobranzas_mensaje from anon, authenticated;
grant select on public.lr_suite_cobranzas_mensaje to authenticated, service_role;
grant update (asunto, cuerpo) on public.lr_suite_cobranzas_mensaje to authenticated;
drop policy if exists cobranzas_mensaje_lectura on public.lr_suite_cobranzas_mensaje;
create policy cobranzas_mensaje_lectura on public.lr_suite_cobranzas_mensaje for select to authenticated
  using ((select public.is_lr_suite_pending_user()));
drop policy if exists cobranzas_mensaje_cambio on public.lr_suite_cobranzas_mensaje;
create policy cobranzas_mensaje_cambio on public.lr_suite_cobranzas_mensaje for update to authenticated
  using ((select public.is_lr_suite_pending_user()))
  with check ((select public.is_lr_suite_pending_user()));
commit;
