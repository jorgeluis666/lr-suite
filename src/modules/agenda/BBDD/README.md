# BBDD · Agenda con asistente de WhatsApp

Todo vive en el proyecto `brfsipssqfsuoplxxcth` (plan gratuito). `agenda.sql` se ejecuta completo en
Supabase > SQL Editor y es idempotente: se puede repetir sin romper nada.

## Tablas

| Tabla | Qué guarda |
| --- | --- |
| `lr_suite_agenda_config` | Una fila: zona horaria, horario de atención por día, tipos de reunión, duración, granularidad, anticipación mínima, tope diario, feriados, id del calendario de Google, interruptor del asistente y qué modelo conversa y cuál valida. |
| `lr_suite_agenda_estandares` | Una fila: tono, idioma, largo máximo, «siempre», «nunca», límites (p. ej. `descuento_max_pct`), cuándo derivar, qué hace falta antes de agendar y la respuesta segura. |
| `lr_suite_agenda_conocimiento` | Lo que el asistente sabe: servicios, precios, casos, objeciones, preguntas de diagnóstico, FAQ y reglas. |
| `lr_suite_agenda_conversaciones` | Una por teléfono: nombre, estado (`bot` o `humano`), etapa de la asesoría, resumen y si necesita atención. |
| `lr_suite_agenda_mensajes` | El historial de cada chat. `wa_message_id` es único: Meta reintenta los webhooks y así no se contesta dos veces. |
| `lr_suite_agenda_citas` | Las reuniones, con diagnóstico, origen (`asistente` o `equipo`), `google_event_id` y enlace de Meet. |
| `lr_suite_agenda_revisiones` | Por respuesta: borrador, veredicto del filtro, observaciones y lo que se envió. |
| `lr_suite_agenda_solicitudes` | Lo que el asistente no resuelve solo: reprogramar, cancelar o una consulta para el equipo. |
| `lr_suite_agenda_log` | Bitácora de la función (webhook, Claude, validación, Calendar, panel). Alimenta la tira de estado del módulo y se conserva un mes. |

### La regla que evita el peor error

```sql
exclude using gist ((tstzrange(inicio, fin, '[)')) with &&) where (estado = 'confirmada')
```

Dos citas confirmadas no pueden solaparse. Lo garantiza la base, no el código: si dos personas cierran
el mismo hueco a la vez, una recibe `{"ok": false, "motivo": "ocupado"}` y el asistente ofrece otra hora.

## RPC

| Función | Para qué | Quién la usa |
| --- | --- | --- |
| `lr_suite_agenda_huecos(p_desde, p_dias, p_duracion_min)` | Huecos que caben en el horario, respetan anticipación y tope del día y no pisan una cita confirmada. Lo ocupado en Google Calendar lo descarta la Edge Function con free/busy. | Asistente y panel |
| `lr_suite_agenda_reservar(...)` | Reserva atómica. `p_forzar` solo salta el horario de atención (para el equipo); el choque nunca se puede forzar. | Asistente y panel |
| `lr_suite_agenda_mover(p_cita_id, p_inicio, p_duracion_min, p_forzar)` | Cambia la hora y devuelve la cita con su `google_event_id`. | Panel |
| `lr_suite_agenda_cancelar(p_cita_id, p_motivo)` | Marca la cita como cancelada y devuelve el evento a borrar. | Panel |
| `lr_suite_agenda_resumen(p_desde, p_dias, p_chats)` | Una sola lectura por pantalla: citas, conversaciones, solicitudes abiertas, contadores y salud del asistente. | Panel |
| `lr_suite_agenda_chat(p_wa_id, p_limite)` | Conversación, mensajes, citas y revisiones de un número. | Panel |
| `lr_suite_agenda_log_limpiar(p_dias)` | Borra bitácora vieja. La llama la propia función de vez en cuando. | Edge Function |

## Permisos

- RLS activo en las nueve tablas; las políticas solo dejan pasar a `authenticated` que además cumpla
  `public.is_lr_suite_pending_user()` (Jorge Luis y Diego, con email confirmado). `anon` se queda sin
  privilegios de tabla.
- Postgres concede `execute` a `public` en cada función nueva: `agenda.sql` lo retira y lo concede solo
  a `authenticated` (panel) y `service_role` (Edge Function). `lr_suite_agenda_resumen` y
  `lr_suite_agenda_chat` son solo del panel y comprueban la identidad por dentro.
- La `service_role` salta RLS por diseño: es la de la Edge Function y nunca sale del servidor.

## Egress (plan gratuito)

El panel hace una lectura por pantalla: `lr_suite_agenda_resumen` trae la semana y hasta 40
conversaciones (unos pocos KB), y el chat completo solo se pide al abrirlo. El conocimiento, los
estándares y las reglas se leen cuando se abre su vista, no al entrar al módulo.

## Comprobaciones

```sql
-- Dos citas a la misma hora: la segunda debe fallar
insert into public.lr_suite_agenda_citas (inicio, fin, nombre) values (now() + interval '1 day', now() + interval '1 day 30 min', 'Prueba 1');
insert into public.lr_suite_agenda_citas (inicio, fin, nombre) values (now() + interval '1 day', now() + interval '1 day 30 min', 'Prueba 2');

-- Huecos de los próximos 7 días para una reunión de 30 minutos
select * from public.lr_suite_agenda_huecos(null, 7, 30);

-- Lo que ve el panel
select public.lr_suite_agenda_resumen(null, 7, 40);

-- Últimos errores del asistente
select creado_at, origen, evento, detalle from public.lr_suite_agenda_log where nivel = 'error' order by creado_at desc limit 10;
```
