# Prospección · Búsqueda integrada (propuesta de despliegue)

La búsqueda es el objetivo principal. Dentro del único módulo **Prospección** se incluyen las vistas **Investigación y búsqueda** y **Seguimiento comercial**.

## Estado de proveedores

- Inicial: **Wikidata Query Service**. Permite descubrir un grupo limitado de empresas peruanas con web y, cuando existe, un nombre de CEO publicado. No es una búsqueda exhaustiva para empresas pequeñas ni valida vigencia de cargos. Nunca fabrica URLs de LinkedIn ni correos.
- Ampliación prioritaria: un proveedor de búsqueda web autorizado (Brave Search API u otro) con clave secreta administrada en Supabase, nunca en GitHub. Debe buscar primero empresas por rubro y luego gerentes por nombre y cargo, contrastando con sitios corporativos. LinkedIn no admite uso indiscriminado de su API para obtener perfiles ajenos.
- No ejecuta scraping, invitaciones, mensajes, cron ni procesos de evasión.

## Arquitectura de ejecución

La función de Supabase `lr-pros-descubrir` valida un JWT real de usuario confirmado y permitido. La vista del navegador ejecuta `supabase.functions.invoke` y recibe candidatos no verificados, con fuentes y ficha preliminar. El usuario pulsa **Registrar en Investigación** y se llama a `lr_pros_importar`. Ningún registro pasa al seguimiento sin revisión y promoción explícita.

**Bloqueo de publicación:** la base de producción debe disponer de siete tablas `lr_pros_*`, sus políticas RLS y las tres funciones RPC, según la migración `prospeccion-investigacion-v1.sql` del paquete entregado previamente. No publicar únicamente el frontend. Confirmar autenticación, importar desde ambas cuentas, reversibilidad y deduplicación en staging antes de aprobar la migración/merge a producción.

## Prueba de aceptación

1. Búsqueda Retail y Servicios; verificar que se devuelven fuentes reales y no haya información inventada.
2. Guardar lote; comprobar errores por fila, idempotencia, procedencia y score conservador.
3. Verificar que las mismas empresas no se fusionan solo por dominio y que personas sin URL no se fusionan solo por nombre.
4. Revisar/validar; promover únicamente responsable verificado y conservar contactos anteriores.
5. Comprobar con ambas sesiones oficiales, con anon y sin usuario denegados, en móvil y escritorio.
6. Desplegar primero la Edge Function y la migración, después el frontend. Mantener copia de seguridad y procedimiento de rollback.
