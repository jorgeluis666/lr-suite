-- ============================================================================
-- Alertas de gasto diarias por correo
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- Qué hace: todos los días a las 8:30 a. m. de Lima, el workflow
-- .github/workflows/alertas-gasto.yml manda por correo las mismas alertas que da
-- la campana de la Suite (scripts/correo/alertas-gasto.mjs): el total del mes, el
-- pacing de cada marca que no va en ritmo y las anomalías del gasto diario.
--
-- Hasta octubre de 2026 este correo era el resumen de pendientes. La lista de
-- correos es la misma, así que las filas 'resumen-pendientes' se renombran a
-- 'alertas-gasto' más abajo: no se pierde ningún correo ya cargado ni la clave.
--
-- Qué guarda:
--   · lr_suite_notificaciones: la lista de correos que reciben las alertas. Se
--     edita con la ruedita del panel de Notificaciones de la Suite, con la
--     sesión de Jorge Luis o Diego (public.is_lr_suite_pending_user()).
--   · lr_suite_notificaciones_claves: la clave con la que el workflow pide las
--     alertas. Nadie la lee desde la API: solo la función de abajo.
--
-- Cómo lee el workflow: llama a public.lr_suite_alertas_gasto(clave) con la
-- clave publicable de la Suite. La función comprueba la clave y devuelve el
-- informe de gasto y los correos; sin la clave no devuelve nada.
--
-- Ningún correo de terceros, ni nombre de cuenta, ni cifra vive en el
-- repositorio, que es público: todo sale de Supabase.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente. Al final muestra
-- la clave: copiarla al secret LR_GASTO_CLAVE del repositorio en GitHub.
-- ============================================================================

-- ── 1. Lista de correos ─────────────────────────────────────────────────────
create table if not exists public.lr_suite_notificaciones (
  id text primary key,
  -- [{ "nombre": "Jorge Luis", "email": "jorgeluis@limaretail.com" }, ...]
  destinatarios jsonb not null default '[]'::jsonb check (jsonb_typeof(destinatarios) = 'array'),
  actualizado_en timestamptz not null default now(),
  actualizado_por text not null default ''
);

-- ── 2. Clave del envío automático ──────────────────────────────────────────
create table if not exists public.lr_suite_notificaciones_claves (
  id text primary key,
  clave text not null,
  creada_en timestamptz not null default now()
);

-- ── 3. La lista y la clave que ya existían se quedan ───────────────────────
-- El correo cambió de contenido, no de destinatarios: la fila del resumen de
-- pendientes pasa a llamarse 'alertas-gasto' con sus correos y su clave.
--
-- No depende de en qué orden se haga todo. Si el index.html nuevo se publica
-- antes que esto, la ruedita busca la fila 'alertas-gasto', que todavía no
-- existe, y muestra la lista vacía; si alguien le da Guardar ahí, crea esa fila
-- sin correos. Por eso, cuando las dos filas existen, gana la que tiene correos
-- y no la que se llama como toca: así ese Guardar no se lleva por delante la
-- lista que ya estaba cargada.
do $migracion$
declare
  v_viejos jsonb;
  v_nuevos jsonb;
  v_cuando timestamptz;
  v_quien text;
begin
  select destinatarios, actualizado_en, actualizado_por
    into v_viejos, v_cuando, v_quien
    from public.lr_suite_notificaciones where id = 'resumen-pendientes';

  if v_viejos is not null then
    select destinatarios into v_nuevos
      from public.lr_suite_notificaciones where id = 'alertas-gasto';

    if v_nuevos is null then
      -- Lo normal: la fila nueva no existe y la vieja pasa a llamarse así.
      update public.lr_suite_notificaciones set id = 'alertas-gasto' where id = 'resumen-pendientes';
    else
      -- Las dos existen. Los correos buenos son los de la fila vieja salvo que
      -- la nueva ya tenga los suyos, que entonces son los últimos que se
      -- guardaron a propósito.
      if jsonb_array_length(v_nuevos) = 0 and jsonb_array_length(v_viejos) > 0 then
        update public.lr_suite_notificaciones
           set destinatarios = v_viejos, actualizado_en = v_cuando, actualizado_por = v_quien
         where id = 'alertas-gasto';
        raise notice 'La fila alertas-gasto estaba vacía: se le pasaron los % correos del resumen de pendientes.',
          jsonb_array_length(v_viejos);
      end if;
      delete from public.lr_suite_notificaciones where id = 'resumen-pendientes';
    end if;
  end if;

  -- La clave no la toca nadie desde el panel: la fila nueva solo existe si este
  -- archivo ya se ejecutó, así que ahí sí manda ella.
  if exists (select 1 from public.lr_suite_notificaciones_claves where id = 'resumen-pendientes') then
    if exists (select 1 from public.lr_suite_notificaciones_claves where id = 'alertas-gasto') then
      delete from public.lr_suite_notificaciones_claves where id = 'resumen-pendientes';
    else
      update public.lr_suite_notificaciones_claves set id = 'alertas-gasto' where id = 'resumen-pendientes';
    end if;
  end if;
end $migracion$;

-- En una instalación nueva, las alertas llegan a las dos cuentas de la Suite.
-- Después la lista se cambia desde el panel; volver a ejecutar esto no la pisa.
insert into public.lr_suite_notificaciones (id, destinatarios, actualizado_por)
values (
  'alertas-gasto',
  '[{"nombre": "Jorge Luis", "email": "jorgeluis@limaretail.com"}, {"nombre": "Diego", "email": "diegomachuca@limaretail.com"}]'::jsonb,
  'instalación'
)
on conflict (id) do nothing;

insert into public.lr_suite_notificaciones_claves (id, clave)
values (
  'alertas-gasto',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

-- ── 4. Permisos ────────────────────────────────────────────────────────────
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

-- ── 5. Las alertas para el workflow ────────────────────────────────────────
-- Devuelve el payload de Alertas de Gasto tal como lo guarda la Suite
-- (lr_suite_private_data, clave 'gasto-alertas': { informes, cuentas }) y la
-- lista de correos. El script rehace con eso los mismos cálculos de la campana.
create or replace function public.lr_suite_alertas_gasto(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clave is null or not exists (
    select 1 from public.lr_suite_notificaciones_claves
    where id = 'alertas-gasto' and clave = p_clave
  ) then
    raise exception 'clave no válida' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'destinatarios', coalesce(
      (select destinatarios from public.lr_suite_notificaciones where id = 'alertas-gasto'),
      '[]'::jsonb
    ),
    'gasto', coalesce(
      (select payload from public.lr_suite_private_data where key = 'gasto-alertas'),
      '{}'::jsonb
    ),
    'sincronizado', (select updated_at from public.lr_suite_private_data where key = 'gasto-alertas')
  );
end;
$$;

revoke all on function public.lr_suite_alertas_gasto(text) from public;
grant execute on function public.lr_suite_alertas_gasto(text) to anon, authenticated;

-- La función del resumen de pendientes ya no se usa: el correo es de gasto.
drop function if exists public.lr_suite_resumen_pendientes(text);

-- ── 6. Avisar a la API ─────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── 7. Comprobación y clave ────────────────────────────────────────────────
-- Lo que debe devolver: politicas = 3, correos = los que ya estaban cargados,
-- informes > 0 y la clave para el secret LR_GASTO_CLAVE de GitHub.
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'lr_suite_notificaciones') as politicas,
  (select jsonb_array_length(destinatarios) from public.lr_suite_notificaciones where id = 'alertas-gasto') as correos,
  (select count(*) from jsonb_object_keys(
     coalesce((select payload -> 'informes' from public.lr_suite_private_data where key = 'gasto-alertas'), '{}'::jsonb)
   )) as informes,
  (select clave from public.lr_suite_notificaciones_claves where id = 'alertas-gasto') as clave_para_github;
