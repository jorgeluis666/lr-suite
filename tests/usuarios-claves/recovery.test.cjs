const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/modules/usuarios-claves/recovery.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/modules/usuarios-claves/reset-page.js'), 'utf8');
function library() {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.LRRecovery;
}
test('normaliza el usuario y rechaza direcciones fuera de la agencia sin enviar', async () => {
  const api = library();
  let sent = [];
  const request = api.createRequester({auth:{resetPasswordForEmail:async (...args) => {sent.push(args);return {};}}});
  assert.ok((await request('usuario@example.com')).error);
  assert.ok((await request('x\n@limaretail.com')).error);
  assert.equal(sent.length, 0);
  assert.ok((await request(' JORGELUIS ')).message);
  assert.equal(sent[0][0], 'jorgeluis@limaretail.com');
  assert.equal(sent[0][1].redirectTo, 'https://suite.limaretail.com/recuperar.html');
});
test('evita envíos concurrentes y respeta el minuto de espera', async () => {
  const api = library(); let finish, count = 0, clock = 100;
  const request = api.createRequester({auth:{resetPasswordForEmail:() => {count++;return new Promise(r => {finish=r;});}}}, () => clock);
  const pending = request('jorgeluis');
  assert.ok((await request('jorgeluis')).error);
  finish({}); await pending;
  assert.ok((await request('jorgeluis')).error);
  assert.equal(count, 1);
  clock += 60000;
  const again = request('jorgeluis'); finish({}); await again;
  assert.equal(count, 2);
});
test('no inventa éxito ante rate limit o fallos de transporte; permite reintento', async () => {
  let attempt = 0;
  const request = library().createRequester({auth:{resetPasswordForEmail:async () => {
    attempt++;
    if (attempt === 1) return {error:{status:429}};
    if (attempt === 2) throw new Error('SMTP secret must not appear');
    return {};
  }}});
  assert.match((await request('jorgeluis')).error, /Demasiados/);
  assert.doesNotMatch((await request('jorgeluis')).error, /secret/);
  assert.ok((await request('jorgeluis')).message);
});
test('validación de contraseña exige longitud y coincidencia', () => {
  const api = library();
  assert.ok(api.passwordError('corta', 'corta'));
  assert.ok(api.passwordError('UnaClaveLarga123', 'otra'));
  assert.equal(api.passwordError('UnaClaveLarga123', 'UnaClaveLarga123'), '');
});
async function mount({event, hash = '', updateError = null, logoutError = null} = {}) {
  const nodes = {};
  for (const id of ['requestForm','resetForm','message','intro','password','confirmation','email']) {
    nodes[id] = {hidden:id === 'resetForm', value:'', textContent:'', listeners:{},button:{disabled:false},
      addEventListener(name, fn){this.listeners[name] = fn;},querySelector(){return this.button;},
      reset(){nodes.password.value = '';nodes.confirmation.value='';},focus(){}};
  }
  let callback, options, updates = 0, signedOut = 0, scrubbed = false;
  const auth = {
    onAuthStateChange(fn){callback=fn;},
    async getSession(){if(event) callback(event, {user:{id:'fixture'}});return {data:{session:null}};},
    async updateUser(){updates++;return {error:updateError};},
    async signOut(opts){assert.equal(opts.scope,'global');signedOut++;if(!logoutError)callback('SIGNED_OUT',null);return {error:logoutError};},
    async resetPasswordForEmail(){return {};}
  };
  const context = vm.createContext({URLSearchParams,location:{hash,pathname:'/recuperar.html'},
    history:{replaceState(){scrubbed=true;}},document:{getElementById:id=>nodes[id]},
    window:{LRRecovery:library(),supabase:{createClient(url,key,opts){options=opts;return {auth};}}}});
  await vm.runInContext(page, context);
  return {nodes,submit:() => nodes.resetForm.listeners.submit({preventDefault(){}}),
    state:()=>({updates,signedOut,scrubbed,options})};
}
test('sin enlace y con sesión normal nunca muestra el cambio de clave', async () => {
  for (const event of [undefined, 'SIGNED_IN', 'INITIAL_SESSION']) {
    const app = await mount({event});
    assert.equal(app.nodes.resetForm.hidden, true);
    app.nodes.password.value=app.nodes.confirmation.value='NuevaClave12345';
    await app.submit(); assert.equal(app.state().updates, 0);
  }
});
test('enlace inválido o vencido se limpia y ofrece pedir otro', async () => {
  const app = await mount({hash:'#error=access_denied&error_code=otp_expired'});
  assert.equal(app.nodes.requestForm.hidden, false);
  assert.equal(app.nodes.resetForm.hidden, true);
  assert.equal(app.state().scrubbed, true);
  assert.match(app.nodes.message.textContent,/venció/);
});
test('recuperación verificada actualiza, limpia campos y revoca sesiones', async () => {
  const app = await mount({event:'PASSWORD_RECOVERY',hash:'#access_token=fixture&type=recovery'});
  assert.equal(app.nodes.resetForm.hidden,false);
  assert.equal(app.state().options.auth.persistSession,false);
  assert.equal(app.state().options.auth.storageKey,'lr-suite-recovery');
  app.nodes.password.value=app.nodes.confirmation.value='NuevaClave12345';
  await app.submit();
  assert.equal(app.state().updates,1); assert.equal(app.state().signedOut,1);
  assert.equal(app.nodes.password.value,''); assert.equal(app.nodes.resetForm.hidden,true);
  assert.match(app.nodes.intro.textContent,/correctamente/);
});
test('un rechazo de la nueva clave permite corregir y no cierra la sesión', async () => {
  const app = await mount({event:'PASSWORD_RECOVERY',updateError:{code:'same_password'}});
  app.nodes.password.value=app.nodes.confirmation.value='NuevaClave12345';
  await app.submit();
  assert.equal(app.state().signedOut,0);
  assert.equal(app.nodes.resetForm.hidden,false);
  assert.equal(app.nodes.resetForm.button.disabled,false);
  assert.match(app.nodes.message.textContent,/diferente/);
});
test('un fallo al cerrar otras sesiones no oculta que la clave ya cambió', async () => {
  const app = await mount({event:'PASSWORD_RECOVERY',logoutError:{status:500}});
  app.nodes.password.value=app.nodes.confirmation.value='NuevaClave12345';
  await app.submit();
  assert.match(app.nodes.intro.textContent,/correctamente/);
  assert.match(app.nodes.message.textContent,/otras sesiones/);
});
test('página distribuida no incluye rastreadores, tiene referrer seguro y sus scripts existen', () => {
  const html=fs.readFileSync(path.join(root,'recuperar.html'),'utf8');
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html,/googletagmanager|analytics|facebook\.net/);
  for (const [,src] of html.matchAll(/<script src="([^"]+)"/g)) {
    if (src.startsWith('https:')) continue;
    new vm.Script(fs.readFileSync(path.join(root,src),'utf8'));
  }
  assert.match(fs.readFileSync(path.join(root,'.github/workflows/publicar.yml'),'utf8'),/cp index.html recuperar.html/);
});
