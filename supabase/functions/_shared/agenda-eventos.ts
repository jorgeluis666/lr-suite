// Normalización independiente de red para probar recurrencias, días completos y duplicados.
export const EQUIPO_CALENDARIOS = [
  { id: 'diegomachuca@limaretail.com', nombre: 'Diego' },
  { id: 'jorgeluis@limaretail.com', nombre: 'Jorge Luis' },
];
function enlaceSeguro(valor:unknown) {
  try { const url=new URL(String(valor||'')); return url.protocol==='https:' ? url.href : null; } catch { return null; }
}
function ocurrenciaCanonica(valor:string) { return valor.length===10 ? valor : new Date(valor).toISOString(); }
export function normalizarEvento(evento: any, calendario: {id:string;nombre:string}) {
  const inicio = evento.start?.dateTime || (evento.start?.date ? `${evento.start.date}T00:00:00-05:00` : '');
  const fin = evento.end?.dateTime || (evento.end?.date ? `${evento.end.date}T00:00:00-05:00` : '');
  if (!evento.id || !Number.isFinite(Date.parse(inicio)) || !(Date.parse(fin)>Date.parse(inicio))) return null;
  return {
    id: `google:${calendario.id}:${evento.id}`, evento_id:evento.id, google_event_id:evento.id,
    ical_uid:evento.iCalUID || '', ocurrencia:ocurrenciaCanonica(evento.originalStartTime?.dateTime || evento.originalStartTime?.date || inicio),
    calendario_id:calendario.id, responsables:[calendario.nombre], inicio, fin,
    nombre:evento.summary || 'Reunión sin título', motivo:evento.location || '', tipo:'reunion',
    estado:evento.status === 'cancelled' ? 'cancelada' : 'confirmada', origen:'google', externo:true,
    dia_completo:!!evento.start?.date, meet_url:enlaceSeguro(evento.hangoutLink || evento.conferenceData?.entryPoints?.find((e:any)=>e.entryPointType==='video')?.uri),
    google_url:enlaceSeguro(evento.htmlLink),
  };
}
export function unirReuniones(locales: any[], externas: any[]) {
  const localesPorEvento = new Map(locales.filter(c=>c.google_event_id).map(c=>[c.google_event_id,c]));
  const grupos = new Map<string,any>();
  for (const cita of externas) {
    const local = localesPorEvento.get(cita.google_event_id);
    if (local) { local.responsables=[...new Set([...(local.responsables||[]),...(cita.responsables||[])])]; continue; }
    const clave=cita.ical_uid ? `${cita.ical_uid}:${cita.ocurrencia}` : `${cita.calendario_id}:${cita.evento_id}`;
    const previa=grupos.get(clave);
    if (previa) {
      previa.responsables=[...new Set([...previa.responsables,...cita.responsables])];
      if (cita.estado==='confirmada') previa.estado='confirmada';
    } else grupos.set(clave,{...cita,responsables:[...(cita.responsables||[])]});
  }
  return [...locales,...grupos.values()].sort((a,b)=>Date.parse(a.inicio)-Date.parse(b.inicio));
}
