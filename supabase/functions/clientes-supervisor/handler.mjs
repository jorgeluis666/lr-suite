import {review,modelContext,SYSTEM} from './core.mjs';
// Dependencies are injected so tests never contact a model, CRM or WhatsApp.
export function createHandler(deps) {
 return async function handle(request) {
  const headers={'content-type':'application/json','cache-control':'no-store',...deps.cors};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return reply({error:'Método no permitido.'},405);
  try {
   const user=await deps.authorize(request);
   if(!user)return reply({error:'Sesión no autorizada.'},401);
   const raw=await request.text();if(raw.length>2048)return reply({error:'Petición demasiado larga.'},413);
   let body;try{body=JSON.parse(raw);}catch{return reply({error:'Petición inválida.'},400);}
   if(!body || !/^[A-Za-z0-9._-]{1,150}$/.test(body.cliente || '') || typeof body.version!=='string' || !['reglas','ia'].includes(body.modo))return reply({error:'Selecciona una ficha guardada y un modo válido.'},400);
   const record=await deps.read(user,body.cliente);
   if(!record)return reply({error:'Ficha no disponible para esta sesión.'},404);
   if(record.updated_at!==body.version)return reply({error:'La ficha cambió. Recarga antes de revisarla.'},409);
   const report=review(record);
   if(body.modo==='ia') {
    const agent=await deps.agent(user);
    if(!agent || agent.activo!==true)return reply({error:'Registra y activa supervisor en Agentes IA antes de solicitar recomendaciones.'},409);
    if(!agent.modelo)return reply({error:'Configura un modelo para el supervisor en Agentes IA.'},409);
    const output=await deps.analyze(agent.modelo,SYSTEM,modelContext(record,report));
    const receipt=await deps.usage(user,body.cliente,agent.modelo,output.usage);
    report.modo='ia';report.modelo=agent.modelo;report.consumo_registrado=receipt;
    report.recomendacion=String(output.text || '').slice(0,10000);
    if(!receipt)report.aviso='No se pudo registrar el consumo. La llamada al modelo sí se realizó; revisa el registro antes de repetirla.';
   }
   // Recheck to avoid presenting a stale review as the current checklist.
   const latest=await deps.read(user,body.cliente);
   report.vigente=latest?.updated_at===record.updated_at;
   return reply(report);
  } catch { return reply({error:'No se pudo completar la revisión. La ficha no fue modificada.'},503); }
 };
}
