// Importa únicamente agregados de la hoja: nunca nombres, perfiles ni contactos.
// Ejecutar mediante el workflow crm-rubros.yml; los datos vienen del evento, no del repositorio.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='brfsipssqfsuoplxxcth'||!token)throw Error('Falta acceso al proyecto de LR Suite');
const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const raw=event.inputs?.datos||'';
if(raw.length>50000)throw Error('El resumen es demasiado grande');
const payload=JSON.parse(raw);
assert.equal(payload.version,1);assert.equal(payload.metrica,'anunciantes');
assert.equal(payload.fuente,'https://docs.google.com/spreadsheets/d/15co7-JfItz4JN5eBvXc6-gvy-6-aPykVzAKE4FG-39U/edit');
for(const key of ['ambas','google','meta']){
 const serie=payload.series?.[key];assert.ok(Number.isSafeInteger(serie?.total)&&serie.total>=0);
 assert.ok(Array.isArray(serie.rubros)&&serie.rubros.length<=300);
 let suma=0;
 for(const row of serie.rubros){assert.equal(typeof row.rubro,'string');assert.ok(row.rubro.length<=200);assert.ok(Number.isSafeInteger(row.valor)&&row.valor>=0);suma+=row.valor;}
 assert.equal(suma,serie.total);
}
assert.ok(payload.series.ambas.total>=Math.max(payload.series.google.total,payload.series.meta.total));
assert.ok(payload.series.ambas.total<=payload.series.google.total+payload.series.meta.total);
for(const key of ['desde','hasta'])assert.match(payload[key],/^\d{4}-\d{2}-\d{2}$/);
assert.match(payload.actualizadoEn,/^\d{4}-\d{2}-\d{2}T/);
for(const value of Object.values(payload.cobertura))assert.ok(Number.isSafeInteger(value)&&value>=0);
async function query(sql,readOnly=false){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:readOnly})});
 if(!r.ok)throw Error(`Supabase HTTP ${r.status}`);
 return r.json();
}
const [check]=await query("SELECT relrowsecurity AS rls FROM pg_class WHERE oid='public.lr_suite_private_data'::regclass",true);
assert.equal(check?.rls,true,'Los agregados solo se guardan en la tabla privada con RLS');
const literal="'"+JSON.stringify(payload).replaceAll("'","''")+"'::jsonb";
await query(`BEGIN;
 INSERT INTO public.lr_suite_private_data(key,payload,updated_at) VALUES('acrm-rubros-publicidad',${literal},now())
 ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at
 WHERE lr_suite_private_data.payload->>'actualizadoEn' IS NULL OR lr_suite_private_data.payload->>'actualizadoEn' <= excluded.payload->>'actualizadoEn';
 DO $test$ DECLARE u uuid; BEGIN
  SELECT usuario_id INTO u FROM public.lr_pros_colaboradores WHERE activo ORDER BY usuario_id LIMIT 1;
  IF u IS NULL THEN RAISE EXCEPTION 'Falta miembro habilitado para verificar'; END IF;
  SET LOCAL ROLE anon;
  BEGIN
   IF EXISTS(SELECT 1 FROM public.lr_suite_private_data WHERE key='acrm-rubros-publicidad') THEN RAISE EXCEPTION 'El corte no debe ser público'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  SET LOCAL ROLE authenticated;
  IF NOT EXISTS(SELECT 1 FROM public.lr_suite_private_data WHERE key='acrm-rubros-publicidad') OR NOT EXISTS(SELECT 1 FROM public.lr_acrm_capturas) THEN RAISE EXCEPTION 'No se pueden leer los gráficos como miembro autorizado'; END IF;
 END $test$;
 COMMIT;`);
const [saved]=await query(`SELECT payload=${literal} AS coincide FROM public.lr_suite_private_data WHERE key='acrm-rubros-publicidad'`,true);
assert.equal(saved?.coincide,true,'Debe leerse exactamente el corte guardado');
console.log('Corte importado y releído. RLS verificado: anónimo sin acceso y miembro autorizado con acceso al CRM y la muestra.');
