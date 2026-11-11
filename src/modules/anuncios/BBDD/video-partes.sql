-- Read only: checks Suite membership, a published video ID, and the viewer's Drive ACL.
-- Executor token stays server-side. No media is persisted in the database.
begin;
create schema if not exists lr_suite_internal;
revoke all on schema lr_suite_internal from public;
grant usage on schema lr_suite_internal to authenticated;
create or replace function lr_suite_internal.ads_video_chunk(p_id text, p_offset bigint, p_version text)
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
 if p_offset is null or p_offset<0 or p_offset>=268435456 or p_offset%8388608<>0 or (p_offset>0 and coalesce(p_version,'')!~'^[0-9]{1,30}$') then raise exception 'Rango no valido'; end if;
 select payload into cfg from public.lr_suite_private_data where key='ads-config';
 select conf->>'artesFolderId' into folder
 from public.lr_suite_private_data d
 cross join lateral jsonb_array_elements(d.payload->'marcas') b
 cross join lateral jsonb_array_elements(b->'meses') m
 cross join lateral jsonb_array_elements(m->'anuncios') a
 cross join lateral jsonb_array_elements(cfg->'marcas') conf
 where d.key='ads' and conf->>'marca'=b->>'marca'
 and a->'creativo'->>'tipo'='video' and a->'creativo'->>'archivoId'=p_id limit 1;
 if coalesce(folder,'') !~ '^[A-Za-z0-9_-]{20,100}$' then
  raise exception 'Video no publicado' using errcode='42501';
 end if;
 if coalesce(cfg->>'endpoint','') !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then
  raise exception 'Reproductor no disponible';
 end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','50000');
 response:=extensions.http_post(cfg->>'endpoint',jsonb_build_object('accion','leerVideoParte','offset',p_offset,'version',p_version,
  'token',cfg->>'token','folderId',folder,'fileId',p_id,'viewer',viewer)::text,'application/json');
 if response.status in (301,302,303) then
  select h.value into location from unnest(response.headers) h where lower(h.field)='location' limit 1;
  if coalesce(location,'') !~ '^https://script\.googleusercontent\.com/' then raise exception 'Respuesta no valida'; end if;
  response:=extensions.http_get(location);
 end if;
 if response.status<>200 or octet_length(response.content)>12000000 then raise exception 'Video no disponible'; end if;
 answer:=response.content::jsonb;
 if answer->>'ok' is distinct from 'true' then
  return jsonb_build_object('ok',false,'error','No se pudo leer este video con los permisos actuales de tu cuenta.');
 end if;
 if answer->>'id' is distinct from p_id or answer->>'mime' is distinct from 'video/mp4'
 or (answer->>'bytes')::bigint not between 1 and 8388608
 or (answer->>'offset')::bigint is distinct from p_offset
 or coalesce((answer->>'total')::bigint,0) not between 1 and 268435456
 or coalesce(answer->>'version','') !~ '^[0-9]{1,30}$'
 or (p_offset>0 and answer->>'version' is distinct from p_version)
 or (answer->>'bytes')::bigint is distinct from least(8388608,(answer->>'total')::bigint-p_offset)
 or length(answer->>'data') <> 4 * (((answer->>'bytes')::bigint+2)/3) then raise exception 'Respuesta no valida'; end if;
 return answer;
end $$;
revoke all on function lr_suite_internal.ads_video_chunk(text,bigint,text) from public,anon;
grant execute on function lr_suite_internal.ads_video_chunk(text,bigint,text) to authenticated;
create or replace function public.lr_suite_ads_video_chunk(p_id text, p_offset bigint, p_version text)
returns jsonb language sql security invoker set search_path=pg_catalog set statement_timeout='55s'
as $$ select lr_suite_internal.ads_video_chunk(p_id,p_offset,p_version); $$;
revoke all on function public.lr_suite_ads_video_chunk(text,bigint,text) from public,anon;
grant execute on function public.lr_suite_ads_video_chunk(text,bigint,text) to authenticated;
commit;
