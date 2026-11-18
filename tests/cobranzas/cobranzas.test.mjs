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
  assert.equal(mails[0].from,'administracion@limaretail.com');
  assert.equal(mails[0].replyTo,REMITENTE);
  assert.equal(mails[0].subject,'Aviso de saldo pendiente de regularización - Lima Retail');
  assert.equal(mails[0].text,MENSAJE);
  assert.match(MENSAJE,/^Estimados,\n\nNos ponemos en contacto/);
  // La firma acordada, con los saltos sueltos y la web enlazada en el HTML.
  assert.match(MENSAJE,/Quedamos atentos a su respuesta\.\n\nAdministración & Contabilidad\nWork: 937 409 733\nwww\.limaretail\.com$/);
  assert.equal(mails[0].html.endsWith('<p>Administración &amp; Contabilidad<br>Work: 937 409 733<br><a href="https://www.limaretail.com">www.limaretail.com</a></p>'),true);
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
  const mensaje = {asunto:'Aviso guardado',cuerpo:'Texto guardado',actualizado_en:'2026-11-18T12:00:00Z'};
  const client = {from: (tabla) => tabla === 'lr_suite_cobranzas_mensaje' ? {
    select: () => ({limit:async () => ({data:[mensaje],error:null})}),
    update: data => ({eq: () => ({select:async () => {Object.assign(mensaje,data); return {data:[{actualizado_en:'2026-11-18T13:00:00Z'}],error:null};}})}),
  } : {
    select: () => ({order: () => ({range:async () => ({data:rows,error:null})})}),
    insert:async data => {writes.push(data); rows.push({...data,id:'contact-1',estado:'pendiente'}); return {error:null};},
    update: data => ({eq: (_key,id) => ({select:async () => {Object.assign(rows.find(r=>r.id===id),data); return {data:[{id}],error:null};}})}),
  }};
  const container = dom.window.document.querySelector('#root');
  dom.window.LRCobranzas.mount(container,client);
  const settle = () => new Promise(resolve=>setTimeout(resolve,0));
  await settle();
  await settle();
  const form = container.querySelector('.cobranzas-form');
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

test('la siembra del SQL es el mismo texto del script de envío', async () => {
  const {rows:[fila]} = await db.query('select asunto, cuerpo from public.lr_suite_cobranzas_mensaje where id = 1');
  assert.equal(fila.asunto, ASUNTO);
  assert.equal(fila.cuerpo, MENSAJE);
});

test('el aviso editado en la base es el que se envía', async () => {
  const id = await contact();
  await db.query("update public.lr_suite_cobranzas_mensaje set asunto = $1, cuerpo = $2 where id = 1",
    ['Asunto editado', 'Párrafo uno <b>no</b>\n\nFirma\nwww.limaretail.com/pagos?x=1']);
  let mail;
  assert.equal(await enviarContacto(adapter,{sendMail:async v=>{mail=v;return {accepted:['test'],rejected:[]};}},id,dia),'enviado');
  assert.equal(mail.subject,'Asunto editado');
  assert.equal(mail.text,'Párrafo uno <b>no</b>\n\nFirma\nwww.limaretail.com/pagos?x=1');
  // El texto se escapa antes de enlazar: lo editado no puede inyectar HTML en el correo.
  assert.equal(mail.html,'<p>Párrafo uno &lt;b&gt;no&lt;/b&gt;</p><p>Firma<br><a href="https://www.limaretail.com/pagos?x=1">www.limaretail.com/pagos?x=1</a></p>');
  await db.query('update public.lr_suite_cobranzas_mensaje set asunto = $1, cuerpo = $2 where id = 1',[ASUNTO,MENSAJE]);
});

test('el mensaje solo lo cambia el equipo autorizado y la fecha la pone la base', async () => {
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.lr_suite_cobranzas_mensaje'));
  await db.exec("reset role; set role authenticated; set test.autorizado='no'");
  assert.equal((await db.query('select * from public.lr_suite_cobranzas_mensaje')).rows.length,0);
  await db.exec("set test.autorizado='si'");
  await assert.rejects(db.query('update public.lr_suite_cobranzas_mensaje set actualizado_en = now() where id = 1'));
  await assert.rejects(db.query("insert into public.lr_suite_cobranzas_mensaje(id,asunto,cuerpo) values (2,'a','b')"));
  await db.query("update public.lr_suite_cobranzas_mensaje set cuerpo = 'Texto del equipo' where id = 1");
  await db.exec('reset role');
  const {rows:[fila]} = await db.query('select cuerpo, actualizado_en from public.lr_suite_cobranzas_mensaje where id = 1');
  assert.equal(fila.cuerpo,'Texto del equipo');
  assert.ok(fila.actualizado_en);
  await db.query('update public.lr_suite_cobranzas_mensaje set cuerpo = $1 where id = 1',[MENSAJE]);
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

test('la interfaz muestra el mensaje guardado, lo deja editar y no guarda vacíos', async () => {
  const dom = new JSDOM('<div id="root"></div>', {runScripts:'outside-only',url:'https://example.test'});
  dom.window.eval(readFileSync(new URL('../../src/modules/cobranzas/cobranzas.js',import.meta.url),'utf8'));
  const mensaje = {asunto:'Asunto guardado',cuerpo:'Cuerpo guardado',actualizado_en:'2026-11-18T12:00:00Z'};
  const guardados = [];
  const client = {from: tabla => tabla === 'lr_suite_cobranzas_mensaje' ? {
    select: () => ({limit:async () => ({data:[mensaje],error:null})}),
    update: data => ({eq: () => ({select:async () => {guardados.push(data); return {data:[{actualizado_en:'2026-11-18T13:00:00Z'}],error:null};}})}),
  } : {select: () => ({order: () => ({range:async () => ({data:[],error:null})})})}};
  const container = dom.window.document.querySelector('#root');
  dom.window.LRCobranzas.mount(container,client);
  const settle = () => new Promise(resolve=>setTimeout(resolve,0));
  await settle();
  await settle();
  const editor = container.querySelector('[data-plantilla]');
  assert.equal(editor.elements.asunto.value,'Asunto guardado');
  assert.equal(editor.elements.cuerpo.value,'Cuerpo guardado');
  editor.elements.asunto.value = '  Asunto nuevo  ';
  editor.elements.cuerpo.value = 'Párrafo\n\nFirma\nSegunda línea';
  editor.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await settle();
  // Objetos creados dentro de jsdom: se comparan campo a campo, no con deepStrictEqual.
  assert.equal(guardados.length,1);
  assert.equal(guardados[0].asunto,'Asunto nuevo');
  assert.equal(guardados[0].cuerpo,'Párrafo\n\nFirma\nSegunda línea');
  assert.match(container.querySelector('[data-plantilla-estado]').textContent,/^Guardado/);
  editor.elements.cuerpo.value = '   ';
  editor.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await settle();
  assert.equal(guardados.length,1);
  assert.match(container.querySelector('[data-plantilla-estado]').textContent,/no pueden quedar vacíos/);
  dom.window.close();
});

test('sin la tabla del mensaje el editor queda bloqueado y el resto del módulo sigue vivo', async () => {
  const dom = new JSDOM('<div id="root"></div>', {runScripts:'outside-only',url:'https://example.test'});
  dom.window.eval(readFileSync(new URL('../../src/modules/cobranzas/cobranzas.js',import.meta.url),'utf8'));
  const intentos = [];
  const client = {from: tabla => tabla === 'lr_suite_cobranzas_mensaje' ? {
    select: () => ({limit:async () => ({data:null,error:{code:'42P01',message:'relation does not exist'}})}),
    update: data => ({eq: () => ({select:async () => {intentos.push(data); return {data:[{}],error:null};}})}),
  } : {select: () => ({order: () => ({range:async () => ({data:[],error:null})})})}};
  const container = dom.window.document.querySelector('#root');
  dom.window.LRCobranzas.mount(container,client);
  const settle = () => new Promise(resolve=>setTimeout(resolve,0));
  await settle();
  await settle();
  const editor = container.querySelector('[data-plantilla]');
  assert.equal(editor.elements.cuerpo.disabled,true);
  // operation() rehabilita los botones al terminar: el de guardar no puede volver solo.
  assert.equal(editor.querySelector('button').disabled,true);
  assert.match(container.querySelector('[data-plantilla-estado]').textContent,/instalación de su base de datos/);
  editor.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await settle();
  assert.deepEqual(intentos,[]);
  // El alta de contactos no se ve afectada por el fallo del editor.
  assert.equal(container.querySelector('.cobranzas-form button').disabled,false);
  assert.match(container.textContent,/No hay contactos registrados/);
  dom.window.close();
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
