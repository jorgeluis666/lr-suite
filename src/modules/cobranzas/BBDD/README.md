# Cobranzas / Seguimiento de Cobro

El módulo está en el menú de `index.html`. El alta solicita exclusivamente **nombre de la persona,
correo electrónico y nombre de la empresa**. No se guarda teléfono, monto, documento, notas ni
ningún otro dato de contacto. Registrar aquí significa que existe un saldo pendiente: como no se
solicitan importes, no se calcula una deuda ni se consulta una contabilidad externa.

`lr_suite_cobranzas` agrega únicamente metadatos operativos: identificador UUID, estado de pago
(`pendiente` / `completado`), fecha del último intento y fecha/hora del último envío confirmado por
SMTP, además de la pausa operativa. El estado inicial es pendiente; el botón **Marcar pago completado** detiene los siguientes
recordatorios. No hay un envío inmediato al registrar al contacto.

El correo sale con remitente y Reply-To `cobros@limaretail.com` —el buzón que ya tiene credenciales
SMTP— y firma como **Administración & Contabilidad**, con el teléfono y `www.limaretail.com`. La
firma no nombra un buzón, así que no hace falta crear una cuenta nueva para cambiarla. Se envía un correo individual por contacto; nunca se comparte la lista de
destinatarios. Una misma dirección puede representar empresas distintas, con seguimiento
independiente.

El asunto y el texto se editan desde el propio módulo, en **Mensaje del recordatorio**, y viven en
`lr_suite_cobranzas_mensaje` (una sola fila). El envío lee esa fila una vez por tanda: el mismo
texto para todos los contactos, sin campos que se rellenen por contacto. Si la tabla todavía no
está instalada, o la fila quedó vacía, se envía el texto por omisión de `scripts/correo/cobranzas.mjs`,
que es el mismo que siembra `cobranzas.sql`. La fecha de la última edición la escribe la base, no el
navegador.

Del texto guardado salen las dos versiones del correo. Una línea en blanco separa párrafos y los
saltos sueltos se conservan con `<br>`; lo que va entre `**dos asteriscos**` se envía en `<strong>`
y en la versión de texto plano se queda sin los asteriscos; una dirección `www.algo` queda
enlazada. Todo se escapa antes de aplicar esos adornos, así que lo que se escriba en el editor no
puede inyectar HTML en el correo.

## Puesta en marcha

1. Publicar el código del módulo y `.github/workflows/cobranzas.yml` en la rama `main` del
   repositorio `jorgeluis666/lr-suite`.
2. Ejecutar `cobranzas.sql` en el SQL Editor del proyecto de LR Suite. Es repetible y no introduce
   datos de ejemplo. Utiliza `is_lr_suite_pending_user()` para restringir acceso al equipo de la Suite;
   una sesión cualquiera de Supabase no obtiene acceso. El navegador no puede modificar las fechas
   de envío. No se almacena información de contactos en localStorage.
3. Configurar estos secretos en GitHub Actions (no en archivos públicos):
   - `COBRANZAS_DATABASE_URL`: conexión PostgreSQL de Supabase con TLS (`sslmode=verify-full`).
     Usar el pooler de sesión: la conexión directa es solo IPv6 y los runners de GitHub no la
     alcanzan. El certificado del pooler lo firma la raíz propia de Supabase, que Node no trae;
     por eso el workflow apunta `NODE_EXTRA_CA_CERTS` a `scripts/correo/supabase-ca.crt`
     (la raíz pública `prod-ca-2021.crt`, válida hasta 2031). Sin ella el proceso falla con
     «self-signed certificate in certificate chain». El usuario
     servidor necesita SELECT y UPDATE sobre `public.lr_suite_cobranzas` para todas las filas, y
     SELECT sobre `public.lr_suite_cobranzas_mensaje`; es preferible una cuenta dedicada con esos permisos. La clave publicable de la web no sirve.
   - `COBRANZAS_SMTP_HOST`, `COBRANZAS_SMTP_PORT` (465 o 587), `COBRANZAS_SMTP_USER` y
     `COBRANZAS_SMTP_PASS`: credenciales del buzón `cobros@limaretail.com`, o de una cuenta autorizada
     por el proveedor para enviar con ese remitente. No reutilizar sin comprobar la cuenta de
     `alertas@limaretail.com`. Confirmar que el buzón recibe respuestas.
4. Ejecutar el workflow **Recordatorios diarios de cobranzas** con **Simular** activado. Solo cuenta
   contactos elegibles; no reserva ni envía correos. La simulación no comprueba SMTP. Validar la
   conexión SMTP con una cuenta de prueba controlada antes de incorporar contactos reales.
5. Ejecutar `programacion.sql` después de configurar el workflow y los secretos. Usa las extensiones
   `http` y `pg_cron` y la clave `github-actions` de `lr_suite_notificaciones_claves`, igual que las
   alertas existentes. Programa el disparo diario a las **07:00 de America/Lima** (`0 12 * * *` UTC),
   todos los días, incluidos fines de semana. GitHub puede añadir tiempo de cola: no se garantiza
   que el correo llegue exactamente a las 07:00.
6. Verificar la programación y sus ejecuciones:

```sql
select jobname, schedule, active from cron.job where jobname = 'lr-suite-cobranzas';
select status, return_message, start_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'lr-suite-cobranzas')
order by start_time desc limit 5;
```

Una ejecución exitosa del cron indica que GitHub aceptó el disparo; comprobar también el resultado
del workflow y la fecha de último envío en la pantalla. Para pausar la automatización:
`select cron.unschedule('lr-suite-cobranzas');`.

## Corte, duplicados y fallos

Antes de enviar se reserva de forma atómica un único intento por contacto y día de Lima. Luego se
relee el estado bajo bloqueo de fila (`FOR UPDATE`) y se mantiene ese bloqueo hasta terminar SMTP.
Un pago completado confirmado antes de ese bloqueo no recibe correo. Si el envío ya está en curso,
el guardado de «completado» espera a que termine; no es posible retirar un mensaje ya aceptado por
SMTP. El navegador solo anuncia pago completado después de que la base confirme el cambio.

La reserva queda confirmada antes de SMTP, de modo que una repetición del workflow o una caída del
proceso no duplique el correo del día. Un error de red puede significar que SMTP aceptó el mensaje
pero no alcanzó a responder. Por eso **no se reintenta ese contacto el mismo día**, aunque el envío
haya fallado: el workflow falla, la pantalla muestra que no hay confirmación del intento y se
retoma al día siguiente si aún está pendiente y no está pausado. Un rechazo SMTP permanente pausa los próximos envíos hasta revisión. `ultimo_envio` significa aceptación SMTP, no lectura
ni entrega garantizada a la bandeja de entrada. Los logs no imprimen datos de contacto.

## Verificación local

```sh
npm ci --prefix tests/cobranzas
npm test --prefix tests/cobranzas
```

Las pruebas ejecutan el esquema y las consultas en PostgreSQL embebido (PGlite), verifican permisos
RLS y restricciones, el correo, duplicados, corte tras un cambio de estado, errores SMTP y el
formulario con DOM. No envían mensajes reales ni validan credenciales de producción. El bloqueo
entre conexiones simultáneas requiere verificarlo además en PostgreSQL desplegado.


## Seguimiento de aperturas y rechazos (BanaHosting / SMTP)

La tabla `lr_suite_cobranzas_envios` registra un intento por contacto/día: fecha, remitente utilizado,
resultado SMTP, código de respuesta (si existe), seguimiento de apertura habilitado y primera señal
de apertura. Se consulta con **Ver seguimiento** en la fila del contacto. No agrega campos al alta
ni guarda IP, navegador o texto de respuestas SMTP. Los tokens de apertura no son legibles por la
sesión del equipo.

- **Aceptado por SMTP**: el servidor aceptó el correo; no confirma entrega final ni lectura.
- **Rechazo SMTP**: el servidor rechazó el intento. Un rechazo permanente (5xx) o un destinatario
  rechazado pausa el seguimiento; requiere revisar correo, autenticación y causa en BanaHosting.
- **Error / intento sin confirmación**: hubo un error o interrupción. Puede haber entrega sin que
  el proceso recibiera la confirmación; no se reintenta ese día.
- **Señal de apertura**: se descargó una imagen de seguimiento. Puede provenir de una precarga o
  un filtro, y no prueba que una persona haya leído el mensaje.
- **Sin señal**: no se observó descarga. No significa «no leído» ni «bloqueado».
- **Apertura no medible**: se envió antes de activar el seguimiento.

Para activar la señal de apertura, desplegar **cobranzas-apertura** desde el workflow manual de
funciones. Solo esta función lleva `--no-verify-jwt`, porque los destinatarios no tienen una sesión
de LR Suite. La URL contiene un UUID aleatorio por envío; el endpoint siempre devuelve el mismo GIF
y no revela si el token existe. Actualiza únicamente la primera señal de apertura y no conserva
los encabezados recibidos. Los registros de acceso de la plataforma son independientes.

Después, crear la variable de Actions `COBRANZAS_TRACKING_URL` con:
`https://brfsipssqfsuoplxxcth.supabase.co/functions/v1/cobranzas-apertura`.
Activarla solo tras desplegar la función y verificar una carga con un contacto controlado. No
cambia el asunto ni el texto solicitado: el mensaje incluye versión HTML y texto plano.

El endpoint usa el secreto de servidor de Supabase y no entrega ninguna clave al correo. El usuario
PostgreSQL del workflow necesita también INSERT/SELECT/UPDATE sobre `lr_suite_cobranzas_envios`.
Aplicar de nuevo `cobranzas.sql` al actualizar una instalación anterior.

### Remitente alternativo

`COBRANZAS_REMITENTE` (variable de Actions) permite usar otro buzón **ya creado y autorizado** de
`limaretail.com`; de forma predeterminada es `cobros@limaretail.com`. Cambiarlo exige que el buzón
exista y que el hosting autorice a enviar con él. La firma del texto es
independiente: se corrige desde el módulo, el código no la reescribe. Actualizar también las
credenciales SMTP si el hosting exige autenticarse como el remitente. La respuesta irá al remitente
elegido. El historial conserva cuál se utilizó en cada intento. Esto **no crea buzones** en cPanel
ni cambia de identidad automáticamente ante rechazos o falta de apertura.

Para completar la integración con BanaHosting hace falta acceso autenticado a cPanel para comprobar
las cuentas, autenticación SPF/DKIM y el seguimiento de entrega disponible. Los rebotes posteriores
a la aceptación SMTP todavía no se importan; el bloqueo personal del destinatario tampoco suele
ser observable. No se etiquetan como bloqueos por inferencia. Una baja o reporte de spam conocido
debe detenerse con **Pausar envíos**. Reanudar exige revisión y el pago completado siempre mantiene
el corte, aunque se quite la pausa.
