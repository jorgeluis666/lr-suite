import {createClient} from "npm:@supabase/supabase-js@2.105.3";
import {parseEvents,validSignature} from "./payload.ts";
Deno.serve(async req=>{
 const secret=Deno.env.get("META_APP_SECRET"),verify=Deno.env.get("WHATSAPP_VERIFY_TOKEN"),phone=Deno.env.get("WHATSAPP_PHONE_ID");
 if(!secret||!verify||!phone)return new Response("Webhook sin configurar",{status:503});
 if(req.method==="GET"){
  const q=new URL(req.url).searchParams;
  return q.get("hub.mode")==="subscribe"&&q.get("hub.verify_token")===verify?new Response(q.get("hub.challenge")||""):new Response("No autorizado",{status:403});
 }
 if(req.method!=="POST")return new Response("Método no permitido",{status:405});
 if(Number(req.headers.get("content-length"))>1000000)return new Response("Payload grande",{status:413});
 const body=await req.text();
 if(body.length>1000000)return new Response("Payload grande",{status:413});
 if(!await validSignature(body,req.headers.get("x-hub-signature-256"),secret))return new Response("Firma inválida",{status:403});
 let events;
 try{events=parseEvents(JSON.parse(body),phone);}catch{return new Response("Payload inválido",{status:400});}
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 // Only durable ingestion before 200; no model call or outbound message on this path.
 // If persistence fails, return 503 so Meta retries; message IDs make retries idempotent.
 const results=await Promise.all(events.map(e=>db.rpc("lr_acrm_recibir_meta",{p_evento:e}).abortSignal(AbortSignal.timeout(1800))));
 if(results.some(r=>r.error))return new Response("Reintentar",{status:503});
 return new Response("ok");
});
