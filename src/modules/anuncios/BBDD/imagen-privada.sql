-- Read only: checks Suite membership, a published imagen ID, and the viewer's Drive ACL.
-- Executor token stays server-side. No media is persisted in the database.
begin;
create schema if not exists lr_suite_internal;
revoke all on schema lr_suite_internal from public;
grant usage on schema lr_suite_internal to authenticated;
create or replace function lr_suite_internal.ads_image(p_id text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions set statement_timeout='55s' as $$
declare cfg jsonb; folder text; viewer text; response extensions.http_response; location text; answer jsonb;
begin
 if auth.uid() is null or not public.is_lr_suite_pending_user() then
  raise exception 'Sin permiso' using errcode='42501';
 end if;
 select lower(email) into viewer from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if viewer is null or coalesce(p_id,'') !~ '^[A-Za-z0-9_-]{20,100}$' then
  raise exception 'Sin permiso' using errcode='42501';
 end if;
 select payload into cfg from public.lr_suite_private_data where key='ads-config';
 select conf->>'artesFolderId' into folder
 from public.lr_suite_private_data d
 cross join lateral jsonb_array_elements(d.payload->'marcas') b
 cross join lateral jsonb_array_elements(b->'meses') m
 cross join lateral jsonb_array_elements(m->'anuncios') a
 cross join lateral jsonb_array_elements(cfg->'marcas') conf
 where d.key='ads' and conf->>'marca'=b->>'marca'
 and a->'creativo'->>'tipo'='carrusel' and (a->'creativo'->'laminas') ? p_id limit 1;
 if coalesce(folder,'') !~ '^[A-Za-z0-9_-]{20,100}$' then
  raise exception 'Imagen no publicado' using errcode='42501';
 end if;
 if coalesce(cfg->>'endpoint','') !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then
  raise exception 'Reproductor no disponible';
 end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','50000');
 response:=extensions.http_post(cfg->>'endpoint',jsonb_build_object('accion','leerImagen',
  'token',cfg->>'token','folderId',folder,'fileId',p_id,'viewer',viewer)::text,'application/json');
 if response.status in (301,302,303) then
  select h.value into location from unnest(response.headers) h where lower(h.field)='location' limit 1;
  if coalesce(location,'') !~ '^https://script\.googleusercontent\.com/' then raise exception 'Respuesta no valida'; end if;
  response:=extensions.http_get(location);
 end if;
 if response.status<>200 or octet_length(response.content)>12000000 then raise exception 'Imagen no disponible'; end if;
 answer:=response.content::jsonb;
 if answer->>'ok' is distinct from 'true' then
  return jsonb_build_object('ok',false,'error','No se pudo leer este imagen con los permisos actuales de tu cuenta.');
 end if;
 if answer->>'id' is distinct from p_id or coalesce(answer->>'mime','') not in ('image/jpeg','image/png','image/webp')
 or coalesce((answer->>'bytes')::bigint,0) not between 1 and 8388608
 or coalesce(length(answer->>'data'),-1) <> 4 * (((answer->>'bytes')::bigint+2)/3) then raise exception 'Respuesta no valida'; end if;
 return answer;
end $$;
revoke all on function lr_suite_internal.ads_image(text) from public,anon;
grant execute on function lr_suite_internal.ads_image(text) to authenticated;
create or replace function public.lr_suite_ads_image(p_id text)
returns jsonb language sql security invoker set search_path=pg_catalog set statement_timeout='55s'
as $$ select lr_suite_internal.ads_image(p_id); $$;
revoke all on function public.lr_suite_ads_image(text) from public,anon;
grant execute on function public.lr_suite_ads_image(text) to authenticated;
commit;
