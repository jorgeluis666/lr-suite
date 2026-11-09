export async function validSignature(body:string,header:string|null,secret:string){
 if(!/^sha256=[a-f0-9]{64}$/.test(header||""))return false;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body)));
 const expected="sha256="+Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^header!.charCodeAt(i);
 return diff===0;
}
export function parseEvents(payload:any,phoneId:string){
 const events:Array<{id:string,phone_id:string,telefono:string,nombre:string,fecha:string,consulta:string,anuncio_id:string|null}>=[];
 if(payload?.object!=="whatsapp_business_account")return events;
 for(const entry of payload.entry||[])for(const change of entry.changes||[]){
  const v=change.value;
  if(change.field!=="messages"||String(v?.metadata?.phone_number_id)!==phoneId)continue;
  for(const m of v.messages||[]){
   if(!/^\d{7,20}$/.test(String(m.from))||typeof m.id!=="string"||!Number.isFinite(Number(m.timestamp)))throw Error("Mensaje inválido");
   const name=(v.contacts||[]).find((c:any)=>c.wa_id===m.from)?.profile?.name||"Lead WhatsApp";
   events.push({id:m.id,phone_id:phoneId,telefono:String(m.from),nombre:String(name).slice(0,300),
    fecha:new Date(Number(m.timestamp)*1000).toISOString(),consulta:String(m.text?.body||m.button?.text||m.interactive?.button_reply?.title||m.interactive?.list_reply?.title||`Mensaje ${m.type||'adjunto'}`).slice(0,2000),
    anuncio_id:m.referral?.source_type==="ad"?String(m.referral.source_id||""):null});
  }
 }
 if(events.length>100)throw Error("Demasiados eventos");
 return events;
}
