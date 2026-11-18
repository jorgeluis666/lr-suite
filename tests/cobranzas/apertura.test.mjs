import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../../supabase/functions/cobranzas-apertura/handler.mjs';

test('señal pública registra solo la primera apertura y responde siempre con la misma imagen', async () => {
  const calls=[];
  const handler=createHandler({url:'https://example.test',serviceKey:'secret-test',now:()=>new Date('2026-11-18T12:00:00Z'),
    fetchImpl:async (...args)=>{calls.push(args);return new Response(null,{status:204});}});
  const token=crypto.randomUUID();
  const good=await handler(new Request(`https://example.test/pixel?token=${token}`,{headers:{'user-agent':'No guardar','x-forwarded-for':'127.0.0.1'}}));
  assert.equal(good.status,200);
  assert.equal(good.headers.get('Content-Type'),'image/gif');
  assert.match(good.headers.get('Cache-Control'),/no-store/);
  assert.equal(calls.length,1);
  assert.match(calls[0][0],/primera_apertura=is.null/);
  assert.deepEqual(JSON.parse(calls[0][1].body),{primera_apertura:'2026-11-18T12:00:00.000Z'});
  const invalid=await handler(new Request('https://example.test/pixel?token=abc'));
  assert.equal(calls.length,1);
  assert.deepEqual(await invalid.arrayBuffer(),await good.arrayBuffer());
  assert.equal((await handler(new Request('https://example.test/pixel',{method:'POST'}))).status,405);
});
