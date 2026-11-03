
const PID="brfsipssqfsuoplxxcth";
const API="https://"+PID+".supabase.co";
const ORIGINS=["https://jorgeluis666.github.io", API];
const reply=(obj,status=200,origin=ORIGINS[0])=>new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":ORIGINS.includes(origin)?origin:ORIGINS[0],"vary":"origin"}});
const group=s=>{const x=String(s||"").toLowerCase();return /retail|comercio|moda|joyer|jewel|minorista|supermercado|fashion|ropa|calzado|tienda|shopping|cosmetic|farmacia|productos de consumo/.test(x)?"retail_ecommerce":/servicio|consult|banco|bank|seguros|finance|finanz|touris|turis|hotel|software|tecnolog|educaci[oó]n|salud|cl[ií]nica|log[ií]stica|marketing|inmobiliaria|telecom|ingenier[ií]a|transporte|publicidad/.test(x)?"servicios_leads":null};
const validWeb=x=>{try{const u=new URL(x);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const qBase="PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX wikibase: <http://wikiba.se/ontology#> PREFIX bd: <http://www.bigdata.com/rdf#> SELECT DISTINCT ?company ?companyLabel ?website ?industryLabel ?ceoLabel WHERE { ?company wdt:P17 wd:Q419 ; wdt:P856 ?website . OPTIONAL { ?company wdt:P452 ?industry . } OPTIONAL { ?company wdt:P169 ?ceo . } SERVICE wikibase:label { bd:serviceParam wikibase:language \"es,en\". } }";

async function authorized(req) {
 const bearer=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S+$/.test(bearer))return false;
 const key=Deno.env.get("SUPABASE_ANON_KEY")||"";
 if(!key)return false;
 const resp=await fetch(API+"/auth/v1/user",{headers:{"apikey":key,"authorization":bearer}});
 if(!resp.ok)return false;const user=await resp.json();
 return !!user.email_confirmed_at&&["jorgeluis@limaretail.com","diegomachuca@limaretail.com"].includes(String(user.email||"").toLowerCase());
}

async function braveSearch(segment, keyword, key, cursor, existing) {
 const base='https://api.search.brave.com/res/v1/web/search';
 async function search(q){
  const u=new URL(base);u.searchParams.set('q',q);u.searchParams.set('country','PE');u.searchParams.set('search_lang','es');u.searchParams.set('count','20');u.searchParams.set('offset',String(Math.floor(cursor/20)%10));u.searchParams.set('result_filter','web');
  const r=await fetch(u,{headers:{'X-Subscription-Token':key,'Accept':'application/json'}});
  if(!r.ok)throw Error('Proveedor de búsqueda HTTP '+r.status);
  const d=await r.json();return d.web?.results||[];
 }
 const query=(segment==='retail_ecommerce'?'Perú tienda online marca retail ecommerce productos':'Perú consultoría empresa servicios B2B captación clientes')+' '+keyword;
 const pages=await search(query);
 const companies=[],seen=new Set(),date=new Date().toISOString().slice(0,10);
 for(const page of pages){
  const pageUrl=validWeb(page.url);if(!pageUrl)continue;
  const u=new URL(pageUrl),h=u.hostname.toLowerCase().replace(/^www\./,'');
  if(/(?:linkedin|facebook|instagram|youtube|google|tiktok|wikipedia|rpp|gestion\.pe|elcomercio|mercadolibre|indeed|computrabajo)/.test(h)||seen.has(h))continue;
  if(!h.includes('.'))continue;seen.add(h);
  const title=String(page.title||'').replace(/<[^>]*>/g,'').split(/\s[|–]\s/)[0].trim().slice(0,180)||h;
  const actualSnippet=String(page.description||'').replace(/<[^>]*>/g,'').trim().slice(0,350);
  const evid=[{ref:'web-discovery',subject:'empresa',dimension:'afinidad',field:'resultado_web',url:pageUrl.replace(/^http:/,'https:'),checked_at:date,fact:('Resultado de búsqueda: '+title+'. '+actualSnippet+' (identidad y actividad por verificar)').slice(0,590)}];
  // No extraer perfiles de LinkedIn desde buscadores de terceros.
  const person=null,relation=null;
  const id=h.replace(/[^a-z0-9.-]/g,'').slice(0,80);
  const identity=normalize(title)+'|'+h;
  if(existing.has(identity))continue;
  existing.add(identity);
  companies.push({external_id:'brave-'+id,company:{name:title,segment,website:pageUrl,linkedin_url:null},person,relation,evidence:evid,assessment:{afinidad:{level:'partial',evidence_refs:['web-discovery']},operacion:{level:'unknown',evidence_refs:[]},canal:{level:'unknown',evidence_refs:[]},publicidad:{level:'unknown',evidence_refs:[]},oportunidad:{level:'unknown',evidence_refs:[]},responsable:{level:person?'partial':'unknown',evidence_refs:person?['web-manager']:[]}}});
  
 }
 return {schema_version:'1.0',source:'brave-public-web',batch_id:'brave-pe-'+date+'-'+segment+'-'+crypto.randomUUID(),candidates:companies,provider:'Brave Search',scanned:pages.length,cursor,next_cursor:(Math.floor(cursor/20)%10>=9||pages.length<20)?0:cursor+20,notice:'Fuente pública de búsqueda web. Los responsables se verifican con evidencias corporativas, no por extracción de LinkedIn.'};
}


const PAGE_SIZE=32;
const normalize=(v)=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ");
const domain=(v)=>{try{return new URL(v).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}};
async function previousCompanies(req){
 const key=Deno.env.get("SUPABASE_ANON_KEY")||"";
 const known=new Set();
 for(let offset=0;offset<20000;offset+=1000){
  const url=API+"/rest/v1/lr_pros_empresas?select=nombre,dominio_normalizado,web&limit=1000&offset="+offset;
  const r=await fetch(url,{
   headers:{apikey:key,authorization:req.headers.get("authorization")||"",accept:"application/json"},
   signal:AbortSignal.timeout(9000)
  });
  if(!r.ok)throw Error("No fue posible leer candidatos existentes para evitar duplicados");
  const rows=await r.json();
  for(const x of rows)known.add(normalize(x.nombre)+"|"+(x.dominio_normalizado||domain(x.web)));
  if(rows.length<1000)return known;
 }
 throw Error("Se alcanzó el límite técnico del inventario; requiere paginación adicional.");
}

Deno.serve(async req=>{
 const origin=req.headers.get("origin")||ORIGINS[0];
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":ORIGINS.includes(origin)?origin:ORIGINS[0],"access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"authorization,apikey,content-type,x-client-info","vary":"origin"}});
 if(req.method==="GET")return reply({ok:true,provider:Deno.env.get("BRAVE_SEARCH_API_KEY")?"Brave Search":"Wikidata",mode:"manual_incremental"},200,origin);
 if(req.method!=="POST")return reply({error:"Método no permitido"},405,origin);
 if(!(await authorized(req)))return reply({error:"Inicia sesión en LR Suite con una cuenta autorizada"},401,origin);
 let body;try{body=await req.json()}catch{return reply({error:"JSON inválido"},400,origin)}
 const segment=body?.segment;
 if(!["retail_ecommerce","servicios_leads"].includes(segment))return reply({error:"Segmento inválido"},400,origin);
 const keyword=String(body?.keyword||"").toLowerCase().slice(0,70);
 const cursor=Number(body?.cursor??0);
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>30000)return reply({error:"Cursor inválido"},400,origin);
 let existing;
 try{existing=await previousCompanies(req)}catch(e){return reply({error:String(e.message||e)},503,origin)}
 const braveKey=Deno.env.get('BRAVE_SEARCH_API_KEY');
 if(braveKey){
  try{return reply(await braveSearch(segment,keyword,braveKey,cursor,existing),200,origin)}
  catch(e){return reply({error:'Fallo el proveedor configurado: '+String(e.message||e).slice(0,160)},503,origin)}
 }
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),16000);
 try {
  const resp=await fetch("https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(qBase+" LIMIT "+PAGE_SIZE+" OFFSET "+cursor),{signal:ctrl.signal,headers:{"accept":"application/sparql-results+json","user-agent":"LR-Suite-Discovery/1.0 (verified business research)"}});
  if(!resp.ok)throw Error("Wikidata respondió "+resp.status);
  const data=await resp.json();const rows=data?.results?.bindings||[];
  const seen=new Set();const candidates=[];const checked_at=new Date().toISOString().slice(0,10);
  for(const row of rows) {
   const wikidataId=String(row.company?.value||"").match(/\/(Q\d+)$/)?.[1],name=String(row.companyLabel?.value||"").trim().slice(0,200),industry=String(row.industryLabel?.value||"").trim().slice(0,180),website=validWeb(row.website?.value);
   if(!wikidataId||!name||/^Q\d+$/.test(name)||!website||seen.has(wikidataId)||group(industry)!==segment)continue;
   if(keyword&&!(name+" "+industry).toLowerCase().includes(keyword))continue;
   seen.add(wikidataId);
   const key=normalize(name)+"|"+domain(website);
   if(existing.has(key))continue;
   existing.add(key);
   const src="https://www.wikidata.org/wiki/"+wikidataId;
   const ceoName=String(row.ceoLabel?.value||"").trim().slice(0,120);
   const manager=ceoName&&!/^Q\d+$/.test(ceoName)?ceoName:null;
   const evidence=[
    {ref:"wd-company",subject:"empresa",dimension:"afinidad",field:"industria_y_país",url:src,checked_at,fact:`Wikidata registra a ${name} como empresa vinculada a Perú, sector: ${industry}; información pendiente de corroborar.`.slice(0,590)},
    {ref:"wd-web",subject:"empresa",dimension:"operacion",field:"sitio_web",url:src,checked_at,fact:`Wikidata vincula a ${name} con un sitio web; su actividad comercial actual no ha sido comprobada.`.slice(0,590)}
   ];
   if(manager)evidence.push({ref:"wd-ceo",subject:"vinculo",dimension:"responsable",field:"cargo",url:src,checked_at,fact:`Wikidata indica a ${manager} como CEO; cargo y vigencia pendientes de corroboración.`.slice(0,590)});
   candidates.push({external_id:"wikidata-"+wikidataId,company:{name,segment,website,linkedin_url:null},person:manager?{first_name:manager,last_name:"",linkedin_url:null}:null,relation:manager?{job_title:"CEO (según Wikidata, por confirmar)",source_url:src,verified_at:null}:null,evidence,assessment:{afinidad:{level:"partial",evidence_refs:["wd-company"]},operacion:{level:"partial",evidence_refs:["wd-web"]},canal:{level:"unknown",evidence_refs:[]},publicidad:{level:"unknown",evidence_refs:[]},oportunidad:{level:"unknown",evidence_refs:[]},responsable:{level:manager?"partial":"unknown",evidence_refs:manager?["wd-ceo"]:[]}}});

  }
  return reply({schema_version:"1.0",source:"wikidata-publico",batch_id:`wd-pe-${checked_at}-${segment}-${crypto.randomUUID()}`,candidates,provider:"Wikidata",scanned:rows.length,cursor,next_cursor:rows.length<PAGE_SIZE?0:cursor+PAGE_SIZE,notice:"Fuente pública limitada. Empresas y cargos deben revisarse; LinkedIn no se extrae automáticamente."},200,origin);
 } catch(e) {
 const msg=e?.name==="AbortError"||e?.name==="TimeoutError"?"Wikidata tardó más de 16 segundos; no avanzamos el barrido. Reintenta más tarde.":"Wikidata: "+String(e.message||e).slice(0,140);
 return reply({error:msg,retryable:true},503,origin);
}finally{clearTimeout(timer)}
});
