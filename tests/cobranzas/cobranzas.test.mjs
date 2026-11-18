import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {enviarContacto, REMITENTE, ASUNTO, MENSAJE, main, configurarSeguimiento} from '../../scripts/correo/cobranzas.mjs';
const sql = readFileSync(new URL('../../src/modules/cobranzas/BBDD/cobranzas.sql', import.meta.url),'utf8');
let db, adapter, dia;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create function public.is_lr_suite_pending_user() returns boolean language sql stable
    as $$ select current_setting('test.autorizado', true) = 'si' $$;`);
  await db.exec(sql);
  // La instalación puede repetirse sin perder datos ni fallar por políticas existentes.
  await db.exec(sql);
  adapter = {query: async (q,p) => {const r = await db.query(q,p); return {...r,rowCount:r.affectedRows};}};
  dia = (await db.query("select to_char(now() at time zone 'America/Lima','YYYY-MM-DD') as dia")).rows[0].dia;
});
after(async () => { await db.close(); });
async function contact(nombre = 'Prueba') {
  return (await db.query(`insert into public.lr_suite_cobranzas(nombre,email,empresa)
    values ($1, $2, 'Empresa de prueba') returning id`, [nombre, `${crypto.randomUUID()}@example.test`])).rows[0].id;
}
test('solo los tres datos de contacto son obligatorios; valida email y duplicados', async () => {
  const id = await contact();
  const {rows:[row]} = await db.query('select * from public.lr_suite_cobranzas where id=$1',[id]);
  assert.equal(row.estado,'pendiente');
  assert.equal(row.ultimo_intento,null);
  await assert.rejects(db.query('insert into public.lr_suite_cobranzas(nombre,email,empresa) values ($1,$2,$3)', ['A',row.email.toUpperCase(),' EMPRESA DE PRUEBA ']));
  for (const email of ['bad', 'uno@example.test,dos@example.test', 'uno@example.test\r\nBcc:other@example.test']) {
    await assert.rejects(db.query("insert into public.lr_suite_cobranzas(nombre,email,empresa) values ('A',$1,'B')",[email]));
  }
});
test('RLS impide lectura anónima, lectura ajena y falsificación del envío', async () => {
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.lr_suite_cobranzas'));
  await db.exec("reset role; set role authenticated; set test.autorizado='no'");
  assert.equal((await db.query('select * from public.lr_suite_cobranzas')).rows.length,0);
  await assert.rejects(contact());
  await db.exec("set test.autorizado='si'");
  const id = await contact();
  await db.query("update public.lr_suite_cobranzas set estado='completado' where id=$1",[id]);
  await assert.rejects(db.query('update public.lr_suite_cobranzas set ultimo_intento=current_date where id=$1',[id]));
  await db.exec('reset role');
});
test('envía individualmente la plantilla exacta y evita repetir el mismo día', async () => {
  const id = await contact();
  const mails = [];
  const smtp = {sendMail:async mail => {mails.push(mail); return {accepted:[mail.to.address],rejected:[]};}};
  assert.equal(await enviarContacto(adapter,smtp,id,dia),'enviado');
  assert.equal(await enviarContacto(adapter,smtp,id,dia),'omitido');
  assert.equal(mails.length,1);
  assert.equal(mails[0].from,'cobros@limaretail.com');
  assert.equal(mails[0].replyTo,REMITENTE);
  assert.equal(mails[0].subject,'Aviso de saldo pendiente de regularización - Lima Retail');
  assert.equal(mails[0].text,MENSAJE);
  assert.match(MENSAJE,/^Estimados,\n\nNos ponemos en contacto/);
  assert.match(MENSAJE,/Quedamos atentos a su respuesta\. Área de Cobranzas - Agencia Lima Retail\.$/);
  assert.equal(mails[0].bcc,undefined);
  assert.ok((await db.query('select ultimo_envio from public.lr_suite_cobranzas where id=$1',[id])).rows[0].ultimo_envio);
});
test('omite pagos completados y vuelve a comprobar el estado tras reservar', async () => {
  const smtp = {sendMail:async () => {assert.fail('No debe enviar a un contacto pagado');}};
  const id = await contact();
  await db.query("update public.lr_suite_cobranzas set estado='completado' where id=$1",[id]);
  assert.equal(await enviarContacto(adapter,smtp,id,dia),'omitido');
  const otro = await contact();
  const intercalado = {query:async(q,p) => {
    const result = await adapter.query(q,p);
    if (q.includes('returning id')) await db.query("update public.lr_suite_cobranzas set estado='completado' where id=$1",[otro]);
    return result;
  }};
  assert.equal(await enviarContacto(intercalado,smtp,otro,dia),'omitido');
});
test('error SMTP conserva reserva del día y no confirma entrega; mañana vuelve a ser elegible', async () => {
  const id = await contact();
  const smtp = {sendMail:async () => {throw new Error('Timeout ambiguo');}};
  await assert.rejects(enviarContacto(adapter,smtp,id,dia), /Timeout/);
  assert.equal(await enviarContacto(adapter,smtp,id,dia),'omitido');
  assert.equal((await db.query('select ultimo_envio from public.lr_suite_cobranzas where id=$1',[id])).rows[0].ultimo_envio,null);
  await db.query('update public.lr_suite_cobranzas set ultimo_intento=$2::date - 1 where id=$1',[id,dia]);
  await db.query('update public.lr_suite_cobranzas_envios set dia=$2::date - 1 where contacto_id=$1',[id,dia]);
  assert.equal(await enviarContacto(adapter,{sendMail:async()=>({accepted:['test'],rejected:[]})},id,dia),'enviado');
});
test('rechazo SMTP no se registra como envío exitoso', async () => {
  const id = await contact();
  await assert.rejects(enviarContacto(adapter,{sendMail:async()=>({accepted:[],rejected:['test']})},id,dia));
  assert.equal((await db.query('select ultimo_envio from public.lr_suite_cobranzas where id=$1',[id])).rows[0].ultimo_envio,null);
});
test('falla antes de conectar cuando faltan secretos', async () => {
  await assert.rejects(main({DRY_RUN:'false'}),/Faltan secretos: COBRANZAS_DATABASE_URL/);
});

test('interfaz registra solo tres campos, escapa HTML y detiene recordatorios', async () => {
  const dom = new JSDOM('<div id="root"></div>', {runScripts:'outside-only',url:'https://example.test'});
  dom.window.eval(readFileSync(new URL('../../src/modules/cobranzas/cobranzas.js',import.meta.url),'utf8'));
  const rows = [], writes = [];
  const client = {from: () => ({
    select: () => ({order: () => ({range:async () => ({data:rows,error:null})})}),
    insert:async data => {writes.push(data); rows.push({...data,id:'contact-1',estado:'pendiente'}); return {error:null};},
    update: data => ({eq: (_key,id) => ({select:async () => {Object.assign(rows.find(r=>r.id===id),data); return {data:[{id}],error:null};}})}),
  })};
  const container = dom.window.document.querySelector('#root');
  dom.window.LRCobranzas.mount(container,client);
  const settle = () => new Promise(resolve=>setTimeout(resolve,0));
  await settle();
  const form = container.querySelector('form');
  assert.deepEqual([...form.querySelectorAll('input')].map(e=>e.name),['nombre','email','empresa']);
  form.elements.nombre.value='<img src=x onerror=alert(1)>';
  form.elements.email.value='persona@example.test';
  form.elements.empresa.value='Empresa';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await settle();
  assert.deepEqual(Object.keys(writes[0]),['nombre','email','empresa']);
  assert.equal(container.querySelectorAll('img').length,0);
  container.querySelector('[data-complete]').click();
  await settle();
  assert.equal(rows[0].estado,'completado');
  assert.equal(container.querySelector('[data-complete]'),null);
  assert.match(container.textContent,/envíos detenidos/);
  dom.window.close();
});

test('historial guarda el rechazo, pausa el cobro y no expone tokens al equipo', async () => {
  const id = await contact();
  const smtp = {sendMail:async()=>{throw Object.assign(new Error('Rechazado'),{responseCode:550});}};
  await assert.rejects(enviarContacto(adapter,smtp,id,dia));
  const row = (await db.query('select estado,codigo_smtp from public.lr_suite_cobranzas_envios where contacto_id=$1',[id])).rows[0];
  assert.equal(row.estado,'rechazado');
  assert.equal(row.codigo_smtp,550);
  assert.equal((await db.query('select seguimiento_pausado from public.lr_suite_cobranzas where id=$1',[id])).rows[0].seguimiento_pausado,true);
  await db.exec("set role authenticated; set test.autorizado='si'");
  assert.equal((await db.query('select estado from public.lr_suite_cobranzas_envios where contacto_id=$1',[id])).rows.length,1);
  await assert.rejects(db.query('select token_apertura from public.lr_suite_cobranzas_envios'));
  await assert.rejects(db.query("update public.lr_suite_cobranzas_envios set estado='aceptado_smtp'"));
  await db.exec('reset role');
});

test('pixel usa token opaco y guarda el remitente autorizado sin cambiar el mensaje', async () => {
  const id = await contact(); let mail;
  await enviarContacto(adapter,{sendMail:async value=>{mail=value;return {accepted:['test']};}},id,dia,
    {remitente:'seguimiento@limaretail.com',trackingUrl:'https://example.test/functions/v1/cobranzas-apertura'});
  assert.equal(mail.from,'seguimiento@limaretail.com');
  assert.equal(mail.text,MENSAJE);
  assert.match(mail.html,/https:\/\/example.test\/functions\/v1\/cobranzas-apertura\?token=[0-9a-f-]+/);
  const row=(await db.query('select * from public.lr_suite_cobranzas_envios where contacto_id=$1',[id])).rows[0];
  assert.equal(row.remitente,'seguimiento@limaretail.com');
  assert.equal(row.seguimiento_apertura,true);
  assert.equal(row.primera_apertura,null);
  assert.equal(row.estado,'aceptado_smtp');
  assert.throws(()=>configurarSeguimiento({COBRANZAS_REMITENTE:'a@example.test'}));
  assert.throws(()=>configurarSeguimiento({COBRANZAS_TRACKING_URL:'http://example.test'}));
});
