-- Caché privada de calendarios; no modifica eventos de Google ni restricciones de citas del bot.
create table if not exists public.lr_suite_agenda_google (
  calendario_id text not null,
  evento_id text not null,
  inicio timestamptz not null,
  fin timestamptz not null,
  datos jsonb not null,
  sincronizado_at timestamptz not null default now(),
  primary key (calendario_id, evento_id)
);
create index if not exists lr_agenda_google_inicio on public.lr_suite_agenda_google(inicio);
alter table public.lr_suite_agenda_google enable row level security;
revoke all on public.lr_suite_agenda_google from public, anon, authenticated;
grant select on public.lr_suite_agenda_google to authenticated;
grant all on public.lr_suite_agenda_google to service_role;
drop policy if exists agenda_google_equipo on public.lr_suite_agenda_google;
create policy agenda_google_equipo on public.lr_suite_agenda_google for select to authenticated
using (public.is_lr_suite_pending_user());

create or replace function public.lr_suite_agenda_google_guardar(p_calendario text,p_desde timestamptz,p_hasta timestamptz,p_eventos jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if p_hasta <= p_desde or jsonb_typeof(p_eventos) <> 'array' then raise exception 'rango inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_calendario, 0));
  insert into public.lr_suite_agenda_google(calendario_id,evento_id,inicio,fin,datos)
    select p_calendario,e->>'evento_id',(e->>'inicio')::timestamptz,(e->>'fin')::timestamptz,e
    from jsonb_array_elements(p_eventos) e
  on conflict(calendario_id,evento_id) do update
    set inicio=excluded.inicio,fin=excluded.fin,datos=excluded.datos,sincronizado_at=now();
  -- Solo una lectura completa permite reconciliar cancelaciones. Un error nunca vacía la caché.
  update public.lr_suite_agenda_google g
    set datos=jsonb_set(datos,'{estado}','"cancelada"'),sincronizado_at=now()
    where calendario_id=p_calendario and inicio<p_hasta and fin>p_desde
      and not exists(select 1 from jsonb_array_elements(p_eventos) e where e->>'evento_id'=g.evento_id);
end $$;
revoke all on function public.lr_suite_agenda_google_guardar(text,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.lr_suite_agenda_google_guardar(text,timestamptz,timestamptz,jsonb) to service_role;
