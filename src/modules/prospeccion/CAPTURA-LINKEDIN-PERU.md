# Captura asistida LinkedIn Perú en LR Suite

## Flujo
El botón **Iniciar captura con ChatGPT** abre una búsqueda de personas en LinkedIn y habilita el registro de perfiles en LR Suite. No puede activar una extensión del navegador desde una página web: el usuario debe iniciar ChatGPT en Chrome y autorizar las pestañas de LinkedIn que quiera revisar.

El panel permite introducir un perfil o pegar un arreglo JSON de hasta 25 perfiles preparados con ChatGPT. Todos requieren nombre, apellido, empresa, cargo, ubicación visible que contenga Perú, segmento y URL exacta `linkedin.com/in/`. Los campos no visibles deben omitirse; no introducir correos ni móviles.

Una confirmación explícita del usuario precede al guardado. `lr_pros_registrar_linkedin_peru(jsonb)` escribe en las tablas compartidas bajo controles de acceso de Jorge Luis y Diego. Una traba transaccional basada en la URL canónica evita que dos usuarios inserten el mismo perfil simultáneamente. La importación siempre queda como `pendiente`/`parcial`, con evidencias y revisión humana para promover.

Las búsquedas antiguas en Wikidata dejan de mostrarse y ejecutarse desde esta pantalla, pero sus registros históricos no se borran. No se activa ninguna tarea ni mensaje automático.

## Pruebas mínimas
1. Staging: simulación autenticada Jorge crea; Diego intenta repetir URL y recibe `already_exists`.
2. Rechazar ubicación fuera de Perú, URL diferente de `linkedin.com/in`, usuario no autorizado y captura sin confirmación.
3. Los perfiles se ven en Investigación desde ambas sesiones tras actualizar.
4. No se alteran los otros módulos de LR Suite.

## Limitación
El botón inicia una captura asistida, no un robot que recorre LinkedIn: para descubrir o capturar perfiles automáticamente es necesaria una integración autorizada y una acción del usuario para habilitar el control de Chrome.
