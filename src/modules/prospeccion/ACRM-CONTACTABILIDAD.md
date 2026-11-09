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

## Siguiente alcance de producto (todavía no implementado aquí)

1. Pacing por origen: capturados / meta del periodo, faltantes y ritmo necesario.
2. Cola diaria de contactabilidad: sin primer contacto, por responder y seguimientos vencidos.
3. Hitos editables con fecha, acción y mensaje; cada hito con identidad propia para impedir ejecuciones repetidas.
4. IA con contexto de consulta inicial y respuestas: recomendar siguiente acción, ajustar el plan y ejecutar lo autorizado.
5. Meta Ads / WhatsApp como fuente real (no Manychat); pausa al responder el cliente o cuando el usuario toma el control.
6. Conversión a cotización y venta, con métricas por responsable y canal.

## Operación

Migración: `supabase/migrations/20261109083029_acrm_contacto_compartido.sql`.
Fue aplicada por SQL Editor al proyecto de LR Suite; antes de usar `db push` hay que reconciliar el historial de migraciones con la base existente, que incluye SQL históricos fuera del directorio de migraciones.
La migración no elimina contactos ni cambia la lista de colaboradores autorizados.

La sincronización publica las tablas base (la vista unificada no se publica directamente). Los eventos provocan una nueva lectura bajo RLS. El registro operativo no copia los datos privados del lead.

Para revertir la interfaz, restaurar la versión anterior de `contactos-propios.js` y su referencia en `index.html`; conservar las nuevas tablas para no perder reservas ni auditoría. No retirar la protección con contactos reservados en curso.
