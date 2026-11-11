do $test$
declare inventory jsonb; original jsonb:='{"archivoId":"original","tipo":"video"}'; newer jsonb:='{"archivoId":"newer","tipo":"video"}';
begin
 inventory:=public.lr_suite_ads_index_creative('{}','same',original);
 inventory:=public.lr_suite_ads_index_creative(inventory,'same',newer);
 assert (select count(*) from jsonb_each(inventory))=2,'Keep both IDs';
 assert inventory->'same'=original,'Keep exact-name precedence';
 assert public.lr_suite_ads_match_creative(inventory,'Reviewed','{"reviewed":"newer"}')=newer,'Alias finds colliding ID';
 assert public.lr_suite_ads_match_creative_month(inventory,'Same','{}','{"same":"newer"}')=newer,'Monthly pin finds colliding ID';
 assert public.lr_suite_ads_index_creative(inventory,'another',original)=inventory,'Repeated identity is not duplicated';
 assert public.lr_suite_ads_match_creative(inventory,'Unknown','{"unknown":"absent"}')='null'::jsonb,'Absent file stays unmatched';
 assert public.lr_suite_ads_match_creative_month(inventory,'Same','{}','{"same":null}')='null'::jsonb,'Explicit exclusion preserved';
 inventory:=public.lr_suite_ads_index_creative(public.lr_suite_ads_index_creative('{}','same',newer),'same',original);
 assert public.lr_suite_ads_match_creative_month(inventory,'Same','{}','{"same":"original"}')=original,'Pin works regardless of listing order';
 assert not has_function_privilege('anon','public.lr_suite_ads_index_creative(jsonb,text,jsonb)','execute'),'No anonymous endpoint';
 assert not has_function_privilege('authenticated','public.lr_suite_ads_index_creative(jsonb,text,jsonb)','execute'),'No new user endpoint';
end $test$;
