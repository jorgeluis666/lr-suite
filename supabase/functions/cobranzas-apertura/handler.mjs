// URL pública con un token aleatorio por envío. No almacena IP, navegador ni destinatario.
const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
export function createHandler({url, serviceKey, fetchImpl = fetch, now = () => new Date()}) {
  return async request => {
    if (request.method !== 'GET') return new Response(null, {status:405, headers:{Allow:'GET'}});
    const token = new URL(request.url).searchParams.get('token') || '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token) && url && serviceKey) {
      try {
        const response = await fetchImpl(`${url}/rest/v1/lr_suite_cobranzas_envios?token_apertura=eq.${token}&seguimiento_apertura=eq.true&primera_apertura=is.null`, {
          method:'PATCH', headers:{apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, 'Content-Type':'application/json', Prefer:'return=minimal'},
          body:JSON.stringify({primera_apertura:now().toISOString()}), signal:AbortSignal.timeout(5000),
        });
        if (!response.ok) console.error('No se pudo registrar la señal de apertura');
      } catch { console.error('Seguimiento de apertura no disponible'); }
    }
    // Misma respuesta para tokens existentes, inexistentes o inválidos: no revela contactos.
    return new Response(gif, {headers:{'Content-Type':'image/gif','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'}});
  };
}
