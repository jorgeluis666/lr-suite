begin;
create temporary sequence retry_calls;
create function pg_temp.test_call(a text, id text, ms integer) returns jsonb language plpgsql as $$
declare n integer := nextval('pg_temp.retry_calls');
begin
 if id='denied' then raise exception 'permission denied'; end if;
 if id='always' or (id='timeout' and n=1) then raise exception 'Operation timed out'; end if;
 if id='unavailable' and n=1 then raise exception 'El Web App de Drive respondio 503'; end if;
 if id='invalid' then return '{"anuncios":{}}'::jsonb; end if;
 if n=2 and ms<>50000 then raise exception 'wrong retry timeout'; end if;
 return '{"anuncios":[{"nombre":"Anuncio","gasto":12.5},{"nombre":" "}]}'::jsonb;
end $$;
create or replace function pg_temp.test_rows(p_sheet text, p_timeout_ms integer default 25000)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_rows jsonb;
begin
  begin
    v_rows := coalesce(pg_temp.test_call('hoja', p_sheet, p_timeout_ms) -> 'anuncios', '[]'::jsonb);
  exception when others then
    -- Una lectura lenta no debe retirar el mes en el primer fallo transitorio.
    -- Solo GET y una sola repeticion; errores de permisos/formato se propagan.
    if sqlerrm !~* '(timed out|timeout|connection reset|(HTTP |respondio )50[234])' then
      raise;
    end if;
    v_rows := coalesce(pg_temp.test_call('hoja', p_sheet,
      greatest(p_timeout_ms, 50000)) -> 'anuncios', '[]'::jsonb);
  end;
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'El Web App de Drive devolvio los anuncios en un formato inesperado';
  end if;

  -- Se descartan las filas sin nombre: el modulo empareja la pieza por ese nombre.
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(v_rows)
  where btrim(coalesce(value ->> 'nombre', '')) <> '';

  return v_rows;
end;
$$;


do $$
declare r jsonb; k text; caught boolean;
begin
 foreach k in array array['timeout','unavailable'] loop
  perform setval('pg_temp.retry_calls',1,false);
  r:=pg_temp.test_rows(k);
  assert jsonb_array_length(r)=1 and r->0->>'gasto'='12.5';
  assert currval('pg_temp.retry_calls')=2;
 end loop;
 foreach k in array array['denied','always','invalid'] loop
  perform setval('pg_temp.retry_calls',1,false); caught:=false;
  begin perform pg_temp.test_rows(k); exception when others then caught:=true; end;
  assert caught;
  assert currval('pg_temp.retry_calls')=case when k='always' then 2 else 1 end;
 end loop;
end $$;
select 'PASS: timeout, HTTP 503, denied, repeated timeout, invalid JSON shape' as tests;
rollback;
