// Análisis de rubros. Las lecturas usan la sesión y las políticas RLS del CRM.
(function(){
'use strict';
const KEY='acrm-rubros-publicidad';
const SOURCE='https://docs.google.com/spreadsheets/d/15co7-JfItz4JN5eBvXc6-gvy-6-aPykVzAKE4FG-39U/edit';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
const missing=v=>['','-','—','n/a','sin rubro','sin dato','sin datos','no especificado','por definir','pendiente'].includes(norm(v));
const rubro=v=>missing(v)?'Sin rubro':String(v).trim().replace(/\s+/g,' ');
const nf=n=>Number(n||0).toLocaleString('es-PE');
const pct=(n,total)=>total?(100*n/total).toLocaleString('es-PE',{maximumFractionDigits:1})+'%':'0%';
const colors=['#2563eb','#0d9488','#7c3aed','#db2777','#ea580c','#0891b2','#65a30d'];
function agrupar(rows){
 const map=new Map();
 for(const row of rows){const label=rubro(row.rubro),key=norm(label),value=Number(row.valor??1);if(!Number.isFinite(value)||value<0)throw Error('Conteo inválido');const x=map.get(key)||{rubro:label,valor:0};x.valor+=value;map.set(key,x);}
 return [...map.values()].sort((a,b)=>b.valor-a.valor||a.rubro.localeCompare(b.rubro,'es'));
}
const domain=v=>String(v||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/?#]/)[0];
function fecha(v){const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v));if(!m)throw Error('Fecha de corte inválida');const iso=`${m[3]}-${m[2]}-${m[1]}`;if(new Date(iso+'T12:00:00Z').toISOString().slice(0,10)!==iso)throw Error('Fecha de corte inválida');return iso;}
// Empresas: B:D (dominio, segmento, rubro); Historial: A:G. Solo se emiten agregados.
// La última fila de cada dominio manda, incluso si ahora figura sin verificar: no se rescata
// una observación antigua como si fuera vigente. Cero verificado es distinto de desconocido.
function publicidad(empresas,historial){
 const companies=new Map();
 for(const row of empresas.slice(1)){const key=domain(row[0]);if(key)companies.set(key,rubro(row[2]));}
 const latest=new Map();
 for(const row of historial.slice(1)){
  const key=domain(row[1]);if(!key)continue;
  const date=fecha(row[0]);
  if(!latest.has(key)||date>=latest.get(key).fecha)latest.set(key,{fila:row,fecha:date});
 }
 const series={ambas:[],google:[],meta:[]},cobertura={empresas:companies.size,verificadas:0,sinVerificar:0,parciales:0,sinAnuncios:0,fueraCatalogo:0};
 const dates=[];
 const valor=(n,estado)=>{
  const state=norm(estado);
  if(state==='sin resultados')return 0;
  if(!['exacto','aproximado'].includes(state)||n==null||String(n).trim()==='')return null;
  const value=Number(n);return Number.isFinite(value)&&value>=0?value:null;
 };
 for(const [key,label] of companies){
  const cut=latest.get(key);
  if(!cut){cobertura.sinVerificar++;continue;}
  dates.push(cut.fecha);
  const g=valor(cut.fila[2],cut.fila[3]),m=valor(cut.fila[5],cut.fila[6]);
  if(g===null&&m===null){cobertura.sinVerificar++;continue;}
  cobertura.verificadas++;
  if(g===null||m===null)cobertura.parciales++;
  if(g>0)series.google.push({rubro:label});
  if(m>0)series.meta.push({rubro:label});
  if(g>0||m>0)series.ambas.push({rubro:label});
  else if(g===0&&m===0)cobertura.sinAnuncios++;
 }
 cobertura.fueraCatalogo=[...latest.keys()].filter(k=>!companies.has(k)).length;
 dates.sort();
 return {version:1,metrica:'anunciantes',fuente:SOURCE,actualizadoEn:new Date().toISOString(),desde:dates[0]||null,hasta:dates.at(-1)||null,cobertura,
  series:Object.fromEntries(Object.entries(series).map(([k,rows])=>[k,{total:rows.length,rubros:agrupar(rows)}]))};
}
async function leerCrm(client,activo=()=>true){
 const rows=[];let total=null;
 do{
  const {data,error,count}=await client.from('lr_acrm_capturas').select('clave,rubro',{count:'exact'}).order('clave').range(rows.length,rows.length+499);
  if(!activo())return null;
  if(error)throw error;
  if(!Array.isArray(data)||!Number.isInteger(count))throw Error('No se pudo verificar el total de leads.');
  if(total!==null&&count!==total)throw Error('El CRM cambió durante la lectura. Pulsa Actualizar para obtener un corte completo.');
  total=count;
  if(!data.length&&rows.length<total)throw Error('La lectura del CRM quedó incompleta. Vuelve a actualizar.');
  rows.push(...data);
 }while(rows.length<total);
 if(rows.length!==total||new Set(rows.map(r=>r.clave)).size!==total)throw Error('El CRM cambió durante la lectura. Vuelve a actualizar.');
 return {total,rubros:agrupar(rows)};
}
function pie(data,unidad){
 if(!data?.total)return '<div class="acrm-rubros-vacio">Sin datos verificados para este gráfico.</div>';
 const known=data.rubros.filter(r=>r.rubro!=='Sin rubro'),unknown=data.rubros.find(r=>r.rubro==='Sin rubro');
 const slices=known.slice(0,7).map((x,i)=>({...x,color:colors[i]}));
 const rest=known.slice(7),others=rest.reduce((s,x)=>s+x.valor,0);
 if(others)slices.push({rubro:'Otros rubros',valor:others,color:'#94a3b8'});
 if(unknown)slices.push({...unknown,color:'#d97706'});
 let angle=-Math.PI/2;
 const paths=slices.map(x=>{
  const end=angle+2*Math.PI*x.valor/data.total;
  const d=`M 110 110 L ${110+100*Math.cos(angle)} ${110+100*Math.sin(angle)} A 100 100 0 ${end-angle>Math.PI?1:0} 1 ${110+100*Math.cos(end)} ${110+100*Math.sin(end)} Z`;
  angle=end;
  const title=esc(`${x.rubro}: ${nf(x.valor)} ${unidad} (${pct(x.valor,data.total)})`);
  return x.valor===data.total?`<circle cx="110" cy="110" r="100" fill="${x.color}"><title>${title}</title></circle>`:`<path d="${d}" fill="${x.color}" stroke="#fff" stroke-width="1"><title>${title}</title></path>`;
 }).join('');
 return `<div class="acrm-rubros-grafico"><svg viewBox="0 0 220 220" role="img" aria-label="Distribución de ${nf(data.total)} ${unidad} por rubro">${paths}</svg><ul class="acrm-rubros-leyenda">${slices.map(x=>`<li><span class="acrm-rubros-color" style="background:${x.color}"></span><span>${esc(x.rubro)}</span><strong>${nf(x.valor)} <small>${pct(x.valor,data.total)}</small></strong></li>`).join('')}</ul></div>${rest.length?`<details class="acrm-rubros-otros"><summary>Ver ${rest.length} rubros agrupados en «Otros»</summary><ul>${rest.map(x=>`<li>${esc(x.rubro)}: ${nf(x.valor)} · ${pct(x.valor,data.total)}</li>`).join('')}</ul></details>`:''}`;
}
let root,client,epoch=0,crm=null,ads=null,errors={},busy=false,loaded=false,plataforma='ambas';
function render(){
 if(!root?.isConnected)return;
 const body=root.querySelector('[data-rubros-body]');
 const missingCount=crm?.rubros.find(x=>x.rubro==='Sin rubro')?.valor||0;
 const chart=ads?.series?.[plataforma];
 body.innerHTML=`<div class="acrm-rubros-bar"><span class="small" role="status">${busy?'Actualizando…':'CRM completo y muestra de prospección publicitaria'}</span><button class="btn" type="button" data-rubros-refresh ${busy?'disabled':''}>Actualizar</button></div>
 <div class="acrm-rubros-grid"><article><h3>Rubros del CRM</h3><p class="small">${crm?nf(crm.total)+' leads · todos los orígenes':'Todos los leads, independientemente del filtro de la tabla'}</p>
 ${errors.crm?`<p class="acrm-rubros-error" role="alert">${esc(errors.crm)}</p>`:''}
 ${pie(crm,'leads')}<p class="acrm-rubros-faltantes">${crm?`<strong>${nf(missingCount)} sin rubro · ${pct(missingCount,crm.total)}</strong><br>Leads pendientes de enriquecimiento.`:'Los rubros vacíos se mostrarán como «Sin rubro».'}</p></article>
 <article><div class="acrm-rubros-titulo"><h3>Anunciantes por rubro</h3><label>Plataforma <select data-rubros-plataforma aria-label="Plataforma publicitaria">${[['ambas','Google + Meta'],['google','Google'],['meta','Meta']].map(([k,v])=>`<option value="${k}" ${k===plataforma?'selected':''}>${v}</option>`).join('')}</select></label></div>
 <p class="small">${chart?nf(chart.total)+' anunciantes únicos en la muestra':'Muestra de anunciantes de Google y Meta'}. Volumen de anunciantes, no inversión.</p>
 ${errors.ads?`<p class="acrm-rubros-error" role="alert">${esc(errors.ads)}</p>`:''}${pie(chart,'anunciantes')}
 ${ads?`<p class="small">Cortes: ${esc(ads.desde)} a ${esc(ads.hasta)} · Perú.<br>${nf(ads.cobertura.empresas)} empresas en la muestra; ${nf(ads.cobertura.sinVerificar)} sin verificación y ${nf(ads.cobertura.parciales)} con verificación parcial.</p>`:''}
 <p class="small"><a href="${SOURCE}" target="_blank" rel="noopener noreferrer">Ver hoja de prospección ↗</a></p>
 <details class="acrm-rubros-otros"><summary>Cómo se cuenta</summary><p class="small">Una empresa por dominio, usando su último corte. Google: anuncios de los últimos 30 días; Meta: anuncios activos al revisar. Google + Meta cuenta una vez a cada empresa con anuncios confirmados en al menos una plataforma. Los casos sin verificación no se consideran cero. Esta muestra sirve para priorizar la prospección; no representa todo el mercado. Actualizar relee el CRM y el último corte importado de la hoja; no realiza un barrido nuevo de anuncios.</p></details></article></div>`;
 body.querySelector('[data-rubros-refresh]').onclick=()=>load();
 body.querySelector('[data-rubros-plataforma]').onchange=e=>{plataforma=e.target.value;render();};
}
async function load(){
 if(busy||!root?.isConnected)return;
 if(!client){errors={crm:'Inicia sesión para consultar los rubros.',ads:'Inicia sesión para consultar la muestra.'};render();return;}
 busy=true;errors={};render();const generation=epoch,active=client;
 const results=await Promise.allSettled([
  leerCrm(active,()=>epoch===generation),
  active.from('lr_suite_private_data').select('payload').eq('key',KEY).maybeSingle().then(r=>{if(r.error)throw r.error;if(!r.data?.payload)throw Error('Todavía no se ha importado un corte publicitario.');const p=r.data.payload;if(p.version!==1||p.metrica!=='anunciantes'||!p.series?.ambas)throw Error('El corte publicitario no es válido.');return p;})
 ]);
 if(epoch!==generation)return;
 if(results[0].status==='fulfilled')crm=results[0].value;else errors.crm='No se pudo actualizar el CRM: '+results[0].reason.message;
 if(results[1].status==='fulfilled')ads=results[1].value;else errors.ads='No se pudo actualizar la muestra: '+results[1].reason.message;
 loaded=true;busy=false;render();
}
function unmount(){epoch++;root=null;client=null;busy=false;loaded=false;crm=null;ads=null;errors={};}
function mount(element,db){unmount();root=element;client=db;if(!root)return;root.ontoggle=()=>{if(root.open&&!loaded)void load();};if(root.open)void load();}
window.LRACRMRubros={mount,unmount,leerCrm,agrupar,publicidad,pie,KEY};
})();
