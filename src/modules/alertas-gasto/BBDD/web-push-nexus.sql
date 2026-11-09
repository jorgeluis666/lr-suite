-- Read-only, server-to-server. The existing ingestion key stays exclusively in Nexus.
-- Does not change RLS or expose the full private payload or any credentials.
begin;
create or replace function public.lr_suite_push_presupuestos(p_clave text,p_mes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb; v_accounts jsonb; v_result jsonb;
begin
  if p_clave is null or not exists (
    select 1 from public.lr_suite_notificaciones_claves where id='gasto-ingesta' and clave=p_clave
  ) then raise exception 'Acceso denegado' using errcode='42501'; end if;
  if p_mes is null or p_mes !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Mes inválido'; end if;
  select payload into v_payload from public.lr_suite_private_data where key='gasto-alertas';
  v_accounts := coalesce(v_payload->'informes'->p_mes->'cuentas','[]'::jsonb);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c->>'id','plataforma',coalesce(c->>'plataforma','google'),
    'moneda',c->>'moneda','presupuesto',v_payload->'cuentas'->(c->>'id')->'presupuestos'->p_mes
  )),'[]'::jsonb) into v_result from jsonb_array_elements(v_accounts) c;
  return jsonb_build_object('mes',p_mes,'cuentas',v_result);
end $$;
revoke all on function public.lr_suite_push_presupuestos(text,text) from public;
grant execute on function public.lr_suite_push_presupuestos(text,text) to anon, authenticated, service_role;
commit;
