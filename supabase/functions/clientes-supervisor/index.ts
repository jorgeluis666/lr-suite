import Anthropic from '@anthropic-ai/sdk';
import {createClient} from '@supabase/supabase-js';
import {secreto} from '../_shared/base.ts';
import {registrarUso} from '../_shared/uso.ts';
import {contextoDe} from '../_shared/recursos.ts';
import {PRECIOS} from '../_shared/precios.ts';
import {createHandler} from './handler.mjs';

Deno.serve(createHandler({
 cors:{'access-control-allow-origin':Deno.env.get('PANEL_ORIGEN') || 'https://suite.limaretail.com',
  'access-control-allow-headers':'authorization,content-type,apikey','access-control-allow-methods':'POST,OPTIONS'},
 async authorize(request:Request) {
  const authorization=request.headers.get('authorization') || '';
  if(!authorization.toLowerCase().startsWith('bearer '))return null;
  const client=createClient(secreto('SUPABASE_URL'),secreto('SUPABASE_ANON_KEY'),{
   auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
  const {data,error}=await client.auth.getUser();
  if(error || !data.user?.email)return null;
  return {client,email:data.user.email};
 },
 async read(user:any,key:string) {
  // RLS on the existing private store enforces membership. Empty SELECT is NOT authorization.
  const {data,error}=await user.client.from('lr_suite_private_data').select('payload,updated_at').eq('key','cliente-ingreso:'+key).maybeSingle();
  if(error)throw new Error('read');return data;
 },
 async agent(user:any) {
  const {data,error}=await user.client.rpc('lr_suite_agente_ficha',{p_clave:'supervisor',p_dias:7});
  if(error)throw new Error('catalog');return data?.agente;
 },
 async analyze(model:string,system:string,context:string) {
  // Existing price catalog only: unknown models must not silently use an estimated tariff.
  if(!Object.hasOwn(PRECIOS,model))throw new Error('unsupported model');
  const resources=(await contextoDe('supervisor')).slice(0,8000);
  const result=await new Anthropic({apiKey:secreto('ANTHROPIC_API_KEY'),maxRetries:0,timeout:45000}).messages.create({
   model,max_tokens:1200,system:system+'\n\n'+resources,messages:[{role:'user',content:context}]});
  return {usage:result.usage,text:result.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')};
 },
 async usage(user:any,key:string,model:string,usage:any) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  const ref=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
  return await registrarUso('supervisor',{modelo:model,usuario:user.email,usage,llamada:'ingreso-'+ref});
 }
}));
