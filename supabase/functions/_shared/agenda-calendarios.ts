import {db} from './base.ts';
import {listarEventos} from './google.ts';
import {EQUIPO_CALENDARIOS,normalizarEvento,unirReuniones} from './agenda-eventos.ts';

export async function sincronizarCalendarios(resumen:any, calendarId:string|null) {
  const desde=`${resumen.desde}T00:00:00-05:00`, hasta=`${resumen.hasta}T00:00:00-05:00`;
  const calendarios=[...EQUIPO_CALENDARIOS];
  if(calendarId && !calendarios.some(c=>c.id===calendarId)) calendarios.push({id:calendarId,nombre:'Agente LR WhatsApp'});
  const estados:any[]=[], citas:any[]=[];
  await Promise.all(calendarios.map(async calendario=>{
    try {
      const eventos=(await listarEventos(calendario.id,desde,hasta)).map(e=>normalizarEvento(e,calendario)).filter(Boolean);
      const guardado=await db().rpc('lr_suite_agenda_google_guardar',{p_calendario:calendario.id,p_desde:desde,p_hasta:hasta,p_eventos:eventos});
      if(guardado.error) throw new Error('No se pudo guardar la sincronización en Agenda.');
      citas.push(...eventos);
      estados.push({nombre:calendario.nombre,estado:'sincronizado',cantidad:eventos.length,actualizado_at:new Date().toISOString()});
    } catch(error) {
      const cache:{data:any[]}={data:[]};
      for(let offset=0;;offset+=1000) {
        const pagina=await db().from('lr_suite_agenda_google').select('datos,sincronizado_at').eq('calendario_id',calendario.id).lt('inicio',hasta).gt('fin',desde).order('evento_id').range(offset,offset+999);
        if(pagina.error) break;
        cache.data.push(...(pagina.data||[]));
        if((pagina.data||[]).length<1000) break;
      }
      citas.push(...cache.data.map(r=>({...r.datos,cache:true})));
      const detalle=String((error as Error).message||error);
      const mensaje=/secreto|renovó el acceso/i.test(detalle) ? 'Falta autorizar la conexión de Google Calendar.' : /not found|forbidden|permission/i.test(detalle) ? 'La cuenta conectada necesita permiso de lectura en este calendario.' : 'No se pudo sincronizar este calendario. Intenta Actualizar de nuevo.';
      estados.push({nombre:calendario.nombre,estado:'pendiente',error:mensaje,cache:!!cache.data?.length});
    }
  }));
  const reuniones=unirReuniones(resumen.citas||[],citas);
  const dia=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'});
  const hoy=dia.format(new Date());
  return {...resumen,citas:reuniones,calendarios:estados,
    calendario_agente:calendarId ? 'configurado':'pendiente',
    contadores:{...resumen.contadores,citas_hoy:reuniones.filter(c=>c.estado==='confirmada' && dia.format(new Date(c.inicio))===hoy).length}};
}
