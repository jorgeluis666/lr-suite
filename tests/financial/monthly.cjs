const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const names = ['financialMonthlyModel', 'financialSelectedPeriod', 'financialPeriod', 'groupSalesByService',
  'financialIndicatorBuckets', 'financialIndicatorRows', 'commercialTemplateSegments', 'commercialRows',
  'dayKeyFrom', 'dayCount', 'parseDayKey', 'localDayKey', 'localMonthKey', 'sumarDias', 'monthLabelFor',
  'financialMonthView', 'financialMonthContext', 'metric'];
const functions = names.map(name => {
  const match = html.match(new RegExp(`      function ${name}\\([^]*?^      }`, 'm'));
  assert.ok(match, name);
  return match[0];
}).join('\n');
function setup() {
  const ctx = vm.createContext({
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-12-01T03:00:00Z'])); } },
    state: { financialMonth: '', financialGrain: '' }, quotes: [], commercialData: null,
    financialNotice: '', icons: { download: '', upload: '' },
    SHEET_MONTH_NAMES: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
    SHEET_MONTH_SHORT: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
    normalizeText: value => String(value).toLowerCase(), quoteOrigen: quote => quote.origen,
    fmtMoney: n => `S/ ${n}`, fmtMoneyCents: n => `S/ ${n.toFixed(2)}`, fmtNumber: String,
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
  assert.match(rendered, /Leads del mes<\/h3><span class="financial-month-value">9</);
  assert.doesNotMatch(rendered, />99<|>44</);
  assert.match(rendered, /no es el gasto real/);
  ctx.commercialData = null;
  assert.match(ctx.financialMonthView(view,ctx.financialPeriod(view,'2026-12')), /Sin leads registrados/);
});
test('right context uses the same month and supports missing or zero investment', () => {
  const {ctx, view} = setup();
  const nov = ctx.financialPeriod(view,'2026-11');
  assert.equal(nov.billed, 200); assert.equal(nov.roas, 2); assert.equal(nov.result,100);
  const rendered = ctx.financialMonthContext(nov,null);
  assert.match(rendered,/Noviembre 2026/); assert.match(rendered,/2.00x/);
  view.months[10].investment = 0;
  assert.equal(ctx.financialPeriod(view,'2026-11').roas,null);
  assert.match(ctx.financialMonthContext(ctx.financialPeriod(view,'2026-12'),null),/Diciembre 2026/);
});
module.exports = {setup, functions, html};
