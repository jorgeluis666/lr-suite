import {readFileSync} from 'node:fs';
const ref=process.env.SUPABASE_PROJECT_REF, token=process.env.SUPABASE_ACCESS_TOKEN;
if(!ref||!token) throw new Error('Faltan credenciales de despliegue');
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
async function api(path,body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error(`Management API ${path}: HTTP ${r.status}`);return r.json();}
try {
 const secrets=await api('secrets');
 const names=new Set(secrets.map(s=>s.name));
 for(const name of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','WHATSAPP_TOKEN','WHATSAPP_PHONE_ID']) console.log(`${name}: ${names.has(name)?'configurado':'FALTA'}`);
} catch(error) {
 if(!String(error.message).includes('HTTP 403')) throw error;
 console.log('El token no permite listar secretos; se continúa con los permisos de instalación disponibles.');
}
if(process.argv.includes('--instalar')) {
  await api('database/query',{query:readFileSync('src/modules/agenda/BBDD/agenda-google.sql','utf8')});
  console.log('Tabla de calendario y función de sincronización instaladas.');
}
const result=await api('database/query',{query:`select (select nullif(calendar_id,'') is not null from public.lr_suite_agenda_config where app_id='lr-suite-agenda') as calendario_agente_configurado, (select count(*) from public.lr_suite_agenda_citas) as citas_guardadas, (select count(*) from public.lr_suite_agenda_citas where origen='asistente') as citas_del_agente, to_regclass('public.lr_suite_agenda_google') is not null as cache_instalada;`,read_only:true});
console.log(JSON.stringify(result));
if(process.argv.includes('--instalar')) {
 const checks=await api('database/query',{query:`select relrowsecurity as rls from pg_class where oid='public.lr_suite_agenda_google'::regclass;`,read_only:true});
 if(!checks[0]?.rls)throw new Error('RLS no está activo');
 const perms=await api('database/query',{query:`select has_table_privilege('anon','public.lr_suite_agenda_google','select') as anon_lee,has_table_privilege('authenticated','public.lr_suite_agenda_google','insert') as usuario_escribe,has_function_privilege('anon','public.lr_suite_agenda_google_guardar(text,timestamptz,timestamptz,jsonb)','execute') as anon_ejecuta;`,read_only:true});
 if(Object.values(perms[0]).some(Boolean))throw new Error('Permisos demasiado amplios');
 console.log('Verificado: RLS activo; sin lectura anónima ni escritura de clientes.');
}
