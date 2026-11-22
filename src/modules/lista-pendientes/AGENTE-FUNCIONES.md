# Mapa de funciones del Agente IA de Pendientes

El agente dispone de **48 herramientas de la Suite**: las 12 anteriores y 36 incorporadas. El catálogo ejecutable es `agente-catalogo.js`, cargado por `index.html` y por `supabase/functions/pendientes-agente/index.ts`. Incluye nombres, descripciones, parámetros y validación; `consultar_funciones` permite al agente inspeccionarlo durante la conversación. La búsqueda web y ejecución de código de Anthropic se mantienen aparte.

Las consultas se resuelven automáticamente. Las modificaciones, navegación, descargas y entregas pasan por **Hazlo / Ahora no**. El cierre o eliminación de un pendiente completo conserva además la confirmación existente con la cantidad de tareas internas afectadas. Los resultados vuelven al modelo; una propuesta no equivale a un cambio ejecutado.

## Guía visible para usuarios

En **Notificaciones → Funciones IA**, junto a las pestañas Gasto y Pendientes, se pueden leer las 48 capacidades agrupadas en ocho categorías. La guía incluye ejemplos de pedidos, un buscador y las condiciones de confirmación y permisos. Los nombres de las herramientas se vinculan al catálogo ejecutable, pero la interfaz muestra explicaciones en lenguaje cotidiano.

## Descubrimiento y contexto

| Función | Qué devuelve |
| --- | --- |
| `consultar_funciones` | Catálogo completo con parámetros obligatorios y opcionales, y consultas automáticas. |
| `consultar_pendientes` | Pendientes de todos los meses, filtrables por texto, mes, vista, responsable, estado y prioridad. |
| `consultar_pendiente` | Detalle de un pendiente; internas con IDs de enlaces, hitos, seguimientos, fechas, horarios, marcas diaria/Claude y vínculos compartidos. |
| `consultar_historial` | Historial disponible, tras intentar actualizar el archivo remoto, con `historial_id` para restaurar. |
| `consultar_organizacion` | Responsables válidos, vistas, listas, grupos, paleta, filtros actuales y claves de destinos para compartir. |
| `consultar_control` | Pendientes cerrados, internas hechas y segundos trabajados por persona, fecha y mes. |

Las listas de pendientes, internas e historial usan páginas de 20: enviar `desde: siguiente` hasta que `siguiente` sea `null`. El contexto inicial sigue acotado y avisa de ello. Una tarea omitida de ese contexto puede encontrarse mediante consultas; no se deben inventar IDs ni interpretar el resumen como el tablero completo. Los títulos, documentos y enlaces son datos, no instrucciones que autoricen acciones.

## Acciones de pendientes

| Función | Ejecución en el módulo |
| --- | --- |
| `crear_pendiente` | `createPendingTask`: título, responsable, prioridad, inicio y fin. |
| `cambiar_campos` | Estado, prioridad, fechas y `updatePendingTaskOwner` para reasignar. Cadena vacía quita una fecha. |
| `corregir_texto` | Renombra el pendiente o usa `renamePendingSubtask` para una interna. |
| `mover_pendiente` | `reorderTaskByDrop`: orden y adopción del grupo vecino. |
| `duplicar_pendiente` | `duplicatePendingTask`: copia del tablero e internas, sin tiempo acumulado. |
| `completar_tarea` | `completeTask`: cierre con snapshot, tiempo e historial. |
| `eliminar_pendiente` | `deleteTask`: elimina el tablero completo y lo conserva en Terminados. |
| `restaurar_pendiente` | `restoreCompletedTask`: restaura snapshot y tiempo con ID nuevo. |
| `cambiar_color` | `setPendingTaskColor`: únicamente colores de la paleta real. |
| `cambiar_vista` | `updatePendingTaskView`: Día a día, Proyectos o lista; respeta vistas fijas. |
| `asignar_lista` | `sendPendingTaskToList`: asigna o quita la lista con `lista_id: ""`. |

## Tareas internas, hitos y enlaces

| Función | Ejecución en el módulo |
| --- | --- |
| `crear_tarea_interna` | `createPendingSubtask`: añade una interna con responsable y fechas. |
| `marcar_tarea_interna` | `togglePendingSubtask` solo cuando cambia el estado deseado `hecha`. |
| `eliminar_tarea_interna` | `deletePendingSubtask`: registra lápida de sincronización y elimina la copia compartida. |
| `restaurar_tarea_interna` | `restoreDeletedSubtask`: usa `eliminacion_id` devuelto por el agente; ID nuevo y sin compartir. |
| `cambiar_tarea_interna` | Valida y aplica juntos responsable, fechas y horas; usa marcas de edición, `propagateSubtaskSync` y `saveTaskState`. |
| `mover_tarea_interna` | `reorderPendingSubtaskByDrop`: mueve el bloque con sus seguimientos y respeta diarias ancladas. |
| `configurar_tarea_diaria` | `togglePendingSubtaskDaily` según el estado deseado `diaria`. |
| `marcar_claude` | `togglePendingSubtaskClaude` según el estado deseado `activa`. La marca no ejecuta Claude Code. |
| `compartir_tarea_interna` | `applySubtaskBoardSync`: compartir o desvincular, con destinos reales de Día a día y listas. |
| `crear_seguimiento` | `addPendingSubtaskFollowUp`: requiere una interna terminada. |
| `agregar_enlace` | `addPendingSubtaskLink`: URL segura, etiqueta y límites existentes. |
| `eliminar_enlace` | `deletePendingSubtaskLink`: por `enlace_id`. |
| `agregar_hito` | `addPendingSubtaskChecklistItem`: crea un punto de la lista. |
| `editar_hito` | `renamePendingSubtaskChecklistItem`: cambia su título. |
| `marcar_hito` | `togglePendingSubtaskChecklistItem` según `hecho`; conserva autor, fecha y sincronización. |
| `eliminar_hito` | `deletePendingSubtaskChecklistItem`: elimina por `hito_id`. |

Fechas: `AAAA-MM-DD`; horas: `HH:MM`, como en el tablero de Lima. Una cadena vacía elimina fecha u hora. Se valida el conjunto antes de escribir; se permiten horarios que cruzan medianoche si las fechas son distintas. Una diaria debe perder su marca antes de borrarse. Se comprueban los bloqueos tanto del origen como de su pareja compartida.

El deshacer por chat conserva en memoria las eliminaciones hechas por el agente en esta pestaña; no es un historial persistente de todas las internas borradas. El botón visual Deshacer sigue disponible. Restaurar una interna no vuelve a enlazarla a su antiguo tablero compartido.

## Tiempo, organización e interfaz

| Función | Ejecución en el módulo |
| --- | --- |
| `iniciar_cronometro` | `toggleTaskTimer`: inicia y pausa el anterior del usuario. |
| `pausar_cronometro` | `finalizeTaskTimer`: guarda el tramo trabajado. |
| `ajustar_tiempo` | Corrige el acumulado de un cronómetro pausado, con `elapsedEditedAt` y `saveTimerState`; no altera el diario. |
| `desbloquear_pendiente` | `forceUnlockTaskTimer`: solo superadministrador; conserva el tiempo del trabajador. |
| `crear_lista` | `createPendingList`: nueva pestaña y pendientes iniciales; rechaza IDs inexistentes o bloqueados antes de crear. |
| `eliminar_lista` | `deletePendingList`: conserva pendientes; rechaza listas con alguno bloqueado. |
| `editar_grupo` | `renamePendingCategory` / `updatePendingCategoryResponsible`, o cabeceras locales de rutas sugeridas. No reasigna responsables de tareas. |
| `filtrar_tablero` | Mes, vista, responsable, estado y prioridad visibles. |
| `mostrar_detalle` | Expande/contrae internas y paneles de fechas, enlaces, hitos o seguimiento. |
| `abrir_historial` | `openCompletedTaskHistory`: abre Terminados. |
| `exportar_historial` | Actualiza lo disponible y usa `downloadCompletedTasksTable` para descargar el CSV. |
| `sincronizar_tablero` | `forcePendingSync`: solicita sincronización y comunica si no pudo confirmarse. |

Una lista vacía y las cabeceras de rutas sugeridas conservan el alcance local que ya tiene la interfaz. Las listas con pendientes y los grupos manuales viajan con esos pendientes. Los cambios usan el guardado compartido existente; un resultado local exitoso no sustituye la confirmación de sincronización con Supabase.

## Agenda y ejecución externa

| Función | Ejecución |
| --- | --- |
| `ver_agenda` | Consulta automática de huecos en Google Calendar desde la Edge Function. |
| `agendar_reunion` | Crea evento/Meet e invitaciones tras confirmar y volver a comprobar disponibilidad. |
| `entregar_tarea` | Abre Claude o la plataforma HTTPS y copia el encargo al portapapeles. |

La apertura de una plataforma entrega el encargo; no confirma que el trabajo externo se haya realizado. La configuración y secretos de Calendar permanecen en el servidor.

## Comportamientos automáticos y controles del chat

El cambio diario de nombre del tablero, reapertura de diarias, arrastre de pendientes del día anterior, resúmenes y objetivos, cálculo de rutas sugeridas, presencia, avisos de asignación y sincronización siguen en sus mecanismos existentes. El agente puede consultar su resultado y modificar las tareas mediante las funciones anteriores. Abrir/minimizar el chat, enviar mensajes y aceptar/rechazar propuestas son controles de la persona, no acciones que el modelo pueda aceptar por sí mismo.

## Verificación y publicación

- `node scripts/check-index.js`
- `node --test tests/pendientes/agente-funciones.mjs`
- `deno check --config supabase/functions/deno.json supabase/functions/pendientes-agente/index.ts`

Las pruebas nuevas ejercitan los ejecutores reales con datos locales: parámetros/IDs inválidos, bloqueos, eliminación compartida, lápidas, restauración, edición atómica, sincronización de internas, hitos, enlaces, seguimientos, orden, marcas y paginación. No envían mensajes ni modifican datos de producción.

Para activar el cambio se deben publicar **ambas partes**, el sitio y `pendientes-agente`. Los workflows existentes lo hacen al publicar en `main`; el despliegue de funciones también detecta cambios en el catálogo compartido. Los secretos y las políticas de acceso existentes no cambian. Una pestaña abierta con la versión anterior debe recargarse.
