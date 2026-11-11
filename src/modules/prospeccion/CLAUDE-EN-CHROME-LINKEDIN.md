# Acompañar en LinkedIn: Claude in Chrome lleva la cuenta

LinkedIn no deja que un bot escriba, así que los mensajes los sigue mandando la persona. Lo que se
delega es la cuenta: Claude in Chrome mira la pantalla y, por cada mensaje que ve enviado, registra
en el ACRM a quién fue, qué decía y **cuál de los dos lo envió** (Diego o Jorge Luis), que es lo que
evita que a la misma persona le llegue dos veces el saludo de la agencia.

## Dónde está

ACRM → barra de la tabla maestra → botón **Acompañar en LinkedIn**. Abre un panel con tres cajas:

1. **Copiar instrucciones y abrir LinkedIn.** Copia al portapapeles las instrucciones para Claude
   (con la cola del día dentro) y abre LinkedIn en otra pestaña. Una página web no puede abrir la
   extensión de Chrome: Claude in Chrome se abre desde el icono de Claude en la barra del navegador
   y ahí se pegan las instrucciones. «Ver instrucciones» las muestra para copiarlas a mano si el
   navegador no deja usar el portapapeles.
2. **Tu cola de primeros contactos.** Los primeros contactos de LinkedIn pendientes de quien tiene
   la sesión abierta —los que reparte «Metas del mes y reparto de primeros contactos»—, con el
   nombre, el perfil y si ya está reservado. Cada uno tiene su botón para copiar la URL.
   **Solo se sugiere a quien no tiene ningún mensaje enviado registrado:** un perfil está en el ACRM
   porque alguien del equipo subió su `Connections.csv`, no porque esté sin contactar, así que
   puede habérsele escrito antes de que existiera esta pantalla. También quedan fuera los que
   tiene reservados o ya contactados otra persona. Debajo de la lista se dice cuántos se
   descartaron, para que no parezca que la cola se vació sola.
3. **Registrar un envío.** Dos campos (URL del perfil y mensaje enviado) y un botón. Es lo único que
   Claude toca del ACRM.
4. **Registro de esta sesión.** Una línea por envío: hora, nombre, si fue primer contacto (a tu
   nombre) o seguimiento, y en ese caso quién había hecho el primer contacto, más el inicio del
   mensaje. Si algo falla, la línea lo dice en rojo con el motivo. Vive mientras la pestaña esté
   abierta; lo que queda guardado está en el hilo de cada lead.

La cabecera dice a nombre de quién se está registrando (la sesión abierta): eso es lo que después
se lee en la ficha como «Primer contacto hecho por …» y en el marcador del mes.

## Qué hace «Registrar envío»

Una sola operación (`registrarEnvioLinkedin` en `acrm-leads.js`), con las RPC que ya usaba la ficha:

1. Normaliza la URL igual que la base (acepta `https`, `www`, subdominio de país, barra final,
   `?parámetros` y `#ancla`) y busca el lead por ella. Las URLs de mensajes
   (`linkedin.com/messaging/...`) no sirven: hay que usar la del perfil.
2. Si la reserva del perfil todavía está abierta: la reserva y la confirma. Eso da la atribución del
   primer contacto, cierra el hito «Enviar primer mensaje por LinkedIn» y bloquea el perfil para el
   resto del equipo.
3. Deja el texto exacto en el hilo del lead como mensaje enviado con su autor: eso mueve el embudo a
   «Contactado», suma a la contactabilidad y cuenta en la racha del marcador.
4. Si el perfil ya estaba contactado, no vuelve a reservar: el mensaje entra como seguimiento.

No registra nada cuando el perfil no está en el ACRM (hay que cargarlo con el `Connections.csv`
antes) o lo tiene reservado o asignado otra persona. En los dos casos avisa y deja la reserva ajena
intacta.

## Las instrucciones que se copian

Las arma el panel con la cola del momento. En resumen, lo que le piden a Claude:

- Nunca escribe ni envía nada en LinkedIn, ni pulsa «Enviar», «Conectar» o «Seguir». Solo mira.
- En LR Suite solo usa este panel: sus dos campos y «Registrar envío». No cambia etapas,
  cotizaciones, hitos ni datos del lead, porque registrar el envío ya mueve la contactabilidad.
- Por cada persona: copia la URL del perfil, espera a ver el mensaje enviado en el hilo, copia su
  texto exacto, lo registra y lee la línea del registro.
- No registra un mensaje que no vio enviado, ni dos veces el mismo.
- Si algo no coincide (perfil fuera del ACRM, reservado por otra persona, LinkedIn pidiendo
  verificación), se detiene con esa persona y avisa.
- Al terminar, la lista: nombre, URL, hora y si quedó registrado.

## La otra forma: la ficha del lead

Sigue estando, para cuando se contacta de a uno desde el ACRM: en la ficha, los botones «Reservar
contacto» (candado), «Ya envié el mensaje» (check azul) y «Cancelar · no envié» (deshacer), con el
campo «Mensaje que enviaste (queda en el hilo)». El panel es el mismo camino en una sola operación,
pensado para una tanda larga.

Prueba: `tests/acrm/linkedin-sesion.mjs`.
