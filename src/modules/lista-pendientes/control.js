// El control de lo que cierra cada persona: pendientes cerrados y tareas internas marcadas, hoy y
// en el mes. Una sola cuenta para los dos sitios que la muestran: el tablero (index.html, en
// pendingScoreForUser) y el correo de la 1 y las 5 p. m. (scripts/correo/resumen-persona.mjs).
// Antes estaba escrita dos veces, y las dos ya no coincidían: el correo tomaba los diez primeros
// caracteres de la fecha de cierre, que en un ISO como «2026-11-10T03:00:00Z» es el día en UTC.
// Un pendiente cerrado después de las 7 p. m. de Lima caía en el día siguiente.
//
// Sin dependencias y sin módulos: en el navegador se carga con <script> y en Node con import; los
// dos encuentran la cuenta en globalThis.LRControl.
(function(raiz){
"use strict";
const ZONA='America/Lima';
const diaLima=new Intl.DateTimeFormat('en-CA',{timeZone:ZONA,year:'numeric',month:'2-digit',day:'2-digit'});
const normal=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase();

// La identidad de una persona en la Suite. Los cierres se firman con el nombre del tablero
// («Jorge Luis», «Diego») y los cronómetros con el correo: los dos tienen que caer en la misma.
function persona(valor){
 const t=normal(valor);
 if(t.includes('jorge'))return 'jorge';
 if(t.includes('diego'))return 'diego';
 return t;
}

// El día en Lima de una fecha. Un día suelto («2026-11-10») se respeta tal cual: convertirlo a
// fecha lo leería como medianoche UTC y en Lima sería el día anterior.
function dia(valor){
 const texto=String(valor??'').trim();
 if(!texto)return '';
 if(/^\d{4}-\d{2}-\d{2}$/.test(texto))return texto;
 const fecha=new Date(/^\d+$/.test(texto)?Number(texto):texto);
 return Number.isNaN(fecha.getTime())?'':diaLima.format(fecha);
}
const mesDeDia=d=>(String(d||'').match(/^(\d{4}-\d{2})/)||[])[1]||'';

// Cada registro del historial llega con los nombres del tablero (completedAt, completedBy,
// subtasksDoneByUser) o con los de la función del correo (completadoEn, completadoPor, tareas).
const cierreEn=r=>r.completedAt||r.completadoEn||r.fecha_finalizacion||'';
const cerradoPor=r=>r.completedBy||r.completadoPor||r.owner||r.responsable||'';
const tareasQueSeLlevo=r=>r.subtasksDoneByUser||r.tareas||{};
const eliminada=r=>normal(r.action||r.accion)==='eliminada';
const subtareasCrudas=t=>(Array.isArray(t)&&Array.isArray(t[9])?t[9]:[]).filter(Boolean);

// cerrados: el historial. tareas: los pendientes abiertos. subtareas: cómo leer las subtareas de
// un pendiente (el tablero las normaliza; el correo las lee tal como vienen).
function contar({cerrados=[],tareas=[],subtareas=subtareasCrudas}={},quien,hoy,mes){
 const control={pendientesDia:0,pendientesMes:0,tareasDia:0,tareasMes:0};
 const clave=persona(quien);
 if(!clave)return control;
 // Las eliminadas no cuentan: borrar algo no es haberlo hecho.
 for(const r of Array.isArray(cerrados)?cerrados:[]){
  if(!r||typeof r!=='object'||eliminada(r))continue;
  if(persona(cerradoPor(r))===clave){
   const d=dia(cierreEn(r));
   if(d===hoy)control.pendientesDia++;
   if(d&&mesDeDia(d)===mes)control.pendientesMes++;
  }
  // Las tareas internas que el pendiente se llevó al cerrarse, por su propio día.
  for(const [d,porPersona] of Object.entries(tareasQueSeLlevo(r))){
   const hechas=Number(porPersona?.[clave]||0);
   if(!hechas)continue;
   if(d===hoy)control.tareasDia+=hechas;
   if(mesDeDia(d)===mes)control.tareasMes+=hechas;
  }
 }
 for(const t of Array.isArray(tareas)?tareas:[]){
  for(const s of subtareas(t)){
   if(normal(s?.status)!=='completado')continue;
   if(persona(s.completedBy||s.owner||t?.[1]||'')!==clave)continue;
   // Sin fecha de cierre no se le puede asignar un día: no cuenta para ninguno.
   const d=dia(s.completedAt);
   if(!d)continue;
   if(d===hoy)control.tareasDia++;
   if(mesDeDia(d)===mes)control.tareasMes++;
  }
 }
 return control;
}

raiz.LRControl={contar,persona,dia,mesDeDia};
})(typeof globalThis!=='undefined'?globalThis:window);
