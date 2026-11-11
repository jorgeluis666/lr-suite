# Handoff: conectar el WhatsApp del chatbot del ACRM (sesión con Chrome)

Documento para una sesión de Claude que **puede manejar Chrome** (Claude in Chrome), con las sesiones
de Meta y Supabase ya iniciadas en el navegador del usuario. Lo que sigue son las tareas que faltan
para que el chatbot de LR Suite responda por WhatsApp a los leads. La parte de código, la base de
datos y las funciones ya están hechas y desplegadas: aquí solo queda configuración en Meta y Supabase.

---

## 1. Qué se está construyendo (contexto mínimo)

```txt
Cliente escribe al +51 928 208 228
        │
        ▼
Meta (WhatsApp Cloud API) ──webhook firmado──> Supabase Edge Function «acrm-meta»
                                                  │ 1. guarda el lead en el ACRM
                                                  │ 2. reenvía el mismo mensaje a «whatsapp»
                                                  ▼
                                         Edge Function «whatsapp» (Claude)
                                                  │ responde, agenda, o pasa a un humano
                                                  ▼
                                   LR Suite → ACRM → ficha del lead (chat, estado del bot)
```

- **LR Suite (app):** https://suite.limaretail.com → módulo **ACRM**.
- **Supabase:** proyecto `brfsipssqfsuoplxxcth` (https://supabase.com/dashboard/project/brfsipssqfsuoplxxcth).
- **Funciones ya desplegadas:** `acrm-meta` (webhook), `whatsapp` (bot), `agenda-panel` (envíos del equipo desde la ficha).
- **Migración del bot:** aplicada (`20261110180607 acrm_bot_whatsapp`).

## 2. Datos que ya existen (no son secretos)

| Dato | Valor |
|---|---|
| Número de la agencia | +51 928 208 228 |
| Phone number ID | `1432904719917042` |
| WABA ID (cuenta «Agente LR») | `1578024304076702` |
| App de Meta | «LR Suite Mensajes» |
| Usuario del sistema (a crear o ya creado) | `lr-suite-bot` |
| URL del webhook | `https://brfsipssqfsuoplxxcth.supabase.co/functions/v1/acrm-meta` |

## 3. Reglas para la sesión de Chrome

1. **Los valores secretos no se escriben en el chat, ni en notas, ni en resúmenes.** El token
   (`EAA…`) y la clave secreta de la app se copian de la pestaña de Meta y se pegan directo en la
   pestaña de Supabase. En el reporte final se dice «cargado», nunca el valor.
2. **No crear apps, números ni cuentas nuevas en Meta.** Todo existe; solo se verifica y se completa.
3. **No borrar ni rotar** nada que ya funcione (usuarios del sistema, tokens existentes, secretos
   que no estén en esta lista).
4. **No tocar** el teléfono del usuario ni la app WhatsApp Business.
5. Si una pantalla no coincide con lo descrito (Meta cambia los menús seguido), **detenerse y
   preguntar al usuario** con una captura o descripción. No improvisar.
6. Antes de cualquier paso que Meta marque como irreversible o que cobre dinero, **pedir
   confirmación al usuario**.

---

## 4. Tareas, en orden

Marca cada una como ✅ hecha, ⏭️ ya estaba hecha o ❌ bloqueada (con el motivo).

### T1. Confirmar que el número está activo
1. Abre https://business.facebook.com/wa/manage/phone-numbers/ (WhatsApp Manager → Teléfonos) y
   selecciona la cuenta **«Agente LR»**.
2. El +51 928 208 228 debe figurar como **Conectado / Activo**.
   - Si dice «Sincronizando» o «Pendiente», espera y vuelve a mirar. No sigas a T6 hasta que esté activo.
   - Anota el **nombre visible** y si está aprobado. Si está rechazado o en revisión, repórtalo.
3. Confirma que el **Phone number ID** que se muestra es `1432904719917042`. Si es otro, repórtalo:
   ese valor va en T4.

### T2. Usuario del sistema y token permanente
1. Abre https://business.facebook.com/settings/system-users (portafolio de **Lima Retail**).
2. Si ya existe `lr-suite-bot`, úsalo. Si no:
   - «+ Agregar» → Nombre `lr-suite-bot` → Rol **Administrador** → Crear.
   - Si Meta dice que se llegó al límite de usuarios administradores, **detente y repórtalo**.
3. Con `lr-suite-bot` seleccionado → **Asignar activos**:
   - **Apps** → «LR Suite Mensajes» → **Control total** → Guardar.
   - **Cuentas de WhatsApp** → «Agente LR» → **Control total** → Guardar.
   - Si ya estaban asignados, márcalo como ⏭️.
4. **Generar token**:
   - App: «LR Suite Mensajes».
   - Caducidad: **Nunca**.
   - Permisos: `whatsapp_business_messaging` y `whatsapp_business_management`.
   - Si no aparecen esos permisos, revisa el paso 3 (la app debe estar asignada y tener el
     producto WhatsApp).
5. Copia el token (empieza con `EAA`). **Meta lo muestra una sola vez.** Generar otro no invalida
   los anteriores, así que si se pierde, se genera de nuevo.
6. Déjalo en el portapapeles para T4 (no lo pegues en ningún otro lugar).

### T3. Clave secreta de la app
1. Abre https://developers.facebook.com/apps → «LR Suite Mensajes» → **Configuración de la app →
   Básica**.
2. «Clave secreta de la app» → **Mostrar** (puede pedir la contraseña de Facebook).
3. Se copia en T4.

### T4. Cargar los 4 secretos en Supabase
1. Abre https://supabase.com/dashboard/project/brfsipssqfsuoplxxcth/functions/secrets
   (Edge Functions → Secrets).
2. «Add new secret» por cada uno (los nombres son exactos, en mayúsculas):

   | Nombre | Valor |
   |---|---|
   | `WHATSAPP_TOKEN` | el token de T2 |
   | `WHATSAPP_PHONE_ID` | `1432904719917042` (o el que se vio en T1) |
   | `META_APP_SECRET` | la clave secreta de T3 |
   | `WHATSAPP_VERIFY_TOKEN` | una frase nueva, sin espacios, por ejemplo `lr-acrm-verifica-2026-<4 letras al azar>` |

3. **Save.** Pídele al usuario que anote la frase de `WHATSAPP_VERIFY_TOKEN` en un lugar seguro: se
   usa en T5 y T6. Es lo único que se puede repetir en el chat si el usuario lo pide, porque solo
   sirve para el apretón de manos del webhook.
4. Verifica que los 4 nombres aparezcan en la lista (los valores se ven como hash; está bien).

### T5. Probar que el webhook responde
1. En una pestaña nueva abre (reemplaza `<FRASE>` por la de T4):
   ```
   https://brfsipssqfsuoplxxcth.supabase.co/functions/v1/acrm-meta?hub.mode=subscribe&hub.verify_token=<FRASE>&hub.challenge=12345
   ```
2. Resultado esperado: la página muestra solo **`12345`**.
   - `Webhook sin configurar` → falta alguno de los 3 secretos `META_APP_SECRET`,
     `WHATSAPP_VERIFY_TOKEN` o `WHATSAPP_PHONE_ID`. Espera 30 s y recarga; si sigue, revisa T4.
   - `No autorizado` → la frase de la URL no es igual a la cargada en `WHATSAPP_VERIFY_TOKEN`.

### T6. Configurar el webhook en Meta
1. https://developers.facebook.com/apps → «LR Suite Mensajes» → **WhatsApp → Configuración**.
2. Sección **Webhook → Editar**:
   - **URL de devolución de llamada:** `https://brfsipssqfsuoplxxcth.supabase.co/functions/v1/acrm-meta`
   - **Token de verificación:** la frase de T4.
   - **Verificar y guardar.** Debe quedar guardado sin error (Meta hace la misma prueba de T5).
3. **Campos del webhook → `messages` → Suscribir.** Solo ese campo es obligatorio.
4. Si en esa pantalla hay un selector de cuenta o número, confirma que esté «Agente LR» /
   +51 928 208 228.

### T7. Poner la app en modo Live
1. En el panel de la app, el interruptor de **Modo de la app: Desarrollo → En vivo (Live)**.
2. Meta pide una **URL de política de privacidad** (Configuración → Básica). Si no hay una cargada,
   **pregunta al usuario** cuál usar (por ejemplo, la del sitio de Lima Retail). No inventes una.
3. Sin modo Live, Meta solo entrega mensajes de números de prueba.

### T8. Método de pago (opcional, preguntar al usuario)
WhatsApp Manager → «Agente LR» → Configuración → **Método de pago**. No es necesario para que el bot
responda (las respuestas dentro de 24 h no se cobran). Hazlo solo si el usuario lo confirma.

### T9. Prueba real
1. Pídele al usuario que, desde **otro celular**, escriba al +51 928 208 228:
   «Hola, quiero información de Google Ads».
2. En https://suite.limaretail.com → ACRM (recargar con Ctrl+Shift+R):
   - Debe aparecer un lead nuevo con origen **Meta Ads / WhatsApp**.
   - Al abrir su ficha: panel **«Estado del bot»**, el mensaje del cliente en el chat y, en
     segundos, la respuesta del **Asistente IA**.
   - La columna **«Estado bot»** de la tabla debe decir «Respondiendo».
3. Prueba la pausa: en la ficha, el ícono rojo ⏸ («Pausar bot y tomar control humano»). El estado
   debe pasar a «Control humano» y el bot no debe responder el siguiente mensaje del cliente.
   Luego ▶ («Devolver al bot»).

---

## 5. Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| T5/T6: «Webhook sin configurar» | Falta un secreto | Revisar T4 (nombres exactos) |
| T6: Meta no verifica | Frase distinta o URL mal copiada | Repetir T5 con la misma frase |
| T9: no aparece el lead | App no está en Live, `messages` no suscrito, o el número no está activo | Revisar T1, T6.3, T7 |
| T9: aparece el lead pero el bot no responde | La función `whatsapp` rechaza el reenvío (401) | Supabase → Edge Functions → `whatsapp` → Details → desactivar **Enforce JWT verification** → Save. Avisar al usuario de este cambio. |
| T9: el bot responde pero no ofrece horarios | La Agenda no tiene horario ni tipos de reunión | Ver sección 6 |
| T9: el bot dice que consultará todo | La base de conocimiento está vacía | Ver sección 6 |

Logs: Supabase → Edge Functions → `acrm-meta` o `whatsapp` → **Logs**. Buscar «el bot respondió 401»
o «no se pudo pasar el mensaje al bot».

## 6. Lo que falta del lado del negocio (requiere datos del usuario)

Estado verificado en la base (10/11/2026): **bot activo**, **horario vacío**, **0 tipos de reunión**,
**0 entradas de conocimiento**, **calendario sin configurar**. Se carga en LR Suite → **Agenda**:

1. **Reglas → Horario:** días y horas en que Diego toma llamadas (preguntar al usuario).
2. **Reglas → Tipos de reunión:** id `exploracion`, nombre «Llamada de exploración», 30 min, Meet,
   descripción «Llamada con Diego para entender la marca y proponer un plan».
3. **Conocimiento:** servicios (Google Ads, Meta Ads, Analítica, Desarrollo Web), precios si se
   publican, casos y preguntas frecuentes. Si el usuario tiene un documento en Google Drive, cargar
   su contenido por entradas.
4. **Reglas → Calendario (opcional):** ID del Google Calendar de Diego, para crear el evento con Meet.
5. **Estándares → Probar:** escribir una consulta de prueba y revisar la respuesta antes de abrir
   el número al público.

## 7. Qué reportar al terminar

```text
T1 Número activo: ✅/❌ (estado, nombre visible)
T2 Usuario del sistema y token: ✅/⏭️/❌
T3 Clave secreta: ✅/❌
T4 Secretos en Supabase (4 nombres visibles): ✅/❌
T5 Prueba del webhook devolvió 12345: ✅/❌
T6 Webhook guardado y «messages» suscrito: ✅/❌
T7 App en Live: ✅/❌ (URL de privacidad usada)
T8 Método de pago: ✅/omitido
T9 Prueba real: lead visible / bot respondió / pausa funciona
Sección 6: qué quedó cargado y qué falta
```

Sin valores secretos en el reporte.
