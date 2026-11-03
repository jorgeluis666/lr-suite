// LR Suite · Endpoint anterior desactivado.
// Las capturas nuevas se registran desde Prospección > LinkedIn Perú.
const origins=["https://jorgeluis666.github.io","https://brfsipssqfsuoplxxcth.supabase.co"];
Deno.serve(req=>{
 const origin=req.headers.get("origin")||origins[0];
 const headers={"access-control-allow-origin":origins.includes(origin)?origin:origins[0],
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"authorization,apikey,content-type,x-client-info","vary":"origin"};
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 const get=req.method==="GET";
 return new Response(JSON.stringify({
  ok:get,disabled:true,source:"linkedin_peru_user_reviewed",
  message:"Búsqueda anterior retirada. Inicia captura de perfiles LinkedIn Perú desde la interfaz de LR Suite."
 }),{status:get?200:410,headers:{...headers,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
});