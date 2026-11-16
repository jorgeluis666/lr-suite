# Supervisor del ingreso: inventario y primera integración

## Lo que existe y se reutiliza

El módulo Agentes IA ya dispone del catálogo `lr_suite_agente`, recursos y marco de indicadores, RPCs para ficha/alta y registro `lr_suite_agente_uso`. El supervisor utiliza esas mismas piezas con clave `supervisor`; no crea un segundo catálogo, registro de tokens, tabla de precios ni editor de prompts. La función compartida `registrarUso` conserva su comportamiento de no interrumpir llamadas existentes y ahora devuelve si pudo guardar el recibo.

El bot de WhatsApp existente tiene webhook firmado, idempotencia por mensaje, historial, revisión de estándares, derivación humana y registro en ACRM. El módulo Agenda aporta el panel y Google Calendar. No se duplica ese webhook ni se conecta al supervisor para enviar mensajes. La revisión del repositorio `jorgeluis666/agentelr` encontró una página de cortesía y CNAME: la app comercial multiempresa no está implementada en ese repositorio. Los planes privados y cambios no publicados en otros chats no están incluidos en este inventario.

El bot revisado trabaja con configuración de la agencia, no con un canal aislado por cada ficha de cliente. El módulo Agentes IA actual es principalmente configuración y observabilidad: no es por sí solo un sistema de presupuestos con límites duros. El interruptor del catálogo era informativo para agentes anteriores; el nuevo supervisor sí verifica `activo` antes de cualquier llamada al modelo. No cambia el comportamiento de los demás agentes.

## Integración con Clientes

En la ficha guardada aparecen **Revisar checklist · Sin IA**, **Pedir recomendaciones IA** y **Configurar en Agentes IA**. La última acción abre la ficha existente o prepara el formulario de alta ya disponible, con clave y función sugeridas. No guarda ni sobrescribe un agente automáticamente. El modelo debe elegirse en el catálogo.

`clientes-supervisor` acepta únicamente clave de cliente, versión leída y modo. Comprueba la sesión con getUser y lee la ficha usando el JWT del solicitante y las políticas RLS actuales. Una selección vacía no acredita acceso. La petición no admite payloads de ficha, prompts o nombres de modelo enviados por el navegador. Una versión obsoleta devuelve conflicto antes de gastar tokens.

Las reglas comprueban campos pendientes, responsables, etapas bloqueadas, falta de evidencia, activación prematura y antigüedad. No modifican la ficha, no crean tareas ni conceden permisos. No hay ejecución periódica ni historial adicional en esta entrega: el resultado se muestra en la ficha y se invalida visualmente al editarla.

La revisión IA hace una única llamada, sin reintentos automáticos y con un máximo de 1.200 tokens de salida. Reutiliza recursos y marco del agente, limitados a 8.000 caracteres adicionales. El contexto de cliente enviado al modelo contiene estados y acciones normalizadas: excluye contacto, nombre, IDs de cuentas y notas libres. El material que el equipo carga explícitamente en Agentes IA mantiene su comportamiento existente.

Cada llamada utiliza el recibo compartido, con agente `supervisor`, usuario de la sesión y `llamada = ingreso-<primeros 16 hex de SHA-256(clave del cliente)>`. Esto permite correlacionar revisiones sin añadir columnas ni publicar identidades. El panel agrega costo y tokens como para cualquier agente. Si el recibo falla, la respuesta avisa de que la llamada sí se realizó. No se promete un presupuesto diario duro ni protección frente a llamadas concurrentes desde múltiples dispositivos.

## Cobertura pendiente para supervisión end-to-end

La evidencia actual es la ficha guardada. El supervisor **no consulta Nexus automáticamente** ni toma el bot de la agencia como prueba de WhatsApp para un cliente. Siempre muestra esa limitación. Cuando el servicio incluye WhatsApp/AgenteLR señala la falta de vínculo verificado del canal. Una etapa marcada completa por una persona no se convierte en certificación técnica.

Para ampliar la cobertura se requiere un contrato de identidad y lectura autenticada, por cliente, del diagnóstico de Nexus, del canal WhatsApp y de la actualización del tablero. También falta validar el aislamiento multiempresa de AgenteLR antes de ofrecerlo a clientes externos. Se debe añadir esa evidencia al supervisor existente, no crear otro agente, otro CRM o duplicar el flujo de Agenda.

## Publicación y validación

No hay migración ni cambio de RLS. La función nueva se despliega explícitamente mediante el workflow existente «Desplegar funciones de Supabase», opción clientes-supervisor. No se añade al despliegue automático ni se publica el webhook de WhatsApp por este cambio. Necesita los secretos actuales de Supabase/Anthropic y PANEL_ORIGEN de LR Suite.

Después de desplegar: probar que una sesión no autorizada y un cliente invisible no ejecutan el modelo; revisar una ficha de prueba autorizada en modo reglas; configurar supervisor mediante Agentes IA; ejecutar una recomendación y comprobar su recibo en el mismo panel. No ejecutar esa prueba con conversaciones de WhatsApp ni mensajes reales. Las pruebas automatizadas usan dependencias simuladas y no consumen API.
