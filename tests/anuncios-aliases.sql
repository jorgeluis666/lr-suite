do $$
declare
  inventory jsonb := '{"original":{"archivoId":"video1"},"carrusel":{"carpetaId":"folder1","laminas":["slide1"]}}';
begin
  assert public.lr_suite_ads_match_creative(inventory,'Original','{"original":"folder1"}') ->> 'archivoId' = 'video1', 'Exact match must take precedence';
  assert public.lr_suite_ads_match_creative(inventory,'Variante','{"variante":"video1"}') ->> 'archivoId' = 'video1', 'Explicit alias must resolve';
  assert public.lr_suite_ads_match_creative(inventory,'Carrusel - Copia','{"carruselcopia":"folder1"}') ->> 'carpetaId' = 'folder1', 'Carousel alias must resolve';
  assert public.lr_suite_ads_match_creative(inventory,'Original - Copia',null) = 'null'::jsonb, 'No implicit copy fallback';
  assert public.lr_suite_ads_match_creative(inventory,'Orig',null) = 'null'::jsonb, 'No implicit prefix fallback';
  assert public.lr_suite_ads_match_creative(inventory,'Otro','{"otro":"other-brand-file"}') = 'null'::jsonb, 'Foreign/missing ID must not resolve';
  assert public.lr_suite_ads_match_creative(inventory || '{"duplicate":{"archivoId":"video1"}}','Variante','{"variante":"video1"}') = 'null'::jsonb, 'Ambiguous IDs must not resolve';
  assert public.lr_suite_ads_match_creative('{}','Variante','{"variante":"video1"}') = 'null'::jsonb, 'Empty inventory must remain unmatched';
  assert not has_function_privilege('anon','public.lr_suite_ads_match_creative(jsonb,text,jsonb)','execute'), 'No anon RPC';
  assert not has_function_privilege('authenticated','public.lr_suite_ads_match_creative(jsonb,text,jsonb)','execute'), 'No authenticated RPC';
end;
$$;
select '10 checks passed' result;
