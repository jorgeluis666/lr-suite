# Usuarios y Claves

La recuperación automática corresponde a **LR Suite**, no a las contraseñas de los buzones del hosting.

- Login → «Olvidé mi contraseña», o Usuarios y Claves → «Recuperar mi contraseña».
- `recuperar.html` solicita el correo corporativo (también admite el nombre de usuario).
- Supabase Auth emite y valida el enlace temporal de un solo uso; no se almacenan contraseñas ni tokens propios.
- La página admite una nueva clave de al menos 12 caracteres únicamente después de `PASSWORD_RECOVERY`. Su cliente tiene sesión en memoria aislada de la sesión normal. Recargar la página después de consumir el enlace exige solicitar otro.
- Tras actualizar la clave se pide el cierre global de sesiones. Los access tokens ya emitidos pueden seguir vigentes hasta su expiración; el cierre invalida los refresh tokens.
- La respuesta de solicitud es genérica para cuentas existentes e inexistentes. Los límites reales los aplica Supabase; el minuto de espera y bloqueo concurrente del cliente evitan dobles clics.

## Configuración y operación

Workflow manual **Configurar recuperación de contraseñas**: reutiliza los secretos SMTP y de Supabase existentes en GitHub Actions, verifica conexión/autenticación SMTP antes de modificar Auth y comprueba la configuración guardada sin imprimir secretos. No envía mensajes de prueba. Conserva redirects y configuraciones ajenas a este flujo; no sustituye un SMTP con otro host.

El token necesita `Auth Config` de lectura/escritura para este proyecto. Si el token habitual solo permite desplegar funciones, usar el secreto temporal `SUPABASE_AUTH_CONFIG_TOKEN` y revocarlo/eliminarlo después de configurar. No hace falta un token de administración para el funcionamiento diario de la recuperación.

Redirect exacto: `https://suite.limaretail.com/recuperar.html`. Se corrige `site_url` solo si falta o apunta al localhost original. Plantilla de recuperación en español; entrega mediante el correo corporativo ya utilizado por la Suite. La configuración afecta al proveedor de envío del proyecto Auth; no modifica cuentas ni claves de usuarios.

Verificación local: `node --test tests/usuarios-claves/recovery.test.cjs` y `node scripts/check-index.js`. El workflow de publicación ejecuta ambas comprobaciones. Para verificar entrega de extremo a extremo, solicitar un enlace a una cuenta autorizada y comprobar su recepción; el titular define la nueva contraseña.

Documentación: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail y https://supabase.com/docs/guides/auth/auth-smtp
