(async function () {
  'use strict';
  const requestForm = document.getElementById('requestForm');
  const resetForm = document.getElementById('resetForm');
  const message = document.getElementById('message');
  const intro = document.getElementById('intro');
  const params = new URLSearchParams(location.hash.slice(1));
  const hasCallback = params.has('access_token') || params.has('error');
  let recoverySession = false;
  if (!window.supabase || !window.LRRecovery) {
    message.textContent = 'No se pudo cargar la conexión segura. Recarga la página para volver a intentar.';
    requestForm.hidden = true;
    return;
  }
  // Sesión aislada y solo en memoria: nunca reemplaza la sesión normal de la Suite.
  const client = window.supabase.createClient('https://brfsipssqfsuoplxxcth.supabase.co',
    'sb_publishable_s2FCj70_2jkUO6viQ0TR5A_1mOvq9tj', {
      auth: { persistSession: false, storageKey: 'lr-suite-recovery', detectSessionInUrl: true, flowType: 'implicit' }
    });
  if (hasCallback) { requestForm.hidden = true; message.textContent = 'Validando tu enlace…'; }
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      recoverySession = true;
      requestForm.hidden = true;
      resetForm.hidden = false;
      intro.textContent = 'Define una nueva contraseña para tu cuenta de LR Suite.';
      message.textContent = '';
      history.replaceState(null, '', location.pathname);
      document.getElementById('password').focus();
    }
    if (event === 'SIGNED_OUT') { recoverySession = false; resetForm.hidden = true; }
  });
  const requester = window.LRRecovery.createRequester(client);
  requestForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = requestForm.querySelector('button');
    button.disabled = true;
    message.textContent = 'Solicitando enlace…';
    try {
      const result = await requester(document.getElementById('email').value);
      message.textContent = result.error || result.message;
    } finally { button.disabled = false; }
  });
  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('password').value;
    const error = window.LRRecovery.passwordError(password, document.getElementById('confirmation').value);
    if (error) { message.textContent = error; return; }
    if (!recoverySession) { message.textContent = 'El enlace ya no es válido. Solicita uno nuevo.'; return; }
    const button = resetForm.querySelector('button');
    button.disabled = true;
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) { message.textContent = window.LRRecovery.errorMessage(updateError); return; }
      recoverySession = false;
      resetForm.reset();
      resetForm.hidden = true;
      intro.textContent = 'Tu contraseña se actualizó correctamente.';
      message.textContent = 'Ya puedes volver a LR Suite e ingresar con tu nueva contraseña.';
      // Revoca los refresh tokens de las sesiones anteriores, además de esta sesión temporal.
      const { error: signOutError } = await client.auth.signOut({ scope: 'global' });
      if (signOutError) message.textContent += ' No se pudieron cerrar las otras sesiones; ciérralas desde tus dispositivos.';
    } catch (error) { message.textContent = window.LRRecovery.errorMessage(error); }
    finally { button.disabled = false; }
  });
  try {
    await client.auth.getSession(); // Espera la validación del fragmento, sin aceptar sesiones normales como recuperación.
    if (hasCallback && !recoverySession) {
      history.replaceState(null, '', location.pathname);
      requestForm.hidden = false;
      message.textContent = 'El enlace venció, ya fue utilizado o no es válido. Solicita uno nuevo.';
    }
  } catch {
    history.replaceState(null, '', location.pathname);
    requestForm.hidden = false;
    message.textContent = 'No se pudo validar el enlace. Revisa tu conexión y solicita uno nuevo.';
  }
})();
