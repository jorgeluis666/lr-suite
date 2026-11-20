/* Fuentes de inversión: IDs autorizados viven en Supabase, nunca en el sitio público. */
(function (root) {
  'use strict';
  const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const cents = value => Math.round((value + Number.EPSILON) * 100) / 100;
  function overlay(platforms, year, payload, config, status) {
    for (const kind of ['google', 'meta']) {
      const ids = [...new Set(config?.nexusAccounts?.[kind] || [])].map(String);
      if (!ids.length) continue;
      let platform = platforms.find(p => (kind === 'google' ? /google/i : /meta|facebook/i).test(p.name));
      if (!platform) {
        platform = {name: kind === 'google' ? 'Google Ads' : 'Meta Ads', amount: null, monthly: null};
        platforms.push(platform);
      }
      platform.nexus = true;
      platform.monthly = new Map(platform.monthly || []);
      const dates = String(platform.period || '').match(/\d{2}\/\d{2}\/\d{4}/g);
      if (dates?.length === 2 && number(platform.amount) !== null) {
        const month = d => `${d.slice(6)}-${d.slice(3,5)}`;
        platform.baseline = {start: month(dates[0]), end: month(dates[1]), amount: platform.amount};
      }
      for (const [month, report] of Object.entries(payload?.informes || {})) {
        if (!new RegExp(`^${year}-(0[1-9]|1[0-2])$`).test(month)) continue;
        const rows = (report.cuentas || []).filter(r => r.plataforma === kind && ids.includes(String(r.id)));
        // An absent account is unknown. Do not sum duplicates or other clients.
        const complete = ids.every(id => rows.filter(r => String(r.id) === id).length === 1);
        const amounts = rows.map(r => r.monedaConvertida === 'PEN' && number(r.costeConvertido) !== null
          ? number(r.costeConvertido) : r.moneda === 'PEN' ? number(r.coste) : null);
        const window = status?.ventanas?.[kind];
        const coverage = window?.mes === month ? window : report;
        const validDay = d => typeof d === 'string' && d.startsWith(month + '-') && /^\d{4}-\d{2}-\d{2}$/.test(d);
        platform.monthly.set(month, {
          amount: complete && amounts.every(v => v !== null) ? cents(amounts.reduce((a,b) => a+b,0)) : null,
          source: 'Nexus', currency: 'PEN', origin: null, rate: 1,
          from: validDay(coverage.desde) ? coverage.desde : null,
          through: validDay(coverage.hasta) ? coverage.hasta : null,
          syncedAt: window?.mes === month ? window.lastSync : report.subidoAt,
          issue: complete ? 'Falta importe o conversión a PEN en Nexus' : 'Cuenta sin informe en Nexus'
        });
      }
    }
  }
  function investment(platform, months, isTotal) {
    const entries = months.map(m => ({month:m, entry:platform.monthly?.get(m.id)}));
    let amount = 0, found = false;
    const sources = new Set(), missing = [];
    const b = platform.baseline;
    // A sheet range is indivisible until ALL its monthly reports are available.
    const baselineMonths = b ? Array.from({length:12},(_,i) => `${b.start.slice(0,4)}-${String(i+1).padStart(2,'0')}`).filter(m=>m>=b.start&&m<=b.end) : [];
    const useBaseline = isTotal && baselineMonths.length && !baselineMonths.every(m => number(platform.monthly?.get(m)?.amount) !== null);
    if (useBaseline) { amount += b.amount; found = true; sources.add(`Tabla madre (${b.start} a ${b.end}, sin desglose completo)`); }
    for (const {month,entry} of entries) {
      if (useBaseline && month.id >= b.start && month.id <= b.end) continue;
      if (!entry || number(entry.amount) === null) { missing.push(month.short); continue; }
      amount += entry.amount; found = true;
      sources.add(entry.source === 'Nexus' ? `Nexus${!isTotal && entry.through ? ' · al ' + entry.through : ''}` : 'Histórico');
    }
    return {amount:found ? cents(amount) : null, detail:[...sources].join(' + '), missing};
  }
  // Distribution is only an estimate over the reporting window, never over future days.
  function daily(entry, buckets) {
    if (!entry?.from || !entry?.through || entry.from > entry.through || number(entry.amount) === null) return buckets.map(()=>({value:null}));
    const days = buckets.filter(b => b.key >= entry.from && b.key <= entry.through);
    const positions = new Map(days.map((b,i)=>[b.key,i]));
    return buckets.map(b => {
      const i = positions.get(b.key);
      return {value:i === undefined ? null : (Math.round(entry.amount*100*(i+1)/days.length)-Math.round(entry.amount*100*i/days.length))/100,estimated:true};
    });
  }
  const api = {overlay, investment, daily};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LRFinancialSources = api;
})(typeof window === 'undefined' ? globalThis : window);
