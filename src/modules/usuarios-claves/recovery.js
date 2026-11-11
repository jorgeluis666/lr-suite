/* Recuperación de LR Suite: solo Supabase Auth emite y valida los enlaces. */
(function (root) {
  'use strict';
  const redirectTo = 'https://suite.limaretail.com/recuperar.html';
  function email(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized && !normalized.includes('@') ? normalized + '@limaretail.com' : normalized;
  }
  function passwordError(password, confirmation) {
    if (String(password || '').length < 12) return 'Usa una contraseña de al menos 12 caracteres.';
    if (password !== confirmation) return 'Las contraseñas no coinciden.';
    return '';
  }
  function errorMessage(error) {
    if (error?.status === 429 || String(error?.code || '').includes('rate_limit')) {
      return 'Demasiados intentos. Espera unos minutos antes de volver a solicitar el enlace.';
    }
    if (error?.code === 'same_password') return 'Elige una contraseña diferente a la anterior.';
    if (error?.code === 'weak_password') return 'Esta contraseña no es suficientemente segura. Elige otra más larga y única.';
    return 'No se pudo completar la solicitud. Revisa tu conexión e inténtalo de nuevo.';
  }
  function createRequester(client, now = Date.now) {
    let busy = false, retryAt = 0;
    return async function request(value) {
      const address = email(value);
      if (!/^[^\s@]+@limaretail\.com$/.test(address)) {
        return { error: 'Introduce tu usuario o correo @limaretail.com.' };
      }
      if (busy || now() < retryAt) return { error: 'Espera un minuto antes de solicitar otro enlace.' };
      busy = true;
      try {
        if (!client) throw new Error('Unavailable');
        const { error } = await client.auth.resetPasswordForEmail(address, { redirectTo });
        if (error) return { error: errorMessage(error) };
        retryAt = now() + 60000;
        return { message: 'Si el correo corresponde a una cuenta de LR Suite, recibirás un enlace para crear una nueva contraseña. Revisa también Spam. El enlace es de un solo uso.' };
      } catch (error) {
        return { error: errorMessage(error) };
      } finally { busy = false; }
    };
  }
  root.LRRecovery = Object.freeze({ email, passwordError, errorMessage, createRequester, redirectTo });
})(typeof window === 'undefined' ? globalThis : window);
