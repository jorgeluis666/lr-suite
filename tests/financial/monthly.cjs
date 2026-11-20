const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const names = ['buildFinancialModel', 'parseSheetCsv', 'sheetTable', 'sheetDate', 'sheetNumber', 'sheetMonthNumber', 'financialSourceStatus', 'financialMonthlyModel', 'financialSelectedPeriod', 'financialPeriod', 'groupSalesByService',
  'financialIndicatorBuckets', 'financialIndicatorRows', 'commercialTemplateSegments', 'commercialRows',
  'dayKeyFrom', 'dayCount', 'parseDayKey', 'localDayKey', 'localMonthKey', 'sumarDias', 'monthLabelFor',
  'financialMonthView', 'financialMonthContext', 'financialMonthToolbar', 'financialDailySeries', 'financialSeriesChart', 'metric'];
const functions = names.map(name => {
  const match = html.match(new RegExp(`      function ${name}\\([^]*?^      }`, 'm'));
  assert.ok(match, name);
  return match[0];
}).join('\n');
function setup() {
  const ctx = vm.createContext({
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-12-01T03:00:00Z'])); } },
    LRFinancialSources: require('../../src/modules/estado-perdidas-ganancias/financial-sources.js'),
    financialNexus: null, financialSources: null, financialNexusStatus: null, financialSyncing: false,
    state: { financialMonth: '', financialGrain: '' }, quotes: [], commercialData: null,
    financialNotice: '', icons: { download: '', upload: '' },
    SHEET_MONTH_NAMES: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
    SHEET_MONTH_SHORT: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
    normalizeText: value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(), quoteOrigen: quote => quote.origen,
    fmtMoney: n => `S/ ${n}`, fmtMoneyCents: n => `S/ ${n.toFixed(2)}`, fmtNumber: String,
    compactMoney: n => `S/ ${Math.round(n)}`,
    fmtPercent: n => `${(n * 100).toFixed(1)}%`,
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  });
  vm.runInContext(functions, ctx);
  const model = { year: 2026, notes: [], platforms: [], months: [
    {id:'2026-10', label:'Octubre 2026', short:'Oct', sales:[], quotes:9, quoted:900, investment:310, notes:''},
    {id:'2026-11', label:'Noviembre 2026', short:'Nov', sales:[{date:'2026-11-03', billed:200, service:'Web', isNewClient:true}], quotes:99, quoted:500, investment:100, notes:''}
  ] };
  return {ctx, model, view: ctx.financialMonthlyModel(model)};
}
test('defaults to the Lima month; empty months selectable without mutating annual data', () => {
  const {ctx, model, view} = setup();
  assert.equal(ctx.financialSelectedPeriod(model), '2026-11'); // UTC is already December.
  assert.equal(view.months.length, 12);
  assert.equal(model.months.length, 2);
  ctx.state.financialMonth = '2026-12';
  assert.equal(ctx.financialSelectedPeriod(model), '2026-12');
  assert.equal(ctx.financialPeriod(view, '2026-12').investment, null);
  ctx.state.financialMonth = 'ytd';
  assert.equal(ctx.financialSelectedPeriod(model), 'ytd');
  assert.equal(ctx.financialPeriod(model, 'ytd').investment, 410);
});
test('daily calendar handles 28/29/30/31 days without leaking neighboring months', () => {
  const {ctx, view} = setup();
  for (const [month, count] of [['2026-02',28],['2028-02',29],['2026-11',30],['2026-10',31]]) {
    const days = ctx.financialIndicatorBuckets(view, month, 'diario');
    assert.equal(days.length, count);
    assert.equal(days[0].start, `${month}-01`);
    assert.equal(days.at(-1).end, `${month}-${count}`);
    assert.ok(days.every(d => d.start === d.end));
  }
});
test('monthly, daily and weekly investment reconcile to cents and stay in the selected month', () => {
  const {ctx, view} = setup();
  for (const [month, total] of [['2026-10',310],['2026-11',100]]) {
    for (const grain of ['diario', 'semanas']) {
      const buckets = ctx.financialIndicatorBuckets(view, month, grain);
      const rows = ctx.financialIndicatorRows(view, buckets, grain);
      assert.equal(rows[0].cells.reduce((n,c) => n + Math.round(c.value * 100), 0), total * 100);
      assert.ok(rows[0].cells.every(c => c.estimated));
    }
  }
});
test('weekly leads remain weekly, missing is not zero, and quotations stay pending', () => {
  const {ctx, view} = setup();
  ctx.commercialData = {rows:[{desde:'2026-11-02',hasta:'2026-11-08',leadsAds:7,leadsReferidos:2,cotizaciones:44}]};
  const buckets = ctx.financialIndicatorBuckets(view,'2026-11','diario');
  const daily = ctx.financialIndicatorRows(view,buckets,'diario').find(r=>r.key==='leads');
  assert.ok(daily.cells.every(c=>c.value===null));
  const weekly = ctx.financialIndicatorRows(view,ctx.financialIndicatorBuckets(view,'2026-11','semanas'),'semanas').find(r=>r.key==='leads');
  assert.equal(weekly.cells[1].value,9);
  const rendered = ctx.financialMonthView(view,ctx.financialPeriod(view,'2026-11'));
  assert.match(rendered, /Pendiente de integración/);
  assert.match(rendered, /Leads Ads<\/span><strong>7</);
  assert.doesNotMatch(rendered, />99<|>44</);
  assert.match(rendered, /no es el gasto real/);
  ctx.commercialData = null;
  assert.match(ctx.financialMonthView(view,ctx.financialPeriod(view,'2026-12')), /Sin informe mensual de Google Ads/);
});
test('right context uses the same month and supports missing or zero investment', () => {
  const {ctx, view} = setup();
  const nov = ctx.financialPeriod(view,'2026-11');
  assert.equal(nov.billed, 200); assert.equal(nov.roas, 2); assert.equal(nov.result,100);
  const rendered = ctx.financialMonthContext(view,nov);
  assert.match(rendered,/Noviembre 2026/); assert.equal((rendered.match(/class="panel financial-context-chart"/g)||[]).length,4);
  view.months[10].investment = 0;
  assert.equal(ctx.financialPeriod(view,'2026-11').roas,null);
  assert.match(ctx.financialMonthContext(view,ctx.financialPeriod(view,'2026-12')),/Diciembre 2026/);
});
module.exports = {setup, functions, html};

test('daily graph uses Google Ads only; quantities and pending quotes have separate series', () => {
  const {ctx, model} = setup();
  model.platforms = [
    {name:'Google Ads', monthly:new Map([['2026-11',{amount:300,origin:300,currency:'PEN',rate:1}]])},
    {name:'Meta Ads', monthly:new Map([['2026-11',{amount:900,origin:900,currency:'PEN',rate:1}]])}
  ];
  const view=ctx.financialMonthlyModel(model), period=ctx.financialPeriod(view,'2026-11');
  const {series,buckets}=ctx.financialDailySeries(view,period);
  assert.equal(period.investment,1200);
  assert.equal(series[0].total,300);
  assert.equal(series[0].cells.reduce((n,c)=>n+c.value,0),300);
  assert.ok(series[1].cells.every(c=>c.value===null));
  assert.ok(series[2].cells.every(c=>c.value===null));
  assert.equal(buckets.length,30);
  const spend=ctx.financialMonthView(view,period);
  assert.match(spend,/stroke-dasharray="6 5"/);
  assert.match(spend,/Día del mes/);
  assert.match(spend,/Gasto \(S\/\)/);
  ctx.state.financialDailyMetric='cotizaciones';
  const pending=ctx.financialMonthView(view,period);
  assert.match(pending,/Pendiente de integración automática/);
  assert.doesNotMatch(pending,/<polyline/);
});
test('context plots keep unreported months empty and highlight the selected month', () => {
  const {ctx,view}=setup();
  const month=ctx.financialPeriod(view,'2026-12');
  const charts=ctx.financialMonthContext(view,month);
  assert.equal((charts.match(/<svg /g)||[]).length,4);
  assert.match(charts,/Diciembre 2026 resaltado/);
  assert.match(charts,/Pendiente de integración automática/);
  assert.doesNotMatch(charts,/aria-label="Diciembre 2026: S\/ 0.00"/);
  const row={label:'Gasto',money:true,cells:[{value:10},{value:null},{value:20}]};
  const buckets=[1,2,3].map(i=>({key:String(i),label:String(i),title:String(i)}));
  const graph=ctx.financialSeriesChart(row,buckets);
  assert.equal((graph.match(/<polyline/g)||[]).length,2);
});


test('Nexus uses only mapped accounts, preserves PEN conversion and missing Meta, never daily budget', () => {
  const {ctx} = setup();
  const sources = ctx.LRFinancialSources;
  const platforms = [{name:'Google Ads',period:'01/01/2026 - 30/09/2026',amount:500,monthly:null},
    {name:'Meta Ads',period:'01/01/2026 - 30/09/2026',amount:200,monthly:null}];
  const report = {desde:'2026-11-01',hasta:'2026-11-19',cuentas:[
    {id:'own-google',plataforma:'google',moneda:'USD',coste:268.14,costeConvertido:1005.53,monedaConvertida:'PEN',diario:999},
    {id:'own-meta',plataforma:'meta',moneda:'PEN',coste:91.68},
    {id:'client',plataforma:'google',moneda:'PEN',coste:99999}]};
  const config = {nexusAccounts:{google:['own-google'],meta:['own-meta']}};
  sources.overlay(platforms,2026,{informes:{'2026-11':report,'2026-10':{cuentas:[report.cuentas[0]]}}},config,{});
  const months = ['01','02','03','04','05','06','07','08','09','10','11'].map(n=>({id:'2026-'+n,short:n}));
  const november = platforms.map(p=>sources.investment(p,[months.at(-1)],false).amount);
  assert.equal(november.reduce((a,b)=>a+b,0),1097.21);
  assert.equal(sources.investment(platforms[1],[months[9]],false).amount,null);
  assert.equal(sources.investment(platforms[1],months,true).amount,291.68);
  const days = ctx.financialIndicatorBuckets({months},'2026-11','diario');
  const daily = sources.daily(platforms[0].monthly.get('2026-11'),days);
  assert.equal(daily.reduce((s,c)=>s+Math.round((c.value||0)*100),0),100553);
  assert.ok(daily.slice(19).every(c=>c.value===null));
  assert.ok(daily.slice(0,19).every(c=>c.estimated));
  // Missing FX and duplicate mapped accounts are unknown, not zero or double spend.
  report.cuentas[0].monedaConvertida='USD';
  sources.overlay(platforms,2026,{informes:{'2026-11':report}},config,{});
  assert.equal(platforms[0].monthly.get('2026-11').amount,null);
  report.cuentas.push(report.cuentas[1]);
  sources.overlay(platforms,2026,{informes:{'2026-11':report}},config,{});
  assert.equal(platforms[1].monthly.get('2026-11').amount,null);
});
test('consolidated baseline never overlaps partial reports; full monthly coverage replaces it', () => {
  const {ctx} = setup();
  const p={baseline:{start:'2026-01',end:'2026-02',amount:300},monthly:new Map([['2026-01',{amount:110}],['2026-03',{amount:50}]])};
  const months=['01','02','03'].map(n=>({id:'2026-'+n,short:n}));
  assert.equal(ctx.LRFinancialSources.investment(p,months,true).amount,350);
  p.monthly.set('2026-02',{amount:220});
  assert.equal(ctx.LRFinancialSources.investment(p,months,true).amount,380);
});
test('mother-sheet quotations use exact dates; undated records count only monthly; source wins over CRM', () => {
  const {ctx} = setup();
  const model=ctx.buildFinancialModel({tabs:{ventas:'VENTAS 2026\nFecha,Mes,Facturación\n',inversion:'Plataforma,Periodo,Inversión en PEN\n',resultados:'RESULTADOS 2026\nMes,Cotizaciones,Monto cotizado\nNoviembre,99,1000',cotizaciones:'Fecha,Mes\n03/11/2026,Noviembre\n,Noviembre\n31/02/2026,Febrero'}});
  const view=ctx.financialMonthlyModel(model), period=ctx.financialPeriod(view,'2026-11');
  assert.equal(period.quotes,2);
  assert.equal(model.quoteRecords[2].date,'');
  ctx.quotes=[{fechaEnvio:'2026-11-03'}];
  ctx.commercialData={rows:[{desde:'2026-11-02',hasta:'2026-11-08',cotizaciones:44}]};
  const daily=ctx.financialDailySeries(view,period).series.find(s=>s.key==='cotizaciones');
  assert.equal(daily.total,2);
  assert.equal(daily.cells[2].value,1);
  assert.equal(daily.cells.reduce((s,c)=>s+(c.value||0),0),1);
  ctx.state.financialDailyMetric='cotizaciones';
  assert.match(ctx.financialMonthView(view,period),/1 sin fecha/);
  assert.doesNotMatch(ctx.financialMonthContext(view,period),/Pendiente de integración/);
  assert.throws(()=>ctx.buildFinancialModel({tabs:{cotizaciones:'Fecha,Mes,Contacto\n'}}),/columnas/);
});
