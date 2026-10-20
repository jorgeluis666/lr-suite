-- ============================================================================
-- Prospección en LinkedIn
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Qué guarda: un registro por perfil de LinkedIn al que la agencia contacta,
-- con nombre, apellido, la URL del perfil, correo, web, empresa y cargo, en qué
-- punto va el contacto (estado) y las fechas de los tres hitos que importan:
-- cuándo se envió la invitación, cuándo se envió la información y cuándo
-- respondió.
--
-- Quién escribe y lee: el módulo «Prospección» del index.html con la sesión de
-- Jorge Luis o Diego, con la misma puerta que el resto de la Suite:
-- public.is_lr_suite_pending_user().
--
-- Ningún dato de prospección vive en el repositorio, que es público: los
-- perfiles se escriben desde el panel.
--
-- Es una tabla propia (no una fila de lr_suite_private_data) porque cada cambio
-- toca un solo perfil: así se escribe una fila y no la lista entera, y dos
-- cuentas pueden trabajar a la vez sin pisarse.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente.
-- ============================================================================

-- ── 1. Tabla de prospectos ─────────────────────────────────────────────────
create table if not exists public.lr_suite_prospectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null default '',
  apellido text not null default '',
  -- La URL del perfil es la identidad del prospecto. Se admite vacía para el
  -- contacto que llegó por otro lado, pero si está, no puede repetirse.
  linkedin_url text not null default '',
  correo text not null default '',
  web text not null default '',
  empresa text not null default '',
  cargo text not null default '',
  estado text not null default 'por_contactar' check (
    estado in (
      'por_contactar',
      'invitacion_enviada',
      'conectado',
      'info_enviada',
      'respondio',
      'reunion',
      'cliente',
      'descartado'
    )
  ),
  notas text not null default '',
  invitacion_enviada_en timestamptz,
  info_enviada_en timestamptz,
  respondio_en timestamptz,
  -- Correo de la cuenta de la Suite que creó el registro.
  creado_por text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un perfil de LinkedIn, un registro: sin esto es fácil contactar dos veces a
-- la misma persona. Parcial, para no bloquear los registros sin URL.
create unique index if not exists lr_suite_prospectos_linkedin_key
  on public.lr_suite_prospectos (lower(linkedin_url))
  where linkedin_url <> '';

-- La lista se lee ordenada por el último movimiento.
create index if not exists lr_suite_prospectos_updated_idx
  on public.lr_suite_prospectos (updated_at desc);

-- ── 2. Permisos ────────────────────────────────────────────────────────────
do $politicas$
begin
  -- Sin esa función no hay puerta que valga: mejor parar aquí que dejar la
  -- tabla abierta.
  if to_regprocedure('public.is_lr_suite_pending_user()') is null then
    raise exception
      'Falta public.is_lr_suite_pending_user(). Ejecuta antes src/modules/lista-pendientes/BBDD/security-hardening-2026-09.sql';
  end if;

  alter table public.lr_suite_prospectos enable row level security;
  -- Supabase concede privilegios a anon y authenticated por defecto: anon se
  -- queda sin nada y authenticated pasa además por las políticas de abajo.
  revoke all on public.lr_suite_prospectos from anon;
  grant select, insert, update, delete on public.lr_suite_prospectos to authenticated;

  drop policy if exists "prospectos lee" on public.lr_suite_prospectos;
  drop policy if exists "prospectos inserta" on public.lr_suite_prospectos;
  drop policy if exists "prospectos actualiza" on public.lr_suite_prospectos;
  drop policy if exists "prospectos borra" on public.lr_suite_prospectos;

  create policy "prospectos lee" on public.lr_suite_prospectos
    for select to authenticated
    using (public.is_lr_suite_pending_user());
  create policy "prospectos inserta" on public.lr_suite_prospectos
    for insert to authenticated
    with check (public.is_lr_suite_pending_user());
  create policy "prospectos actualiza" on public.lr_suite_prospectos
    for update to authenticated
    using (public.is_lr_suite_pending_user())
    with check (public.is_lr_suite_pending_user());
  create policy "prospectos borra" on public.lr_suite_prospectos
    for delete to authenticated
    using (public.is_lr_suite_pending_user());
end $politicas$;

-- ── 3. Avisar a la API ─────────────────────────────────────────────────────
-- PostgREST sirve la API con un esquema cacheado. Sin este aviso, una tabla recién creada puede
-- responder "Could not find the table ... in the schema cache" (PGRST205) y el módulo diría que no
-- existe aunque esté.
notify pgrst, 'reload schema';

-- ── 4. Comprobación ────────────────────────────────────────────────────────
-- Lo que debe devolver: tabla_creada = lr_suite_prospectos y politicas = 4.
select
  to_regclass('public.lr_suite_prospectos') as tabla_creada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'lr_suite_prospectos') as politicas;
