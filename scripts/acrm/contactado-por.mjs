import {readFileSync} from 'node:fs';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='brfsipssqfsuoplxxcth'||!token)throw new Error('Falta acceso al proyecto de LR Suite');
async function query(sql,readOnly=false){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,read_only:readOnly})
 });
 if(!response.ok)throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
 return response.json();
}
const version='20261112060618';
const history=await query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS existe",true);
if(!history[0]?.existe)throw new Error('No existe el historial de migraciones; revisar antes de continuar');
const applied=await query(`SELECT version FROM supabase_migrations.schema_migrations WHERE version='${version}'`,true);
if(!applied.length){
 const sql=readFileSync('supabase/migrations/20261112060618_acrm_contactado_por.sql','utf8');
 // Register the exact migration in the same transaction as the schema change.
 const literal="'"+sql.replaceAll("'","''")+"'";
 await query(sql.replace(/COMMIT;\s*$/,`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${version}','acrm_contactado_por',ARRAY[${literal}]);\nNOTIFY pgrst, 'reload schema';\nCOMMIT;`));
 console.log('Migración aplicada y registrada: '+version);
}else console.log('Migración ya registrada: '+version);
const [checks]=await query(`SELECT
 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lr_acrm_capturas' AND column_name='contactado_por' AND data_type='uuid') AS columna,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.lr_acrm_capturas'::regclass) AS rls,
 has_function_privilege('authenticated','public.lr_acrm_contactado_por(text,uuid,uuid)','execute') AS usuario_ejecuta,
 NOT has_function_privilege('anon','public.lr_acrm_contactado_por(text,uuid,uuid)','execute') AS anon_bloqueado,
 NOT has_function_privilege('anon','private.lr_acrm_contactado_por(text,uuid,uuid)','execute') AS privado_bloqueado`,true);
console.log(JSON.stringify(checks));
if(!checks||Object.values(checks).some(v=>v!==true))throw new Error('Falló la verificación de esquema o permisos');
// Exercise the write as an existing authorized member, then roll it back. No lead is changed.
await query(`BEGIN;
DO $test$ DECLARE u uuid; c text; prev uuid; BEGIN
 SELECT usuario_id INTO u FROM public.lr_pros_colaboradores WHERE activo ORDER BY usuario_id LIMIT 1;
 SELECT clave,contactado_por INTO c,prev FROM public.lr_acrm_capturas ORDER BY clave LIMIT 1;
 IF u IS NULL OR c IS NULL THEN RAISE EXCEPTION 'Faltan datos para verificar'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.lr_acrm_contactado_por(c,u,prev);
 IF NOT EXISTS(SELECT 1 FROM public.lr_acrm_capturas WHERE clave=c AND contactado_por=u) THEN RAISE EXCEPTION 'No se guardó la selección'; END IF;
END $test$;
ROLLBACK;`);
console.log('Guardado y lectura verificados con rollback; datos originales conservados.');
