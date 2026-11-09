const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
process.env.TZ='America/Lima';
let assertions=0;const ok=(value,message)=>{assert.ok(value,message);assertions++;};
const html=fs.readFileSync(process.argv[2] || 'index.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
for(const script of scripts)new vm.Script(script);
const source=ts.createSourceFile('inline.js',scripts.join('\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const names=['monthLabelFor','monthShortFor','shiftMonthKey','suiteMonthLabels','taskMonthOptions','quoteMonthLabels','quoteMonthTrack','localMonthKey','taskMatchesMonth','taskDateInputValue','quoteMonthKey'];
const found=new Map();function visit(n){if(ts.isFunctionDeclaration(n)&&n.name&&names.includes(n.name.text))found.set(n.name.text,n.getText(source));ts.forEachChild(n,visit);}visit(source);
for(const n of names)assert.ok(found.has(n),n);
function fixedDate(instant){return class extends Date{constructor(...args){super(...(args.length?args:[instant]));}static now(){return new Date(instant).getTime();}};}
for(const instant of ['2026-12-31T23:59:59-05:00','2027-01-01T00:00:00-05:00','2027-01-15T12:00:00-05:00']){
 const expected=instant.slice(0,7),state={taskMonth:expected,quoteMonth:expected,quoteShowAll:false};
 const c=vm.createContext({Date:fixedDate(instant),state,tasks:[],completedTasks:[],quotes:[],SUITE_MONTH_FLOOR:'2026-01',SHEET_MONTH_NAMES:['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],SHEET_MONTH_SHORT:['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']});
 vm.runInContext([...found.values()].join('\n'),c);
 ok(c.taskMonthOptions().some(m=>m[0]===expected),'Pendientes: mes actual disponible');
 ok(c.taskMonthOptions().some(m=>m[0]==='2027-01'),'Pendientes: enero disponible desde diciembre');
 ok(c.quoteMonthTrack().includes(`aria-selected="true" data-quote-month="${expected}"`),'Cotizaciones: mes marcado');
 state.taskMonth='2026-12';ok(c.taskMonthOptions().some(m=>m[0]===state.taskMonth),'Regreso a diciembre');
 state.quoteMonth='2026-12';ok(c.quoteMonthTrack().includes('data-quote-year="2027"'),'Navegación a 2027');
 state.quoteMonth='2027-01';ok(c.quoteMonthTrack().includes('data-quote-year="2026"'),'Regreso a 2026');
 state.quoteMonth='sin-fecha';ok(c.quoteMonthTrack().includes('aria-selected="true" data-quote-month="sin-fecha"'),'Sin fecha');
 const overdue=['t','','2026-12-30','Pendiente','','2026-12-01'];
 if(expected==='2027-01')ok(c.taskMatchesMonth(overdue,expected),'Vencida de diciembre permanece en enero');
}
function loadTs(file,extras={}){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,require,...extras});return exports;}
const months=loadTs('src/modules/seguimiento-cotizaciones/months.ts');
ok(months.currentMonth(new Date('2027-01-01T04:59:59Z'))==='2026-12','Antes de medianoche Lima');
ok(months.currentMonth(new Date('2027-01-01T05:00:00Z'))==='2027-01','Medianoche Lima');
const options=months.quoteMonths(['2026-12','2027-01','2028-04'],new Date('2027-01-15T12:00:00Z'));
ok(options.some(m=>m[0]==='2027-01'&&m[2]==='Enero 2027'),'Etiqueta enero');ok(options.some(m=>m[0]==='2028-04'),'Mes futuro guardado');
const restored=months.restoreMonthlyInputs({'2026-12':{googleAds:100},'2027-01':{metaAds:200},'2028-04':{vendido:300}});
ok(restored['2027-01'].metaAds===200,'Presupuesto enero conservado');ok(restored['2028-04'].vendido===300,'Presupuesto futuro conservado');ok(Object.values(restored).reduce((n,v)=>n+v.googleAds+v.metaAds,0)===300,'Total multianual');
// Render real de la página, con reloj y sesión simulados, sin acceso a la base.
const react=require('react'),server=require('react-dom/server');
for(const selected of ['2027-01','2026-12','sin-fecha']){
 let slot=0;const states=[[], '', selected, '', false, restored, false];
 const page=loadTs('src/app/cotizaciones/page.tsx',{Date:fixedDate('2027-01-15T12:00:00-05:00'),require:id=>id==='react'?{...react,useState:()=>[states[slot++],()=>{}],useEffect:()=>{},useMemo:fn=>fn()}:id.includes('/months')?months:id.includes('supabase/client')?{supabase:{}}:require(id)});
 const rendered=server.renderToStaticMarkup(react.createElement(page.default));
 ok(rendered.includes(`value="${selected}" selected=""`),'Selección renderizada '+selected);ok(rendered.includes('Enero 2027'),'Enero presente en página real');
}
const pendingText=fs.readFileSync('src/modules/lista-pendientes/components/lista-pendientes-module.tsx','utf8');
const pendingAst=ts.createSourceFile('pending.tsx',pendingText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let pendingHelpers='';function pendingVisit(n){if(ts.isFunctionDeclaration(n)&&['monthKeyOf','formatMonthLabel'].includes(n.name?.text))pendingHelpers+=n.getText(pendingAst)+'\n';ts.forEachChild(n,pendingVisit);}pendingVisit(pendingAst);
const pc=vm.createContext({});vm.runInContext(ts.transpileModule(pendingHelpers,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,pc);
ok(pc.monthKeyOf('2027-01-01T04:59:59Z')==='2026-12','Histórico Pendientes: cierre diciembre Lima');
ok(pc.monthKeyOf('2027-01-01T05:00:00Z')==='2027-01','Histórico Pendientes: inicio enero Lima');
ok(pc.formatMonthLabel('2027-01')==='Enero 2027','Histórico Pendientes: etiqueta enero');
console.log(`OK: ${assertions} comprobaciones de diciembre/enero, navegación, fechas sin mes y presupuestos multianuales.`);
