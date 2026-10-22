-- ============================================================================
-- Resumen diario de pendientes por correo
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Qué hace: todos los días a las 8:30 a. m. de Lima, el workflow
-- .github/workflows/resumen-pendientes.yml manda por correo un resumen de los
-- pendientes abiertos (scripts/correo/resumen-pendientes.mjs).
--
-- Qué guarda:
--   · lr_suite_notificaciones: la lista de correos que reciben el resumen. Se
--     edita con la ruedita del panel de Notificaciones de la Suite, con la
--     sesión de Jorge Luis o Diego (public.is_lr_suite_pending_user()).
--   · lr_suite_notificaciones_claves: la clave con la que el workflow pide el
--     resumen. Nadie la lee desde la API: solo la función de abajo.
--
-- Cómo lee el workflow: llama a public.lr_suite_resumen_pendientes(clave) con
-- la clave publicable de la Suite. La función comprueba la clave y devuelve
-- los pendientes y los correos; sin la clave no devuelve nada.
--
-- Ningún correo de terceros vive en el repositorio, que es público: la lista
-- se escribe desde el panel.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente. Al final muestra
-- la clave: copiarla al secret LR_PENDIENTES_CLAVE del repositorio en GitHub.
-- ============================================================================

-- ── 1. Lista de correos ─────────────────────────────────────────────────────
create table if not exists public.lr_suite_notificaciones (
  id text primary key,
  -- [{ "nombre": "Jorge Luis", "email": "jorgeluis@limaretail.com" }, ...]
  destinatarios jsonb not null default '[]'::jsonb check (jsonb_typeof(destinatarios) = 'array'),
  actualizado_en timestamptz not null default now(),
  actualizado_por text not null default ''
);

-- Al instalar, el resumen llega a las dos cuentas de la Suite. Después la lista
-- se cambia desde el panel; volver a ejecutar este archivo no la pisa.
insert into public.lr_suite_notificaciones (id, destinatarios, actualizado_por)
values (
  'resumen-pendientes',
  '[{"nombre": "Jorge Luis", "email": "jorgeluis@limaretail.com"}, {"nombre": "Diego", "email": "diegomachuca@limaretail.com"}]'::jsonb,
  'instalación'
)
on conflict (id) do nothing;

-- ── 2. Clave del envío automático ──────────────────────────────────────────
create table if not exists public.lr_suite_notificaciones_claves (
  id text primary key,
  clave text not null,
  creada_en timestamptz not null default now()
);

insert into public.lr_suite_notificaciones_claves (id, clave)
values (
  'resumen-pendientes',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

-- ── 3. Permisos ────────────────────────────────────────────────────────────
do $politicas$
begin
  if to_regprocedure('public.is_lr_suite_pending_user()') is null then
    raise exception
      'Falta public.is_lr_suite_pending_user(). Ejecuta antes src/modules/lista-pendientes/BBDD/security-hardening-2026-09.sql';
  end if;

  alter table public.lr_suite_notificaciones enable row level security;
  revoke all on public.lr_suite_notificaciones from anon;
  grant select, insert, update on public.lr_suite_notificaciones to authenticated;

  drop policy if exists "notificaciones lee" on public.lr_suite_notificaciones;
  drop policy if exists "notificaciones inserta" on public.lr_suite_notificaciones;
  drop policy if exists "notificaciones actualiza" on public.lr_suite_notificaciones;

  create policy "notificaciones lee" on public.lr_suite_notificaciones
    for select to authenticated
    using (public.is_lr_suite_pending_user());
  create policy "notificaciones inserta" on public.lr_suite_notificaciones
    for insert to authenticated
    with check (public.is_lr_suite_pending_user());
  create policy "notificaciones actualiza" on public.lr_suite_notificaciones
    for update to authenticated
    using (public.is_lr_suite_pending_user())
    with check (public.is_lr_suite_pending_user());

  -- La clave no se lee por la API: RLS sin políticas y sin privilegios.
  alter table public.lr_suite_notificaciones_claves enable row level security;
  revoke all on public.lr_suite_notificaciones_claves from anon, authenticated;
end $politicas$;

-- ── 4. Resumen para el workflow ────────────────────────────────────────────
-- Devuelve los pendientes activos tal como los guarda la Suite (arreglos por
-- posición: 0 título, 1 responsable, 2 fin, 3 estado, 4 prioridad, 5 inicio,
-- 6 id, 7 creado, 9 subtareas) y la lista de correos.
create or replace function public.lr_suite_resumen_pendientes(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clave is null or not exists (
    select 1 from public.lr_suite_notificaciones_claves
    where id = 'resumen-pendientes' and clave = p_clave
  ) then
    raise exception 'clave no válida' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'destinatarios', coalesce(
      (select destinatarios from public.lr_suite_notificaciones where id = 'resumen-pendientes'),
      '[]'::jsonb
    ),
    'tareas', coalesce(
      (select tasks from public.lr_suite_pending_state where app_id = 'lr-suite-pending'),
      '[]'::jsonb
    ),
    'sincronizado', (select updated_at from public.lr_suite_pending_state where app_id = 'lr-suite-pending')
  );
end;
$$;

revoke all on function public.lr_suite_resumen_pendientes(text) from public;
grant execute on function public.lr_suite_resumen_pendientes(text) to anon, authenticated;

-- ── 5. Avisar a la API ─────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── 6. Comprobación y clave ────────────────────────────────────────────────
-- Lo que debe devolver: politicas = 3, correos = 2 (o los que ya se guardaron)
-- y la clave para el secret LR_PENDIENTES_CLAVE de GitHub.
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'lr_suite_notificaciones') as politicas,
  (select jsonb_array_length(destinatarios) from public.lr_suite_notificaciones where id = 'resumen-pendientes') as correos,
  (select clave from public.lr_suite_notificaciones_claves where id = 'resumen-pendientes') as clave_para_github;
