# Agenda con asistente de WhatsApp

Módulo del `index.html`. Un asistente atiende el WhatsApp de la agencia: **asesora** (entiende qué
necesita la marca y responde con lo que sabe de Lima Retail), **ofrece horarios reales** y **cierra la
cita creando la reunión en Google Calendar**. Ninguna respuesta sale sin pasar por los estándares que
la agencia escribe en el panel.

## Cómo funciona

```txt
Cliente en WhatsApp
      │
      ▼
Meta Cloud API ─webhook firmado─> Edge Function "whatsapp"
                                    │ 1. contexto: conocimiento + estándares + historial del chat
                                    │ 2. Claude redacta (ver_huecos, reservar_cita, dejar_solicitud)
                                    │ 3. filtro de estándares sobre el borrador
                                    │ 4. envía y guarda todo
                                    ▼
                    Supabase (service_role)        Google Calendar
                    · conocimiento, estándares     · free/busy → huecos reales
                    · citas, conversaciones        · evento con invitado y Meet
                    · mensajes, revisiones, log
                                    ▲
Módulo «Agenda» del index.html ──sesión de Jorge Luis o Diego (RLS)──┘
```

La función escribe con la `service_role` (nunca sale del servidor) y el navegador lee con la sesión de
los dos usuarios de la Suite, con la misma puerta que el resto: `public.is_lr_suite_pending_user()`.

**Ningún dato del negocio vive en este repositorio, que es público**: servicios, precios, horarios y
estándares se escriben desde el panel y quedan en Supabase.

## Qué hace y qué no

| Hace solo | No hace solo |
| --- | --- |
| Asesora y responde con el conocimiento cargado | Reprogramar o cancelar (deja la solicitud al equipo) |
| Ofrece huecos libres de verdad (horario − citas − Google Calendar) | Mandar recordatorios (exigirían plantilla aprobada de Meta y son de pago) |
| Cierra la cita y crea el evento con invitación y Meet | Hablar si alguien del equipo tomó la conversación o si el asistente está apagado |
| Marca la conversación cuando no sabe o el filtro frena la respuesta | Inventar precios, plazos o descuentos |

Como solo responde a quien escribió primero, siempre está dentro de la ventana de 24 h de Meta: **no
hace falta ninguna plantilla aprobada** y la mensajería cae en el tramo gratuito (1.000 mensajes de
servicio al mes por número). El gasto real es la API de Claude, centavos al mes con este volumen.

## Archivos

- `BBDD/agenda.sql`: tablas, RLS y RPC. Ejecutar completo en Supabase > SQL Editor (es idempotente).
- `BBDD/agenda-automatizacion.sql`: registra el asistente en el **Control de Automatización**. Se
  ejecuta después de `agenda.sql` y del SQL de ese módulo (es idempotente).
- `BBDD/README.md`: qué guarda cada tabla y qué devuelve cada RPC.
- `supabase/functions/whatsapp/`: el webhook (público, lo llama Meta).
- `supabase/functions/agenda-panel/`: lo que necesita el panel (enviar, citas, probar). Exige sesión.
- `supabase/functions/_shared/`: secretos, datos, WhatsApp, Google Calendar y el asistente.
- La interfaz (`agendaModule()` y las funciones `agenda*`) y sus estilos (`.agenda-*`) viven en el
  `index.html`, como el resto de módulos.

## Las cinco vistas

- **Agenda**: estado del asistente, citas del día o de la semana, crear, mover y cancelar a mano (con
  reflejo en Google Calendar) e interruptor para apagar el asistente.
- **Conversaciones**: cada chat con su historial, «Tomar la conversación» (el asistente calla),
  responder a mano y lo que quedó pendiente de una persona.
- **Conocimiento**: lo que el asistente sabe y puede decir. Si está vacío, no inventa: dice que no sabe.
- **Estándares**: tono, qué decir siempre, qué no decir nunca, largo máximo, descuento permitido, cuándo
  derivar y qué hace falta saber antes de agendar. Incluye **Probar**, que redacta y valida un mensaje
  de ejemplo sin enviar nada ni reservar nada.
- **Reglas**: horario de atención por día, tipos de reunión, anticipación, tope diario, feriados, el
  calendario de Google y qué modelo conversa y cuál valida.
- **Revisiones**: qué corrigió o frenó el filtro, para ir afinando los estándares.

## En el Control de Automatización

El asistente también se ve en la vista **Automatización** de Clientes, que es el mapa de todo lo que
corre solo. Va **aparte del proceso de las marcas**, debajo y sin flecha: no baja informes ni alimenta
un módulo del dashboard. Son tres piezas, que llegan con `BBDD/agenda-automatizacion.sql`:

| Pieza | Está al día cuando | Se pone en rojo cuando |
| --- | --- | --- |
| Webhook de WhatsApp | llegó y se guardó un mensaje del cliente | falla la atención antes de que el asistente entre |
| Asistente de la agenda | salió una respuesta suya | falla el modelo o el filtro de estándares |
| Reuniones en Google Calendar | se creó el evento de una cita | falla Google Calendar (free/busy o crear el evento) |

Cómo sabe su estado: la Edge Function `whatsapp` anota cada atención con
`public.lr_suite_agenda_automation_anotar()`, que escribe la corrida con
`lr_suite_automation_log_run()`. Guarda **una corrida correcta por pieza y por hora, y todos los
errores**: con eso se sabe que el asistente funciona y cuándo fue lo último que hizo, sin que cien
mensajes al día tapen las corridas de las marcas en «Ejecuciones». Lo que falló dentro del asistente
lo lee de `lr_suite_agenda_log` (ahí anota sus errores y sigue contestando). Si el Control no acepta
la corrida, la conversación no se corta: es el mismo trato que la bitácora. Las tres son
**semanales**, así que varios
días sin un solo mensaje dejan de contar como «al día»: primero «Atención» y después «Atrasado». Ninguna
tiene «Ejecutar ahora»: no hay nada que volver a correr.

Una firma inválida no pone nada en rojo: es una petición de fuera que se descartó bien. Queda en la
bitácora del módulo, no en el Control.

Para traer al Control lo que ya está en la bitácora (al instalar, o después de un rato sin mirar):
`select public.lr_suite_agenda_automation_sembrar();`. Anota como mucho una corrida por pieza y no
duplica lo ya registrado.

## Puesta en marcha

### 1. Base de datos

Ejecutar `BBDD/agenda.sql` completo en Supabase > SQL Editor. Después, `BBDD/agenda-automatizacion.sql`
para que el asistente salga en el Control de Automatización (necesita instalado
`src/modules/control-automatizacion/BBDD/control-automatizacion.sql`).

### 2. App de Meta (la haces tú: es tu cuenta)

1. developers.facebook.com → **Crear app** → tipo «Empresa» → añadir el producto **WhatsApp**.
2. Anotar el **Identificador del número de teléfono** (`WHATSAPP_PHONE_ID`) y generar un **token**
   permanente desde un usuario del sistema (`WHATSAPP_TOKEN`).
3. **Configuración de la app → Básica → Clave secreta de la app** (`META_APP_SECRET`).
4. Inventar una cadena cualquiera como `WHATSAPP_VERIFY_TOKEN` (la usa Meta para validar el webhook).
5. Para empezar vale el **número de prueba gratuito** de Meta (hasta 5 destinatarios autorizados); el
   chip nuevo se registra al final.

### 3. Google Calendar (también tuyo)

1. Crear el calendario **«Agenda Lima Retail»** y compartirlo con Diego.
2. En Google Cloud: proyecto → **API de Calendar** activada → **Pantalla de consentimiento** →
   credenciales **ID de cliente OAuth** de tipo «Aplicación de escritorio»
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
3. Dar el consentimiento una vez con el ámbito `https://www.googleapis.com/auth/calendar` y guardar el
   **refresh token** (`GOOGLE_REFRESH_TOKEN`).
4. Copiar el **id del calendario** en la vista Reglas del módulo.

### 4. Secretos y despliegue

```bash
supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_VERIFY_TOKEN=... META_APP_SECRET=... ANTHROPIC_API_KEY=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
supabase functions deploy whatsapp --no-verify-jwt
supabase functions deploy agenda-panel
```

Opcionales: `WHATSAPP_GRAPH_VERSION` (por defecto `v22.0`), `GOOGLE_CALENDARIOS_EXTRA` (otros
calendarios que también bloquean huecos) y `PANEL_ORIGEN` (origen permitido para el panel).

### 5. Webhook en Meta

En la app de Meta → WhatsApp → Configuración → Webhook:

- URL: `https://<proyecto>.supabase.co/functions/v1/whatsapp`
- Token de verificación: el `WHATSAPP_VERIFY_TOKEN`
- Suscribirse al campo **messages**

### 6. Cargar el negocio

En el módulo: **Reglas** (horario, tipos de reunión, calendario), **Conocimiento** (servicios, precios,
casos, preguntas de diagnóstico) y **Estándares** (tono, siempre, nunca, requisitos antes de agendar).
Probar con el botón **Probar** antes de escribirle a nadie.

## Seguridad

- El webhook comprueba la firma `X-Hub-Signature-256`: lo que no venga firmado por Meta se descarta.
- El teléfono lo pone la función desde el payload de Meta, nunca el modelo: nadie puede pedir datos de
  otra conversación ni reservar a nombre de otro.
- Lo que escribe el cliente es información, no instrucciones; el prompt lo dice y las herramientas son
  solo tres, con la reserva limitada al horario de atención.
- Las RPC nuevas quitan el `execute` que Postgres da a `public`/`anon`: solo `authenticated` (los dos
  usuarios) y `service_role` (la función).
- Dos citas confirmadas no pueden pisarse: lo impide una restricción de la base, no el código del bot.
