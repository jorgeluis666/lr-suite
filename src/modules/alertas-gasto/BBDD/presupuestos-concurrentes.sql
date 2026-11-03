-- Alertas de Gasto · presupuestos a cuatro manos
--
-- Hasta el 3 de noviembre de 2026 cada presupuesto o marca que se escribia en el modulo subia el
-- payload ENTERO (`informes` + `cuentas`) desde la copia que el navegador habia leido al abrir la
-- vista. Con dos personas presupuestando el mismo mes eso es un borrado silencioso: quien guardaba
-- segundo reescribia `cuentas` con su copia vieja y los presupuestos del otro desaparecian sin que
-- nadie se enterara. Paso el 3 de noviembre de 2026: Diego cargo los presupuestos de noviembre a
-- las 10:13 y cualquier cambio desde una pestana abierta desde antes los habria borrado.
--
-- Estas dos funciones parchean dentro de la base SOLO la ruta que cambio
-- (`cuentas.<id>.presupuestos.<mes>` o `cuentas.<id>.marca`) y devuelven el payload ya guardado,
-- para que el navegador adopte de paso lo que haya escrito el otro mientras tanto. La fila se
-- bloquea con `for update` mientras se parchea, asi que dos guardados a la vez se ordenan en vez
-- de pisarse.
--
-- `informes` no se toca nunca: eso lo escribe la carga diaria (sincronizacion-gasto.sql).
--
-- Se ejecuta entero en el SQL Editor de Supabase. Es idempotente.

-- ── El presupuesto de una cuenta en un mes ──────────────────────────────────
-- Monto 0 (o nulo) borra la clave del mes, que es como el modulo quita un presupuesto.
create or replace function public.lr_suite_gasto_set_presupuesto(
  p_cuenta text,
  p_mes text,
  p_monto numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_cuentas jsonb;
  v_cuenta jsonb;
  v_presupuestos jsonb;
  v_monto numeric;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'Sin permiso para guardar presupuestos' using errcode = '42501';
  end if;
  if coalesce(p_cuenta, '') !~ '^[0-9A-Za-z._-]{1,64}$' then
    raise exception 'Id de cuenta no valido';
  end if;
  if coalesce(p_mes, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'El mes tiene que ser AAAA-MM';
  end if;

  v_monto := round(coalesce(p_monto, 0), 2);
  if v_monto < 0 then
    raise exception 'El presupuesto no puede ser negativo';
  end if;

  -- La fila queda bloqueada hasta el final de la transaccion: si los dos usuarios guardan a la vez,
  -- el segundo lee el payload con el cambio del primero ya dentro.
  select payload into v_payload
  from public.lr_suite_private_data
  where key = 'gasto-alertas'
  for update;

  v_payload := coalesce(v_payload, '{}'::jsonb);
  v_cuentas := coalesce(v_payload -> 'cuentas', '{}'::jsonb);
  v_cuenta := coalesce(v_cuentas -> p_cuenta, '{}'::jsonb);
  v_presupuestos := coalesce(v_cuenta -> 'presupuestos', '{}'::jsonb);

  if v_monto > 0 then
    v_presupuestos := v_presupuestos || jsonb_build_object(p_mes, v_monto);
  else
    v_presupuestos := v_presupuestos - p_mes;
  end if;

  v_cuenta := v_cuenta || jsonb_build_object('presupuestos', v_presupuestos);
  v_cuentas := v_cuentas || jsonb_build_object(p_cuenta, v_cuenta);
  v_payload := v_payload || jsonb_build_object('cuentas', v_cuentas);

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('gasto-alertas', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_payload;
end;
$$;

-- ── La marca a la que pertenece una cuenta ──────────────────────────────────
-- Cadena vacia = «Sin marca», que no es lo mismo que no haber elegido nunca: elegir «Sin marca»
-- manda sobre la marca que el modulo adivina por el nombre de la cuenta, asi que la clave se
-- guarda igual.
create or replace function public.lr_suite_gasto_set_marca(
  p_cuenta text,
  p_marca text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_cuentas jsonb;
  v_cuenta jsonb;
  v_marca text;
begin
  if not public.is_lr_suite_pending_user() then
    raise exception 'Sin permiso para guardar marcas' using errcode = '42501';
  end if;
  if coalesce(p_cuenta, '') !~ '^[0-9A-Za-z._-]{1,64}$' then
    raise exception 'Id de cuenta no valido';
  end if;

  v_marca := btrim(coalesce(p_marca, ''));
  if length(v_marca) > 120 then
    raise exception 'El nombre de la marca es demasiado largo';
  end if;

  select payload into v_payload
  from public.lr_suite_private_data
  where key = 'gasto-alertas'
  for update;

  v_payload := coalesce(v_payload, '{}'::jsonb);
  v_cuentas := coalesce(v_payload -> 'cuentas', '{}'::jsonb);
  v_cuenta := coalesce(v_cuentas -> p_cuenta, '{}'::jsonb);

  v_cuenta := v_cuenta || jsonb_build_object('marca', v_marca);
  v_cuentas := v_cuentas || jsonb_build_object(p_cuenta, v_cuenta);
  v_payload := v_payload || jsonb_build_object('cuentas', v_cuentas);

  insert into public.lr_suite_private_data (key, payload, updated_at)
  values ('gasto-alertas', v_payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
        updated_at = excluded.updated_at;

  return v_payload;
end;
$$;

-- ── Permisos ───────────────────────────────────────────────────────────────
-- La comprobacion de verdad es is_lr_suite_pending_user() dentro de cada funcion; esto deja fuera
-- a quien no haya iniciado sesion.
revoke all on function public.lr_suite_gasto_set_presupuesto(text, text, numeric) from public, anon;
revoke all on function public.lr_suite_gasto_set_marca(text, text) from public, anon;
grant execute on function public.lr_suite_gasto_set_presupuesto(text, text, numeric) to authenticated;
grant execute on function public.lr_suite_gasto_set_marca(text, text) to authenticated;

-- El modulo las llama por nombre: sin esto PostgREST responde PGRST202 hasta que recargue solo.
notify pgrst, 'reload schema';

-- ── Comprobaciones ─────────────────────────────────────────────────────────
-- Las dos funciones instaladas (debe devolver 2):
-- select count(*) from pg_proc
-- where proname in ('lr_suite_gasto_set_presupuesto', 'lr_suite_gasto_set_marca');
--
-- Los presupuestos de un mes, como los ve el modulo:
-- select cuenta.key as cuenta, cuenta.value -> 'presupuestos' ->> '2026-11' as noviembre
-- from public.lr_suite_private_data d,
--      jsonb_each(d.payload -> 'cuentas') as cuenta
-- where d.key = 'gasto-alertas'
-- order by 2 desc nulls last;
