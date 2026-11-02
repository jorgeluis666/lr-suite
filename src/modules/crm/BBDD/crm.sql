-- ============================================================================
-- CRM · Fase 1: un contacto por persona, armado con lo que la Suite ya tiene
-- Proyecto: brfsipssqfsuoplxxcth (plan gratuito)
--
-- El problema: la misma persona puede estar en cinco lugares que no se conocen entre sí.
--   mc_leads                         lead de Ads (webhook de ManyChat)        teléfono, correo
--   lr_suite_prospectos              prospección en LinkedIn                  perfil, correo
--   lr_suite_agenda_conversaciones   chat con el asistente de WhatsApp        wa_id (teléfono)
--   lr_suite_agenda_citas            reunión agendada                         teléfono, correo
--   lr_suite_private_data «quotes»   cotización (un JSON con todas)           teléfono, correo
-- Cada una con su propio identificador y su propia lista de etapas. No hay forma de seguir a
-- alguien desde el anuncio hasta la venta.
--
-- Qué hace esta fase: NO toca esas tablas ni el index.html. Las lee, reconoce a la misma persona
-- por su teléfono, su correo o su perfil de LinkedIn, y deja:
--   lr_suite_crm_contactos     una fila por persona (solo el id: el resto se calcula)
--   lr_suite_crm_identidades   qué teléfono, correo o perfil es de quién
--   lr_suite_crm_vinculos      qué registro de cada fuente es de quién
--   lr_suite_crm_duplicados    dos contactos que parecen la misma persona, para revisarlos
-- y las vistas de lectura: lr_suite_crm_contactos_360 (la ficha), lr_suite_crm_actividades
-- (la historia), lr_suite_crm_embudo, lr_suite_crm_sin_identidad y lr_suite_crm_duplicados_pendientes.
--
-- Fase de validación: sirve para comprobar que los cruces salen bien antes de construir encima
-- (embudo editable, oportunidades, cadencias). Ver src/modules/crm/README.md.
--
-- Nunca fusiona sola a dos personas: si un registro apunta a dos contactos (el teléfono es de uno
-- y el correo de otro), lo anota en lr_suite_crm_duplicados y una persona decide con
-- lr_suite_crm_fusionar() o lr_suite_crm_distintos().
--
-- Ningún dato personal vive en el repositorio, que es público: todo sale de las tablas de Supabase.
--
-- Las fuentes que no estén instaladas en la base se omiten (la sincronización las lista en
-- «sin_instalar»). Al instalar una, se vuelve a ejecutar este archivo y entra.
--
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente: se puede volver a correr.
-- Al final hace la primera sincronización y muestra cuántos contactos salieron.
-- ============================================================================

-- ── 0. Requisitos ──────────────────────────────────────────────────────────
-- Imprescindible: la puerta de la Suite; sin ella las tablas quedarían abiertas.
-- Las fuentes no: el CRM se arma con las que estén instaladas (sección 5) y la sincronización dice
-- cuáles faltan. Al instalar una nueva (por ejemplo la Agenda), basta con volver a ejecutar este
-- archivo.
do $requisitos$
begin
  if to_regprocedure('public.is_lr_suite_pending_user()') is null then
    raise exception
      'Falta public.is_lr_suite_pending_user(). Ejecuta antes src/modules/lista-pendientes/BBDD/security-hardening-2026-09.sql';
  end if;
end $requisitos$;

-- ── 1. Normalizar lo que identifica a una persona ──────────────────────────
-- Teléfono: solo dígitos y con código de país, el mismo formato que el wa_id de WhatsApp
-- (51987654321). Un celular peruano escrito sin código (987 654 321) recibe el 51. Lo que queda
-- con menos de 10 dígitos no se usa: un número incompleto uniría a personas distintas.
create or replace function public.lr_suite_crm_telefono(p_valor text)
returns text
language sql
immutable
as $$
  select case
    when d ~ '^9[0-9]{8}$' then '51' || d
    when length(d) between 10 and 15 then d
  end
  from (select regexp_replace(regexp_replace(coalesce(p_valor, ''), '[^0-9]', '', 'g'), '^00', '') as d) n;
$$;

-- Correo: en minúsculas y sin espacios; lo que no parece un correo no se usa.
create or replace function public.lr_suite_crm_correo(p_valor text)
returns text
language sql
immutable
as $$
  select case when v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then v end
  from (select lower(btrim(coalesce(p_valor, ''))) as v) n;
$$;

-- LinkedIn: solo el tramo del perfil («in/ana-perez»), sin https, www, idioma ni parámetros. Es lo
-- que hace que «https://www.linkedin.com/in/Ana-Perez/?locale=es» y «linkedin.com/in/ana-perez»
-- sean la misma persona.
create or replace function public.lr_suite_crm_linkedin(p_valor text)
returns text
language sql
immutable
as $$
  select 'in/' || lower(m[1])
  from (select regexp_match(coalesce(p_valor, ''), 'linkedin\.com/in/([^/?#[:space:]]+)', 'i') as m) n
  where m is not null;
$$;

-- Texto vacío o el relleno que pone el módulo de Cotizaciones cuenta como «sin dato».
create or replace function public.lr_suite_crm_texto(p_valor text)
returns text
language sql
immutable
as $$
  select nullif(nullif(btrim(coalesce(p_valor, '')), ''), 'Cliente sin nombre');
$$;

-- Fechas guardadas como texto: «AAAA-MM-DD» es medianoche en Lima; una fecha con hora se respeta.
-- Una ilegible no rompe la vista: devuelve null.
create or replace function public.lr_suite_crm_fecha(p_valor text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if coalesce(p_valor, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return p_valor::date::timestamp at time zone 'America/Lima';
  end if;
  if coalesce(p_valor, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]' then
    return p_valor::timestamptz;
  end if;
  return null;
exception
  when others then return null;
end;
$$;

-- Montos guardados en JSON: número o texto numérico; lo demás, null.
create or replace function public.lr_suite_crm_monto(p_valor text)
returns numeric
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_valor, '')) ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
      then btrim(p_valor)::numeric
  end;
$$;

-- ── 2. Un solo embudo ──────────────────────────────────────────────────────
-- Cada fuente tiene sus etapas; el CRM tiene una lista. Esta función es el único lugar donde se
-- traduce: si una equivalencia no convence, se cambia aquí y la siguiente sincronización la usa.
--   lead → contactado → calificado → reunion → propuesta → negociacion → ganado  (perdido aparte)
create or replace function public.lr_suite_crm_etapa(p_fuente text, p_estado text)
returns text
language sql
immutable
as $$
  select case p_fuente
    -- Llegó por un anuncio y todavía nadie habló con él.
    when 'manychat' then 'lead'
    when 'linkedin' then case e
      when 'por_contactar' then 'lead'
      when 'invitacion_enviada' then 'contactado'
      when 'conectado' then 'contactado'
      when 'info_enviada' then 'contactado'
      -- Respondió: hay conversación y ya se sabe si le interesa.
      when 'respondio' then 'calificado'
      when 'reunion' then 'reunion'
      when 'cliente' then 'ganado'
      when 'descartado' then 'perdido'
      else 'lead'
    end
    when 'whatsapp' then case e
      -- Escribió y el asistente lo atiende.
      when 'nuevo' then 'contactado'
      when 'diagnostico' then 'calificado'
      when 'asesoria' then 'calificado'
      -- «propuesta» y «datos» del asistente son ofrecer la reunión y pedir los datos para
      -- reservarla, no una cotización: siguen siendo calificado.
      when 'propuesta' then 'calificado'
      when 'datos' then 'calificado'
      when 'agendado' then 'reunion'
      -- Cerrado no dice si terminó bien o mal; si hubo reunión, la cita ya lo lleva a reunion.
      else 'contactado'
    end
    when 'cita' then case e
      when 'cancelada' then 'calificado'
      else 'reunion'
    end
    -- Las mismas reglas que quoteEstado() del index.html, para que el CRM y el módulo de
    -- Cotizaciones digan lo mismo de cada cotización.
    when 'cotizacion' then case
      when e ~ '(aprob|ganad|cerrad|acept)' then 'ganado'
      when e ~ '(revision|negocia|evalua)' then 'negociacion'
      else 'propuesta'
    end
  end
  from (select lower(translate(coalesce(p_estado, ''), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')) as e) n;
$$;

create or replace function public.lr_suite_crm_etapa_orden(p_etapa text)
returns integer
language sql
immutable
as $$
  select case p_etapa
    when 'perdido' then 0
    when 'lead' then 1
    when 'contactado' then 2
    when 'calificado' then 3
    when 'reunion' then 4
    when 'propuesta' then 5
    when 'negociacion' then 6
    when 'ganado' then 7
  end;
$$;

-- ── 3. Ids estables de las fuentes que no los garantizan ───────────────────
-- mc_leads no está versionada en el repositorio: se lee como JSON para no depender de sus columnas.
create or replace function public.lr_suite_crm_lead_id(p_lead jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(p_lead->>'id', ''),
    nullif(p_lead->>'subscriber_id', ''),
    'h-' || md5(coalesce(p_lead->>'created_at', '') || '|' || coalesce(p_lead->>'phone', '') || '|' || coalesce(p_lead->>'email', ''))
  );
$$;

-- Las cotizaciones llevan id; si una vieja no lo tiene, se usa lo que no cambia de ella.
create or replace function public.lr_suite_crm_cotizacion_id(p_cotizacion jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(p_cotizacion->>'id', ''),
    'h-' || md5(coalesce(p_cotizacion->>'cliente', '') || '|' || coalesce(p_cotizacion->>'servicio', '') || '|' || coalesce(p_cotizacion->>'fechaEnvio', ''))
  );
$$;

-- Qué fuentes existen en esta base. Se compara con lr_suite_crm_fuentes_incluidas() (la escribe la
-- sección 5) para avisar cuando una se instaló después y falta volver a ejecutar este archivo.
create or replace function public.lr_suite_crm_fuentes_instaladas()
returns text[]
language sql
stable
as $$
  select array_remove(array[
    case when to_regclass('public.mc_leads') is not null then 'manychat' end,
    case when to_regclass('public.lr_suite_prospectos') is not null then 'linkedin' end,
    case when to_regclass('public.lr_suite_agenda_conversaciones') is not null then 'whatsapp' end,
    case when to_regclass('public.lr_suite_agenda_citas') is not null then 'cita' end,
    case when to_regclass('public.lr_suite_private_data') is not null then 'cotizacion' end
  ], null);
$$;

-- ── 4. Tablas ──────────────────────────────────────────────────────────────
-- El contacto es solo un id: nombre, empresa, etapa y origen se calculan de sus registros en
-- lr_suite_crm_contactos_360. Así no hay dos versiones del mismo dato que puedan contradecirse.
-- clock_timestamp() y no now(): los creados en la misma sincronización quedan en orden, y el más
-- antiguo es el que se queda cuando hay que elegir.
create table if not exists public.lr_suite_crm_contactos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp()
);

-- Un teléfono, un correo o un perfil es de una sola persona: la clave primaria lo garantiza.
create table if not exists public.lr_suite_crm_identidades (
  tipo text not null check (tipo in ('telefono', 'correo', 'linkedin')),
  valor text not null,
  contacto_id uuid not null references public.lr_suite_crm_contactos(id) on delete cascade,
  -- Dónde apareció primero, para saber de dónde salió un dato raro.
  fuente text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tipo, valor)
);

create index if not exists lr_suite_crm_identidades_contacto_idx
  on public.lr_suite_crm_identidades(contacto_id);

create table if not exists public.lr_suite_crm_vinculos (
  fuente text not null check (fuente in ('manychat', 'linkedin', 'whatsapp', 'cita', 'cotizacion')),
  fuente_id text not null,
  contacto_id uuid not null references public.lr_suite_crm_contactos(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (fuente, fuente_id)
);

create index if not exists lr_suite_crm_vinculos_contacto_idx
  on public.lr_suite_crm_vinculos(contacto_id);

-- Par ordenado (a < b) para que «A con B» y «B con A» sean la misma fila.
-- estado 'distintos': alguien revisó y no son la misma persona; no se vuelve a preguntar.
create table if not exists public.lr_suite_crm_duplicados (
  contacto_a uuid not null references public.lr_suite_crm_contactos(id) on delete cascade,
  contacto_b uuid not null references public.lr_suite_crm_contactos(id) on delete cascade,
  motivo text not null default '',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'distintos')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (contacto_a, contacto_b),
  constraint lr_suite_crm_duplicados_orden check (contacto_a < contacto_b)
);

-- ── 5. Vista de registros: las fuentes instaladas con las mismas columnas ──
-- Se arma con las fuentes que existen: una vista no puede nombrar una tabla que no está. La
-- primera parte es el molde (cero filas) que fija nombres y tipos de las columnas; las demás se
-- suman con union all solo si su tabla existe.
-- security_invoker: quien la abre pasa por el RLS de cada fuente, como si las leyera una a una.
-- Sin esto la vista correría con los permisos de su dueño y saltaría el RLS.
do $toques$
declare
  v_instaladas text[] := public.lr_suite_crm_fuentes_instaladas();
  v_partes text[] := array[$q$
  select
    null::text as fuente,
    null::text as fuente_id,
    null::timestamptz as ocurrido_at,
    null::timestamptz as actualizado_at,
    null::text as nombre,
    null::text as empresa,
    null::text as cargo,
    null::text as telefono,
    null::text as correo,
    null::text as linkedin,
    null::text as origen,
    null::text as estado_fuente,
    null::text as etapa,
    null::numeric as monto,
    null::text as detalle
  where false
  $q$];
begin
  if cardinality(v_instaladas) = 0 then
    raise exception 'No hay ninguna fuente instalada: ni mc_leads, ni lr_suite_prospectos, ni la Agenda, ni lr_suite_private_data';
  end if;

  if 'manychat' = any(v_instaladas) then
    v_partes := array_append(v_partes, $q$
  select
    'manychat'::text as fuente,
    public.lr_suite_crm_lead_id(j) as fuente_id,
    public.lr_suite_crm_fecha(j->>'created_at') as ocurrido_at,
    public.lr_suite_crm_fecha(j->>'updated_at') as actualizado_at,
    public.lr_suite_crm_texto(concat_ws(' ', j->>'first_name', j->>'last_name')) as nombre,
    null::text as empresa,
    null::text as cargo,
    public.lr_suite_crm_telefono(j->>'phone') as telefono,
    public.lr_suite_crm_correo(j->>'email') as correo,
    null::text as linkedin,
    'ads'::text as origen,
    coalesce(j->>'estado', j->>'status') as estado_fuente,
    public.lr_suite_crm_etapa('manychat', null) as etapa,
    null::numeric as monto,
    concat_ws(' · ', 'Lead de Ads', public.lr_suite_crm_texto(j->>'tag_ads')) as detalle
  from public.mc_leads l
  cross join lateral (select to_jsonb(l) as j) x
    $q$);
  end if;

  if 'linkedin' = any(v_instaladas) then
    v_partes := array_append(v_partes, $q$
  select
    'linkedin',
    p.id::text,
    p.created_at,
    p.updated_at,
    public.lr_suite_crm_texto(concat_ws(' ', p.nombre, p.apellido)),
    public.lr_suite_crm_texto(p.empresa),
    public.lr_suite_crm_texto(p.cargo),
    null,
    public.lr_suite_crm_correo(p.correo),
    public.lr_suite_crm_linkedin(p.linkedin_url),
    'linkedin',
    p.estado,
    public.lr_suite_crm_etapa('linkedin', p.estado),
    null,
    'Prospecto en LinkedIn · ' || replace(p.estado, '_', ' ')
  from public.lr_suite_prospectos p
    $q$);
  end if;

  if 'whatsapp' = any(v_instaladas) then
    v_partes := array_append(v_partes, $q$
  select
    'whatsapp',
    c.wa_id,
    c.created_at,
    c.ultimo_mensaje_at,
    public.lr_suite_crm_texto(c.nombre),
    null,
    null,
    public.lr_suite_crm_telefono(c.wa_id),
    null,
    null,
    'whatsapp',
    c.etapa,
    public.lr_suite_crm_etapa('whatsapp', c.etapa),
    null,
    concat_ws(' · ', 'Conversación de WhatsApp', c.etapa, public.lr_suite_crm_texto(c.resumen))
  from public.lr_suite_agenda_conversaciones c
    $q$);
  end if;

  if 'cita' = any(v_instaladas) then
    v_partes := array_append(v_partes, $q$
  select
    'cita',
    a.id::text,
    a.inicio,
    a.updated_at,
    public.lr_suite_crm_texto(a.nombre),
    public.lr_suite_crm_texto(a.marca),
    null,
    coalesce(public.lr_suite_crm_telefono(a.wa_id), public.lr_suite_crm_telefono(a.telefono)),
    public.lr_suite_crm_correo(a.correo),
    null,
    -- La agendó el asistente: llegó por WhatsApp. La agendó el equipo: no se sabe por dónde.
    case when a.origen = 'asistente' then 'whatsapp' end,
    a.estado,
    public.lr_suite_crm_etapa('cita', a.estado),
    null,
    concat_ws(' · ', 'Reunión ' || replace(a.estado, '_', ' '), public.lr_suite_crm_texto(a.motivo))
  from public.lr_suite_agenda_citas a
    $q$);
  end if;

  if 'cotizacion' = any(v_instaladas) then
    v_partes := array_append(v_partes, $q$
  select
    'cotizacion',
    public.lr_suite_crm_cotizacion_id(q),
    public.lr_suite_crm_fecha(q->>'fechaEnvio'),
    null,
    public.lr_suite_crm_texto(q->>'contacto'),
    public.lr_suite_crm_texto(q->>'cliente'),
    null,
    public.lr_suite_crm_telefono(q->>'telefono'),
    public.lr_suite_crm_correo(q->>'emailContacto'),
    null,
    case q->>'origen' when 'Ads' then 'ads' when 'Referido' then 'referido' end,
    q->>'estado',
    public.lr_suite_crm_etapa('cotizacion', q->>'estado'),
    public.lr_suite_crm_monto(q->>'montoCotizado'),
    concat_ws(' · ', 'Cotización', public.lr_suite_crm_texto(q->>'servicio'), q->>'estado')
  from public.lr_suite_private_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.payload) = 'array' then d.payload else '[]'::jsonb end
  ) q
  where d.key = 'quotes'
    and jsonb_typeof(q) = 'object'
    $q$);
  end if;

  execute 'create or replace view public.lr_suite_crm_toques with (security_invoker = true) as '
    || array_to_string(v_partes, ' union all ');

  -- La lista de lo que quedó dentro, para que la sincronización avise si falta volver a ejecutar.
  execute format(
    'create or replace function public.lr_suite_crm_fuentes_incluidas() returns text[] language sql immutable as %L',
    format('select %L::text[]', v_instaladas)
  );
end $toques$;

-- ── 6. Quién puede sincronizar y decidir duplicados ────────────────────────
-- SQL Editor y service_role (pg_cron, Edge Functions): sí. Desde el panel: solo las cuentas de la
-- Suite. Es la misma regla que usa security-hardening-2026-09.sql.
create or replace function public.lr_suite_crm_puede()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select session_user <> 'authenticator'
    or coalesce(auth.role(), '') = 'service_role'
    or public.is_lr_suite_pending_user();
$$;

-- ── 7. Sincronizar ─────────────────────────────────────────────────────────
-- Recorre los registros del más antiguo al más nuevo:
--   - sin teléfono, correo ni perfil: no se puede saber de quién es (lr_suite_crm_sin_identidad).
--   - ya vinculado: se queda con su contacto; solo se le suman los datos nuevos.
--   - alguno de sus datos ya es de un contacto: se le vincula al más antiguo.
--   - ninguno: contacto nuevo.
-- Si sus datos son de dos contactos distintos, se vincula al más antiguo y el par queda en
-- lr_suite_crm_duplicados. Nunca fusiona solo.
-- Antes de eso suelta los vínculos de registros que ya no existen y borra los contactos que se
-- quedan sin ninguno.
create or replace function public.lr_suite_crm_sincronizar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_contactos uuid[];
  v_destino uuid;
  v_otro uuid;
  v_filas integer;
  v_total integer := 0;
  v_sin_identidad integer := 0;
  v_nuevos integer := 0;
  v_vinculos integer := 0;
  v_duplicados integer := 0;
  v_vinculos_sueltos integer := 0;
  v_contactos_borrados integer := 0;
begin
  if not public.lr_suite_crm_puede() then
    raise exception 'Sin permiso para sincronizar el CRM' using errcode = '42501';
  end if;

  -- Dos sincronizaciones a la vez crearían el mismo contacto dos veces: la segunda espera.
  perform pg_advisory_xact_lock(hashtext('lr_suite_crm_sincronizar'));

  delete from public.lr_suite_crm_vinculos v
  where not exists (
    select 1 from public.lr_suite_crm_toques x
    where x.fuente = v.fuente and x.fuente_id = v.fuente_id
  );
  get diagnostics v_vinculos_sueltos = row_count;

  delete from public.lr_suite_crm_contactos c
  where not exists (select 1 from public.lr_suite_crm_vinculos v where v.contacto_id = c.id);
  get diagnostics v_contactos_borrados = row_count;

  for t in
    select * from public.lr_suite_crm_toques
    order by ocurrido_at nulls last, fuente, fuente_id
  loop
    v_total := v_total + 1;

    select v.contacto_id into v_destino
    from public.lr_suite_crm_vinculos v
    where v.fuente = t.fuente and v.fuente_id = t.fuente_id;

    if t.telefono is null and t.correo is null and t.linkedin is null then
      if v_destino is null then
        v_sin_identidad := v_sin_identidad + 1;
      end if;
      continue;
    end if;

    select coalesce(array_agg(distinct i.contacto_id), '{}') into v_contactos
    from public.lr_suite_crm_identidades i
    where (i.tipo = 'telefono' and i.valor = t.telefono)
       or (i.tipo = 'correo' and i.valor = t.correo)
       or (i.tipo = 'linkedin' and i.valor = t.linkedin);

    if v_destino is null then
      select c.id into v_destino
      from public.lr_suite_crm_contactos c
      where c.id = any(v_contactos)
      order by c.created_at, c.id
      limit 1;
    end if;

    if v_destino is null then
      insert into public.lr_suite_crm_contactos default values returning id into v_destino;
      v_nuevos := v_nuevos + 1;
    end if;

    insert into public.lr_suite_crm_vinculos (fuente, fuente_id, contacto_id)
    values (t.fuente, t.fuente_id, v_destino)
    on conflict (fuente, fuente_id) do nothing;
    get diagnostics v_filas = row_count;
    v_vinculos := v_vinculos + v_filas;

    insert into public.lr_suite_crm_identidades (tipo, valor, contacto_id, fuente)
    select k.tipo, k.valor, v_destino, t.fuente
    from (values ('telefono', t.telefono), ('correo', t.correo), ('linkedin', t.linkedin)) k(tipo, valor)
    where k.valor is not null
    on conflict (tipo, valor) do nothing;

    foreach v_otro in array v_contactos loop
      continue when v_otro = v_destino;
      insert into public.lr_suite_crm_duplicados (contacto_a, contacto_b, motivo)
      values (
        least(v_destino, v_otro),
        greatest(v_destino, v_otro),
        'Comparten datos en ' || t.fuente || ' ' || t.fuente_id
      )
      on conflict (contacto_a, contacto_b) do nothing;
      get diagnostics v_filas = row_count;
      v_duplicados := v_duplicados + v_filas;
    end loop;
  end loop;

  return jsonb_build_object(
    -- fuentes: las que lee el CRM. sin_instalar: las que no existen en esta base.
    -- reejecutar_crm_sql: las que se instalaron después; hay que volver a ejecutar este archivo.
    'fuentes', public.lr_suite_crm_fuentes_incluidas(),
    'sin_instalar', array(
      select unnest(array['manychat', 'linkedin', 'whatsapp', 'cita', 'cotizacion'])
      except select unnest(public.lr_suite_crm_fuentes_instaladas())
    ),
    'reejecutar_crm_sql', array(
      select unnest(public.lr_suite_crm_fuentes_instaladas())
      except select unnest(public.lr_suite_crm_fuentes_incluidas())
    ),
    'registros', v_total,
    'contactos', (select count(*) from public.lr_suite_crm_contactos),
    'contactos_nuevos', v_nuevos,
    'vinculos_nuevos', v_vinculos,
    'sin_identidad', v_sin_identidad,
    'duplicados_nuevos', v_duplicados,
    'vinculos_sueltos', v_vinculos_sueltos,
    'contactos_borrados', v_contactos_borrados
  );
end;
$$;

-- ── 8. Decidir un duplicado ────────────────────────────────────────────────
-- Fusionar: todo lo de p_sale pasa a p_queda y p_sale desaparece. Las sospechas que p_sale tenía
-- con un tercero pasan a p_queda.
create or replace function public.lr_suite_crm_fusionar(p_queda uuid, p_sale uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vinculos integer;
begin
  if not public.lr_suite_crm_puede() then
    raise exception 'Sin permiso para fusionar contactos del CRM' using errcode = '42501';
  end if;
  if p_queda is null or p_sale is null or p_queda = p_sale then
    raise exception 'Hacen falta dos contactos distintos';
  end if;
  if (select count(*) from public.lr_suite_crm_contactos where id in (p_queda, p_sale)) <> 2 then
    raise exception 'Alguno de los dos contactos no existe';
  end if;

  perform pg_advisory_xact_lock(hashtext('lr_suite_crm_sincronizar'));

  update public.lr_suite_crm_vinculos set contacto_id = p_queda where contacto_id = p_sale;
  get diagnostics v_vinculos = row_count;
  update public.lr_suite_crm_identidades set contacto_id = p_queda where contacto_id = p_sale;

  insert into public.lr_suite_crm_duplicados (contacto_a, contacto_b, motivo, estado)
  select least(p_queda, o.otro), greatest(p_queda, o.otro), d.motivo, d.estado
  from public.lr_suite_crm_duplicados d
  cross join lateral (
    select case when d.contacto_a = p_sale then d.contacto_b else d.contacto_a end as otro
  ) o
  where p_sale in (d.contacto_a, d.contacto_b)
    and o.otro <> p_queda
  on conflict (contacto_a, contacto_b) do nothing;

  -- El cascade se lleva las sospechas de p_sale.
  delete from public.lr_suite_crm_contactos where id = p_sale;

  return jsonb_build_object('contacto', p_queda, 'vinculos_movidos', v_vinculos);
end;
$$;

-- No son la misma persona: la sospecha queda cerrada y la sincronización no vuelve a abrirla.
create or replace function public.lr_suite_crm_distintos(p_a uuid, p_b uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.lr_suite_crm_puede() then
    raise exception 'Sin permiso para revisar duplicados del CRM' using errcode = '42501';
  end if;
  update public.lr_suite_crm_duplicados
  set estado = 'distintos'
  where contacto_a = least(p_a, p_b) and contacto_b = greatest(p_a, p_b);
  return found;
end;
$$;

-- ── 9. Vistas de lectura ───────────────────────────────────────────────────
-- La ficha: un contacto con lo mejor que se sabe de él.
--   nombre, empresa, cargo: el del registro que se movió más recientemente.
--   origen: el del primer registro que lo dice (si primero fue un lead de Ads, es «ads»).
--   etapa: ganado si algo se ganó; perdido si lo último que pasó fue perderlo; si no, la más
--          avanzada a la que llegó.
create or replace view public.lr_suite_crm_contactos_360
with (security_invoker = true) as
with registros as (
  select v.contacto_id, t.*, coalesce(t.actualizado_at, t.ocurrido_at) as movido_at
  from public.lr_suite_crm_vinculos v
  join public.lr_suite_crm_toques t on t.fuente = v.fuente and t.fuente_id = v.fuente_id
),
datos as (
  select
    contacto_id,
    (array_agg(valor order by created_at) filter (where tipo = 'telefono'))[1] as telefono,
    (array_agg(valor order by created_at) filter (where tipo = 'correo'))[1] as correo,
    (array_agg(valor order by created_at) filter (where tipo = 'linkedin'))[1] as linkedin
  from public.lr_suite_crm_identidades
  group by contacto_id
),
resumen as (
  select
    r.contacto_id,
    (array_agg(r.nombre order by r.movido_at desc nulls last) filter (where r.nombre is not null))[1] as nombre,
    (array_agg(r.empresa order by r.movido_at desc nulls last) filter (where r.empresa is not null))[1] as empresa,
    (array_agg(r.cargo order by r.movido_at desc nulls last) filter (where r.cargo is not null))[1] as cargo,
    (array_agg(r.origen order by r.ocurrido_at nulls last) filter (where r.origen is not null))[1] as origen,
    case
      when bool_or(r.etapa = 'ganado') then 'ganado'
      when (array_agg(r.etapa order by r.movido_at desc nulls last))[1] = 'perdido' then 'perdido'
      else (array_agg(r.etapa order by public.lr_suite_crm_etapa_orden(r.etapa) desc))[1]
    end as etapa,
    min(r.ocurrido_at) as primer_registro_at,
    max(r.movido_at) as ultimo_movimiento_at,
    array_agg(distinct r.fuente) as fuentes,
    count(*) as registros,
    count(*) filter (where r.fuente = 'cotizacion') as cotizaciones,
    coalesce(sum(r.monto) filter (where r.fuente = 'cotizacion'), 0) as monto_cotizado,
    coalesce(sum(r.monto) filter (where r.fuente = 'cotizacion' and r.etapa = 'ganado'), 0) as monto_ganado
  from registros r
  group by r.contacto_id
)
select
  c.id,
  s.nombre,
  s.empresa,
  s.cargo,
  d.telefono,
  d.correo,
  d.linkedin,
  s.origen,
  s.etapa,
  public.lr_suite_crm_etapa_orden(s.etapa) as etapa_orden,
  s.primer_registro_at,
  s.ultimo_movimiento_at,
  s.fuentes,
  s.registros,
  s.cotizaciones,
  s.monto_cotizado,
  s.monto_ganado,
  exists (
    select 1 from public.lr_suite_crm_duplicados x
    where x.estado = 'pendiente' and c.id in (x.contacto_a, x.contacto_b)
  ) as duplicado_pendiente,
  c.created_at
from public.lr_suite_crm_contactos c
join resumen s on s.contacto_id = c.id
left join datos d on d.contacto_id = c.id;

-- La historia de cada contacto: sus registros, los hitos de prospección y los contactos anotados
-- en Prospección y en Cotizaciones.
-- Como lr_suite_crm_toques, solo nombra las tablas que existen.
do $actividades$
declare
  v_instaladas text[] := public.lr_suite_crm_fuentes_instaladas();
  v_partes text[] := array[$q$
  select v.contacto_id, t.ocurrido_at as fecha, t.fuente, 'registro'::text as tipo, t.detalle
  from public.lr_suite_crm_vinculos v
  join public.lr_suite_crm_toques t on t.fuente = v.fuente and t.fuente_id = v.fuente_id
  $q$];
begin
  if 'linkedin' = any(v_instaladas) then
    v_partes := array_append(v_partes, $q$
  select v.contacto_id, h.fecha, 'linkedin', 'hito', h.texto
  from public.lr_suite_prospectos p
  join public.lr_suite_crm_vinculos v on v.fuente = 'linkedin' and v.fuente_id = p.id::text
  cross join lateral (values
    (p.invitacion_enviada_en, 'Invitación enviada'),
    (p.info_enviada_en, 'Información enviada'),
    (p.respondio_en, 'Respondió')
  ) h(fecha, texto)
  where h.fecha is not null
    $q$);
    -- Prospección guarda [{ "fecha": "AAAA-MM-DD", "tema": "..." }].
    v_partes := array_append(v_partes, $q$
  select v.contacto_id, public.lr_suite_crm_fecha(k->>'fecha'), 'linkedin', 'contacto',
    concat_ws(' · ', 'Contacto', public.lr_suite_crm_texto(k->>'tema'))
  from public.lr_suite_prospectos p
  join public.lr_suite_crm_vinculos v on v.fuente = 'linkedin' and v.fuente_id = p.id::text
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.contactos) = 'array' then p.contactos else '[]'::jsonb end
  ) k
    $q$);
  end if;

  -- Cotizaciones guarda cada contacto como [tipo, fecha, orden, nota]; el archivo importado, como
  -- objeto. Se leen los dos.
  if 'cotizacion' = any(v_instaladas) then
    v_partes := array_append(v_partes, $q$
  select v.contacto_id,
    public.lr_suite_crm_fecha(case jsonb_typeof(k) when 'array' then k->>1 else k->>'fecha' end),
    'cotizacion', 'contacto',
    concat_ws(' · ', 'Seguimiento',
      public.lr_suite_crm_texto(case jsonb_typeof(k) when 'array' then k->>0 else k->>'tipo' end),
      public.lr_suite_crm_texto(case jsonb_typeof(k) when 'array' then k->>3 else k->>'nota' end))
  from public.lr_suite_private_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.payload) = 'array' then d.payload else '[]'::jsonb end
  ) q
  join public.lr_suite_crm_vinculos v
    on v.fuente = 'cotizacion' and v.fuente_id = public.lr_suite_crm_cotizacion_id(q)
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(q->'contactos') = 'array' then q->'contactos' else '[]'::jsonb end
  ) k
  where d.key = 'quotes'
    and jsonb_typeof(q) = 'object'
    $q$);
  end if;

  execute 'create or replace view public.lr_suite_crm_actividades with (security_invoker = true) as '
    || array_to_string(v_partes, ' union all ');
end $actividades$;

-- El embudo: cuántas personas hay en cada etapa, por origen.
create or replace view public.lr_suite_crm_embudo
with (security_invoker = true) as
  select
    etapa,
    etapa_orden,
    coalesce(origen, 'sin_origen') as origen,
    count(*) as contactos,
    sum(monto_cotizado) as monto_cotizado,
    sum(monto_ganado) as monto_ganado
  from public.lr_suite_crm_contactos_360
  group by etapa, etapa_orden, coalesce(origen, 'sin_origen');

-- Lo que no se pudo cruzar: registros sin teléfono, correo ni perfil. Se arreglan en su módulo.
create or replace view public.lr_suite_crm_sin_identidad
with (security_invoker = true) as
  select fuente, fuente_id, ocurrido_at, nombre, empresa, detalle
  from public.lr_suite_crm_toques
  where telefono is null and correo is null and linkedin is null;

-- Las sospechas por revisar, con lo necesario para decidir sin abrir cada ficha.
create or replace view public.lr_suite_crm_duplicados_pendientes
with (security_invoker = true) as
  select
    d.contacto_a, a.nombre as nombre_a, a.empresa as empresa_a, a.fuentes as fuentes_a,
    d.contacto_b, b.nombre as nombre_b, b.empresa as empresa_b, b.fuentes as fuentes_b,
    d.motivo, d.created_at
  from public.lr_suite_crm_duplicados d
  left join public.lr_suite_crm_contactos_360 a on a.id = d.contacto_a
  left join public.lr_suite_crm_contactos_360 b on b.id = d.contacto_b
  where d.estado = 'pendiente';

-- ── 10. Permisos ───────────────────────────────────────────────────────────
-- Las tablas solo se leen desde el panel; se escriben con las funciones de arriba.
do $politicas$
declare
  v_nombre text;
begin
  foreach v_nombre in array array[
    'lr_suite_crm_contactos',
    'lr_suite_crm_identidades',
    'lr_suite_crm_vinculos',
    'lr_suite_crm_duplicados'
  ] loop
    execute format('alter table public.%I enable row level security', v_nombre);
    execute format('revoke all on public.%I from anon, authenticated', v_nombre);
    execute format('grant select on public.%I to authenticated', v_nombre);
    execute format('drop policy if exists "crm lee" on public.%I', v_nombre);
    execute format(
      'create policy "crm lee" on public.%I for select to authenticated
         using (public.is_lr_suite_pending_user())', v_nombre);
  end loop;

  foreach v_nombre in array array[
    'lr_suite_crm_toques',
    'lr_suite_crm_contactos_360',
    'lr_suite_crm_actividades',
    'lr_suite_crm_embudo',
    'lr_suite_crm_sin_identidad',
    'lr_suite_crm_duplicados_pendientes'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v_nombre);
    execute format('grant select on public.%I to authenticated', v_nombre);
  end loop;
end $politicas$;

revoke all on function public.lr_suite_crm_puede() from public, anon;
revoke all on function public.lr_suite_crm_sincronizar() from public, anon;
revoke all on function public.lr_suite_crm_fusionar(uuid, uuid) from public, anon;
revoke all on function public.lr_suite_crm_distintos(uuid, uuid) from public, anon;
grant execute on function public.lr_suite_crm_puede() to authenticated, service_role;
grant execute on function public.lr_suite_crm_sincronizar() to authenticated, service_role;
grant execute on function public.lr_suite_crm_fusionar(uuid, uuid) to authenticated, service_role;
grant execute on function public.lr_suite_crm_distintos(uuid, uuid) to authenticated, service_role;

-- ── 11. Avisar a la API ────────────────────────────────────────────────────
-- Sin este aviso PostgREST puede responder PGRST205 con las tablas recién creadas.
notify pgrst, 'reload schema';

-- ── 12. Primera sincronización y comprobación ──────────────────────────────
-- Lo que debe devolver: un JSON con registros, contactos y cuántos quedaron sin identidad o como
-- posibles duplicados. Si «contactos» es mucho menor que «registros», los cruces funcionan.
select public.lr_suite_crm_sincronizar() as primera_sincronizacion;
