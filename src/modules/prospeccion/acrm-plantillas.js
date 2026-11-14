// Las plantillas de mensaje del ACRM: lo que ya funcionó escrito una vez y disponible en la ficha de
// todos los demás leads.
//
// Un mensaje nace en un lead —el primer contacto de LinkedIn, el seguimiento de un hito— y casi
// siempre sirve igual para el siguiente. Guardarlo como plantilla lo deja en un selector que aparece
// en los tres sitios donde se escribe un mensaje en la ficha: el cuadro del primer contacto, el de
// registrar un contacto y el formulario de hitos.
//
// Son del equipo, no de cada navegador: viven en Supabase (lr_suite_private_data, clave
// «acrm-plantillas»), la misma fila compartida que ya usa la inversión del mes, así que no hace
// falta ninguna migración. Cada escritura relee la fila y fusiona antes de subir: si Diego guarda
// una plantilla mientras Jorge Luis guarda otra, no se pisan.
//
// Este archivo no toca la pantalla: la dibuja el index.html (acrmLeadsModule). Prueba:
// tests/acrm/plantillas.mjs.
(function(){
"use strict";
const TABLA='lr_suite_private_data';
const CLAVE='acrm-plantillas';
const CANALES=['linkedin','whatsapp','llamada','correo','reunion'];
// Un tope sano: el selector se usa de un vistazo y la fila compartida se lee entera cada vez.
const LIMITE=60;
const LARGO_MENSAJE=4000;
const LARGO_NOMBRE=80;
const fallo=e=>Object.assign(new Error(String(e?.message||e)),{causa:e});
const limpio=(v,n)=>String(v??'').replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,n);
const nuevoId=()=>`pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
// Dos plantillas son la misma si dicen lo mismo por el mismo canal: guardar dos veces el texto que
// se acaba de copiar no debe llenar el selector de repetidos.
const huella=p=>`${p.canal}|${p.mensaje.replace(/\s+/g,' ').toLowerCase()}`;

// Lo que se guarda de una plantilla, o null si no hay mensaje que guardar. El nombre es lo que se
// lee en el selector: sin nombre, el principio del propio mensaje.
function normalizar(p){
 const mensaje=String(p?.mensaje??'').replace(/\r\n/g,'\n').trim().slice(0,LARGO_MENSAJE);
 if(mensaje.length<3)return null;
 const nombre=limpio(p?.nombre,LARGO_NOMBRE)||limpio(mensaje.split('\n')[0],60)||'Mensaje';
 const creadoEn=Number(p?.creadoEn);
 return {id:limpio(p?.id,60)||nuevoId(),nombre,mensaje,
  canal:CANALES.includes(p?.canal)?p.canal:'',
  creadoPor:limpio(p?.creadoPor,120),
  creadoEn:Number.isFinite(creadoEn)&&creadoEn>0?creadoEn:Date.now()};
}

// La lista limpia de varias fuentes (la de la base y la que se está guardando): sin repetidos por id
// ni por texto —gana la más nueva—, ordenada por nombre y recortada al tope.
function fusionar(...fuentes){
 const porId=new Map();
 for(const fuente of fuentes){
  for(const cruda of Array.isArray(fuente)?fuente:[]){
   const p=normalizar(cruda);
   if(!p)continue;
   const previa=porId.get(p.id);
   if(!previa||p.creadoEn>=previa.creadoEn)porId.set(p.id,p);
  }
 }
 const porHuella=new Map();
 for(const p of porId.values()){
  const previa=porHuella.get(huella(p));
  if(!previa||p.creadoEn>previa.creadoEn)porHuella.set(huella(p),p);
 }
 return [...porHuella.values()].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).slice(0,LIMITE);
}

// La fila compartida. Si no existe todavía o la cuenta no la puede leer, la ficha se dibuja igual
// con el selector vacío: una plantilla es un atajo, no el mensaje.
async function leer(client){
 const r=await client.from(TABLA).select('payload').eq('key',CLAVE).maybeSingle();
 if(r.error){console.warn('ACRM: no se pudieron leer las plantillas',r.error.message);return [];}
 return fusionar(r.data?.payload?.plantillas);
}

async function subir(client,plantillas,quien){
 const r=await client.from(TABLA).upsert(
  {key:CLAVE,payload:{plantillas,actualizadoPor:limpio(quien,120)},updated_at:new Date().toISOString()},
  {onConflict:'key'}
 );
 if(r.error)throw fallo(r.error);
 return plantillas;
}

// Guardar una plantilla nueva: se relee la fila y se fusiona, para no borrar lo que otro acaba de
// guardar. Si el mismo texto ya estaba, se devuelve esa y no se duplica.
async function guardar(client,entrada,{quien=''}={}){
 const nueva=normalizar({...entrada,creadoPor:entrada?.creadoPor||quien,creadoEn:Date.now()});
 if(!nueva)throw new Error('La plantilla necesita un mensaje.');
 const actuales=await leer(client);
 const repetida=actuales.find(p=>huella(p)===huella(nueva));
 if(repetida)return {plantillas:actuales,plantilla:repetida,repetida:true};
 if(actuales.length>=LIMITE)throw new Error(`Ya hay ${LIMITE} plantillas guardadas: borra alguna antes de crear otra.`);
 const plantillas=fusionar(actuales,[nueva]);
 await subir(client,plantillas,quien);
 return {plantillas,plantilla:nueva,repetida:false};
}

async function borrar(client,id,{quien=''}={}){
 const actuales=await leer(client);
 const plantillas=actuales.filter(p=>p.id!==id);
 if(plantillas.length===actuales.length)return actuales;
 return subir(client,plantillas,quien);
}

window.LRACRMPlantillas={leer,guardar,borrar,fusionar,normalizar,CANALES,TABLA,CLAVE,LIMITE};
})();
