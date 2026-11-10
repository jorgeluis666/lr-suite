// Las cotizaciones dentro del ACRM: el puente entre la tabla lr_acrm_cotizaciones y la pantalla.
//
// La pantalla (index.html) y el resto de LR Suite —P&G, el agente, el exportador— hablan el
// idioma del módulo viejo: montoCotizado, fechaEnvio, estado «Aprobado». Reescribirlos a todos
// para que hablen el de la tabla era mucho cambio para nada: este archivo traduce en los dos
// sentidos, y es lo único que sabe que la tabla existe. Vive aparte para poder probarse.
//
// Escribir pasa siempre por lr_acrm_operar, la misma RPC que los botones del ACRM: una
// cotización por llamada, no el bloque entero. Antes se subían las 22 en cada cambio y la
// última pestaña en guardar decidía por todas.
(function(){
"use strict";
const ESTADO_TEXTO={enviada:'Enviado',revision:'En revisión',aprobada:'Aprobado',perdida:'Perdido'};
const sinTildes=v=>String(v??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
// El mismo criterio que usó la migración para las 22 que ya existían: un archivo importado con
// «Aprobada» o «Ganado» tiene que caer en el mismo sitio que cayeron ellas.
function estadoBase(texto){
 const v=sinTildes(texto);
 if(/aprob|ganad|cerrad|acept/.test(v))return 'aprobada';
 if(/revision|negocia|evalua/.test(v))return 'revision';
 if(/perdid|anulad|cancelad|rechaz/.test(v))return 'perdida';
 return 'enviada';
}
const numero=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n*100)/100:0;};
const fecha=v=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):'';

// Fila de la tabla → cotización como la conoce la pantalla.
function desdeFila(f){
 const hechos=Math.max(0,Math.min(8,Number(f.contactos_hechos)||0));
 return {
  id:f.id,captura:f.captura,
  cliente:f.cliente||'',contacto:f.contacto||'',telefono:f.telefono||'',emailContacto:f.email||'',
  servicio:f.servicio||'',servicioEstandar:f.servicio_estandar||'',origen:f.origen||'',
  montoCotizado:Number(f.monto)||0,montoFacturado:Number(f.facturado)||0,gastos:Number(f.gastos)||0,
  estado:ESTADO_TEXTO[f.estado]||'Enviado',
  fechaEnvio:f.enviada?String(f.enviada).slice(0,10):'',
  // contactos_hechos es lo que mueve la cola; cantidad_contactos y el registro de cada toque
  // (tipo, fecha, orden y nota) llegaron con 20261110020000. Sin esa migración no vienen.
  contactosRealizados:hechos,
  cantidadContactos:f.cantidad_contactos==null?hechos:Number(f.cantidad_contactos)||0,
  contactos:(Array.isArray(f.contactos)?f.contactos:[]).map((c,i)=>[c?.tipo||'otro',c?.fecha||'',Number(c?.orden)||i+1,c?.nota||'']),
  archivoUrl:f.archivo_url||null,archivoTipo:f.archivo_tipo||null,
  desglose:Array.isArray(f.desglose)?f.desglose:[],
  version:f.version,actualizadoEn:f.actualizado_en||''
 };
}

// Cotización de la pantalla → datos de la RPC. Se manda la fila completa: la RPC reemplaza todos
// los campos, así que uno que faltara se guardaría vacío.
function aDatos(q){
 const estandar=String(q.servicioEstandar||'').trim().slice(0,300);
 return {
  id:String(q.id||''),captura:q.captura||'',
  cliente:String(q.cliente||'').trim().slice(0,300),contacto:String(q.contacto||'').trim().slice(0,300),
  telefono:String(q.telefono||'').trim().slice(0,60),email:String(q.emailContacto||'').trim().slice(0,200),
  servicio:String(q.servicio||'').trim().slice(0,300),servicio_estandar:estandar,origen:String(q.origen||'').trim().slice(0,60),
  monto:numero(q.montoCotizado),facturado:numero(q.montoFacturado),gastos:numero(q.gastos),
  estado:estadoBase(q.estado),
  // Sin fecha va null y no '': la RPC lo convierte a date y '' es un error.
  enviada:fecha(q.fechaEnvio)||null,
  archivo_url:q.archivoUrl||null,archivo_tipo:['link','file'].includes(q.archivoTipo)?q.archivoTipo:null,
  desglose:(Array.isArray(q.desglose)?q.desglose:[]).map(x=>({concepto:String(x?.concepto||''),monto:numero(x?.monto)})),
  cantidad_contactos:Math.max(0,Math.min(1000,Math.round(Number(q.cantidadContactos)||0))),
  contactos:(Array.isArray(q.contactos)?q.contactos:[]).map((c,i)=>({tipo:c?.[0]||'otro',fecha:c?.[1]||'',orden:Number(c?.[2])||i+1,nota:c?.[3]||''}))
 };
}
const hechosDe=q=>Math.max(0,Math.min(8,Math.round(Number(q?.contactosRealizados??q?.cantidadContactos)||0)));

// Siempre un Error con su mensaje, venga de supabase-js o de la red: la pantalla lo muestra tal cual.
const fallo=e=>Object.assign(new Error(String(e?.message||e)),{causa:e});
async function cargar(client){
 const {data,error}=await client.from('lr_acrm_cotizaciones').select('*').order('enviada',{ascending:false,nullsFirst:false}).limit(2000);
 if(error)throw fallo(error);
 return (data||[]).map(desdeFila);
}

// Las escrituras van de una en una y en orden: dos cambios seguidos a la misma cotización (el
// estado y luego los gastos) no pueden llegar al revés y dejar el primero encima del segundo.
let cola=Promise.resolve();
const enCola=fn=>{const r=cola.then(fn,fn);cola=r.catch(()=>{});return r;};
const rpc=async(client,accion,datos)=>{const r=await client.rpc('lr_acrm_operar',{p_accion:accion,p_datos:datos});if(r.error)throw fallo(r.error);return r.data;};
// Se guarda una sola cotización, nunca la lista: con la lista, la pestaña que guarda después pisa
// con datos viejos lo que otra cambió en otra cotización. La RPC de 20261110020000 guarda también el
// servicio estándar y el registro de toques; si esa migración no está aplicada, se usa la operación
// de una sola fila que ya existía, que no los tiene (el servicio estándar viaja entonces como
// servicio, para no perder la elección).
let sinGuardarLista=false;
const faltaFuncion=e=>/PGRST202|could not find the function|lr_acrm_cotizaciones_guardar/i.test(String(e?.code||'')+' '+String(e?.message||''));
async function guardarUna(client,q){
 const datos=aDatos(q);
 if(!sinGuardarLista){
  // Los toques los mueve la cola del ACRM («Hecha») mientras la pantalla está abierta: se toma el
  // valor de la base en este momento, no el que se leyó al abrir.
  const actual=await client.from('lr_acrm_cotizaciones').select('contactos_hechos').eq('id',datos.id).maybeSingle();
  if(actual.error)throw fallo(actual.error);
  const fila={...datos,contactos_hechos:actual.data?Number(actual.data.contactos_hechos)||0:hechosDe(q)};
  const r=await client.rpc('lr_acrm_cotizaciones_guardar',{p_items:[fila]});
  if(!r.error)return r.data;
  if(!faltaFuncion(r.error))throw fallo(r.error);
  sinGuardarLista=true;
 }
 return rpc(client,'cotizacion',{...datos,servicio:datos.servicio_estandar||datos.servicio});
}
const guardar=(client,q)=>enCola(()=>guardarUna(client,q));
const toque=(client,id,hechos)=>enCola(()=>rpc(client,'cotizacion_toque',{id,hechos:Math.max(0,Math.min(8,Math.round(Number(hechos)||0)))}));

// Ids con el mismo alfabeto que admite el importador.
const nuevoId=()=>'cot-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);

// Fusiona un archivo importado con lo que hay en la base: actualiza por id, agrega las nuevas y
// no toca las que el archivo no trae. Un campo que el archivo no tiene conserva su valor.
function fusionar(existentes,importadas,base={}){
 const porId=new Map(existentes.map(q=>[q.id,q]));
 const cambios=[];let nuevas=0,actualizadas=0;
 for(const q of importadas){
  const actual=porId.get(q.id);
  if(actual)actualizadas++;else nuevas++;
  const junta={...(actual||base),...q,id:q.id,captura:actual?.captura||q.captura||''};
  // Los toques solo se mueven si el archivo trae la columna y dice otra cosa.
  const toques=('contactosRealizados' in q||'cantidadContactos' in q)&&hechosDe(junta)!==hechosDe(actual||{})?hechosDe(junta):null;
  cambios.push({cotizacion:junta,toques});
  porId.set(q.id,junta);
 }
 return {cambios,nuevas,actualizadas,intactas:existentes.length-actualizadas};
}

// Guarda lo importado fila por fila. Una que falla no detiene las demás: se devuelve cuáles
// fallaron y por qué, para decirlo en pantalla en vez de perderlo en la consola.
async function importar(client,cambios,avance=()=>{}){
 const fallidas=[];let hechas=0;
 for(const {cotizacion,toques} of cambios){
  try{
   await guardar(client,cotizacion);
   if(toques!==null)await toque(client,cotizacion.id,toques);
   hechas++;
  }catch(e){fallidas.push({id:cotizacion.id,cliente:cotizacion.cliente,motivo:String(e?.message||e)});}
  avance(hechas+fallidas.length,cambios.length);
 }
 return {hechas,fallidas};
}

// Lo que cambia otra persona se ve sin recargar. Un solo canal, aunque la pantalla se redibuje
// muchas veces: pedir uno nuevo en cada dibujo dejaría suscripciones colgadas.
let canal=null,canalCliente=null,espera=null;
function vigilar(client,alCambiar){
 if(!client||canal&&canalCliente===client)return;
 dejar();
 canalCliente=client;
 canal=client.channel('acrm-cotizaciones-'+(crypto.randomUUID?.()||Date.now()))
  .on('postgres_changes',{event:'*',schema:'public',table:'lr_acrm_cotizaciones'},()=>{
   clearTimeout(espera);espera=setTimeout(alCambiar,400);
  })
  .subscribe();
}
function dejar(){clearTimeout(espera);if(canal&&canalCliente)canalCliente.removeChannel(canal);canal=null;canalCliente=null;}

window.LRACRMCotizaciones={desdeFila,aDatos,estadoBase,hechosDe,cargar,guardar,toque,nuevoId,fusionar,importar,vigilar,dejar,ESTADO_TEXTO};
})();
