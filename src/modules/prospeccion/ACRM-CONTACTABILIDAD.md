# ACRM: de la captura a la venta

El objetivo comercial es convertir prospectos en ventas mediante la contactabilidad.
El ritmo de captura debe compararse con una meta por periodo y canal: Meta Ads / WhatsApp y cargas de LinkedIn. La IA debe priorizar la próxima acción del usuario o ejecutar seguimientos autorizados, no limitarse a resumir fichas.

## Entregado en esta integración

- Base existente de contactos unificados de Supabase, con las sesiones reales del equipo.
- Responsable y primer contacto compartidos por URL de LinkedIn.
- Reserva atómica antes del envío manual, sin caducidad automática; cierre por quien reservó.
- Registro de autor y fecha del contacto; eventos de auditoría separados.
- Actualizaciones por Supabase Realtime y respaldo de lectura cada 15 segundos mientras el módulo está abierto y visible.
- RPC con control de versión, identidad de sesión y comprobación de colaboradores activos. Sin escritura directa de clientes sobre el registro de coordinación.

La reserva coordina el primer contacto desde ACRM. No intercepta mensajes que alguien envíe directamente en LinkedIn. «Cancelar · no envié» solo debe usarse cuando el mensaje no se envió. Un error de red no libera la reserva: actualizar antes de volver a contactar.

## Pacing y cola comercial

Implementado en noviembre de 2026: dos metas mensuales editables (LinkedIn y Meta Ads / WhatsApp), capturados, ritmo esperado, faltantes y ritmo diario necesario. Las fechas se agrupan en America/Lima. Meta 0 significa sin objetivo, no una meta cumplida. El mes cerrado no muestra un ritmo diario inventado.

LinkedIn cuenta una sola URL incorporada por primera vez al CRM, aunque ambos usuarios la importen o vuelvan a cargar el CSV. No equivale a fecha de conexión ni supone que la persona sea un lead calificado. La base previa se incorpora usando la primera carga registrada, sin fabricar capturas históricas.

La cola se filtra por responsable. «Priorizar con IA» prepara hasta cinco acciones abiertas por persona con perfiles disponibles, respetando reservas y asignaciones; Claude analiza hasta 30 próximas acciones por responsable. Puntúa y justifica el orden. El servidor obtiene la cola, valida todas las respuestas y descarta resultados de tareas que hayan cambiado. La fecha y el responsable no cambian por decisión del modelo. La prioridad caduca a las 24 horas; los cambios de fecha, texto o respuesta del lead invalidan la prioridad anterior.

El usuario puede agregar seguimientos, editar sus fechas y acciones y completar los propios. El primer contacto de LinkedIn se completa desde la reserva existente; la tarea se cierra automáticamente al registrar el envío. Realtime actualiza metas, capturas y acciones para el equipo.

### Funciones y conexiones

- `acrm-priorizar`: valida sesión y membresía; reutiliza `ANTHROPIC_API_KEY`. Modelo configurable con `ACRM_MODELO`, con respaldo en `PENDIENTES_MODELO`. Una solicitud por minuto por usuario. No hay claves de Claude en el navegador. Si falla, el orden anterior se conserva y la interfaz identifica el error; preparar por fecha no se presenta como IA.
- `acrm-meta`: recepción firmada con `META_APP_SECRET`, validación con `WHATSAPP_VERIFY_TOKEN` y filtrado estricto por `WHATSAPP_PHONE_ID`. Se debe suscribir el campo `messages` del número correcto en Meta. No cambiar un webhook existente de Agenda sin coordinar antes su convivencia.
- Endpoint: `https://brfsipssqfsuoplxxcth.supabase.co/functions/v1/acrm-meta`.
- No se necesita `WHATSAPP_TOKEN` para recibir mensajes. El endpoint no envía mensajes. No activa por sí mismo una conexión en Meta; si falta esa suscripción, la pantalla mostrará sin eventos recibidos.
- Solo cuenta WhatsApp entrante; el dato de anuncio viene de `referral.source_type=ad`. Sin referral no se atribuye a pauta. Formularios Instant Forms requieren un conector adicional y no se cuentan aquí.
- Los mensajes se persisten antes del 200. No se llama a Claude en el webhook. Si la escritura falla o supera 1,8 s, se devuelve 503 para que Meta reintente. ID de mensaje único y transacción por evento impiden contar doble. La primera captura permanece estable incluso con eventos fuera de orden.
- Cada nueva consulta crea/reabre una acción de respuesta, asignada al responsable previo o al miembro con menor cola. No hay envíos automáticos en este alcance.
- GitHub Actions `acrm.yml` despliega ambas funciones. Necesita los secretos de repositorio `SUPABASE_ACCESS_TOKEN` y `SUPABASE_PROJECT_REF`. La autenticación de usuario/HMAC se comprueba dentro de cada función.

## Siguiente alcance de producto

1. Mensajes editables de cada hito y ejecución de envíos con deduplicación.
2. IA que ajuste el plan completo y ejecute lo autorizado, con pausas al responder el cliente o al tomar control humano.
3. Conversión a cotización y venta, con métricas por responsable y canal.

## Operación

Migración: `supabase/migrations/20261109083029_acrm_contacto_compartido.sql`.
Fue aplicada por SQL Editor al proyecto de LR Suite; antes de usar `db push` hay que reconciliar el historial de migraciones con la base existente, que incluye SQL históricos fuera del directorio de migraciones.
La migración no elimina contactos ni cambia la lista de colaboradores autorizados.

La sincronización publica las tablas base (la vista unificada no se publica directamente). Los eventos provocan una nueva lectura bajo RLS. El registro operativo no copia los datos privados del lead.

Para revertir la interfaz, restaurar la versión anterior de `contactos-propios.js` y su referencia en `index.html`; conservar las nuevas tablas para no perder reservas ni auditoría. No retirar la protección con contactos reservados en curso.
