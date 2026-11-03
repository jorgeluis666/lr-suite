// NODE_PATH=/tmp/pros-validation/node_modules node scripts/prospeccion/seguimiento.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {JSDOM}=require('jsdom');
const sql=fs.readFileSync('src/modules/prospeccion/BBDD/prospeccion-seguimiento-v1.sql','utf8');
const source=fs.readFileSync('src/modules/prospeccion/contactos-propios.js','utf8');
const uid='00000000-0000-0000-0000-000000000001';
test('SQL: permisos, persistencia compartida, idempotencia y validación de fuente',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 INSERT INTO auth.users VALUES ('${uid}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE FUNCTION public.lr_pros_usuario_habilitado() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()='${uid}'::uuid,false) $$;
 CREATE TABLE lr_pros_colaboradores(usuario_id uuid,activo boolean);
 INSERT INTO lr_pros_colaboradores VALUES ('${uid}',true);
 CREATE TABLE lr_pros_contactos_propios(id uuid,usuario_id uuid,linkedin_url text,clave text);
 INSERT INTO lr_pros_contactos_propios VALUES ('${uid}','${uid}','https://www.linkedin.com/in/ana','li:https://www.linkedin.com/in/ana');
 CREATE VIEW lr_pros_contactos_unificados AS SELECT id,'Ana'::text nombre,'Rivas'::text apellido,'Acme'::text empresa FROM lr_pros_contactos_propios;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 GRANT SELECT ON lr_pros_contactos_propios,lr_pros_contactos_unificados TO authenticated;`);
 await db.exec(sql);await db.exec(sql); // El nuevo script admite una segunda ejecución.
 await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid','${uid}',false);`);
 const identity='li:https://www.linkedin.com/in/ana';
 const ficha={segmento:'ecommerce',trabajadores:25,fuente:'Directorio de la empresa',verificado_en:'2026-01-01',estado:'por_contactar',proximo_contacto:'2026-01-10'};
 await db.query('SELECT lr_pros_guardar_seguimiento($1,$2::jsonb)',[identity,JSON.stringify(ficha)]);
 const mensaje={id:'00000000-0000-0000-0000-000000000009',enviado_en:'2026-01-02',canal:'linkedin',tema:'Presentación'};
 for(let i=0;i<2;i++)await db.query('SELECT lr_pros_guardar_seguimiento($1,NULL,$2::jsonb)',[identity,JSON.stringify(mensaje)]);
 let rows=(await db.query('SELECT * FROM lr_pros_seguimiento')).rows;
 assert.equal(rows[0].mensajes_enviados,1);assert.equal(rows[0].estado,'contactado');assert.equal(rows[0].trabajadores,25);
 await assert.rejects(db.query('SELECT lr_pros_guardar_seguimiento($1,$2::jsonb)',[identity,JSON.stringify({...ficha,fuente:''})]));
 await assert.rejects(db.exec("INSERT INTO lr_pros_fichas(identidad) VALUES ('forged')"));
 await db.exec("SELECT set_config('test.uid','00000000-0000-0000-0000-000000000002',false)");
 assert.equal((await db.query('SELECT * FROM lr_pros_mensajes')).rows.length,0);
 await assert.rejects(db.query('SELECT lr_pros_guardar_seguimiento($1,$2::jsonb)',[identity,JSON.stringify(ficha)]));
 await db.exec('RESET ROLE; SET ROLE anon');
 await assert.rejects(db.exec('SELECT * FROM lr_pros_seguimiento'));
 }finally{await db.close();}
});
test('UI: filtros de servidor, apertura, validación y registro de mensajes',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only',url:'https://example.test'});
 const w=dom.window,root=w.document.querySelector('#root'),calls=[],writes=[];
 const contact={id:uid,identidad:'li:test',nombre:'Ana',apellido:'Rivas',empresa:'Acme',segmento:'ecommerce',estado:'por_contactar',trabajadores:null};
 let history=[];
 const client={from(table){const q={select(){return q},order(){return q},eq(...a){calls.push(['eq',...a]);return q},in(...a){calls.push(['in',...a]);return q},lte(...a){calls.push(['lte',...a]);return q},not(){return q},or(){return q},range(){return q},limit(){return q},then(resolve){resolve({data:table==='lr_pros_seguimiento'?[contact]:table==='lr_pros_mensajes'?history:[],count:1})}};return q},async rpc(name,args){writes.push([name,args]);if(args.p_mensaje)history.push(args.p_mensaje);return {data:null,error:null}}};
 w.eval(source);w.LRProsContactosPropios.mount(root,client);
 const tick=()=>new Promise(r=>setTimeout(r,0));await tick();
 const change=(id,value)=>{root.querySelector(id).value=value;root.querySelector(id).dispatchEvent(new w.Event('change'));};
 change('#lrSegmento','ecommerce');await tick();assert.deepEqual(Array.from(calls.find(x=>x[0]==='in')[2]),['ecommerce','ambos']);
 root.querySelector('[data-follow]').click();await tick();
 root.querySelector('[name=trabajadores]').value='25';
 root.querySelector('#lrFicha').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(writes.length,0);assert.match(root.textContent,/Indica la fuente/);
 root.querySelector('[name=tema]').value='Propuesta <script>alert(1)</script>';
 root.querySelector('#lrMensaje').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(writes.length,1);assert.equal(writes[0][0],'lr_pros_guardar_seguimiento');assert.equal(writes[0][1].p_identidad,'li:test');
 assert.equal(root.querySelectorAll('script').length,0);assert.match(root.textContent,/Propuesta <script>/);
 dom.window.close();
});
