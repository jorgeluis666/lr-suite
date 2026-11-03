# Prospección: búsquedas incrementales (v2)

## Cambio principal
Se elimina el límite experimental de cinco empresas por barrido. El sistema solicita una página de resultados de la fuente autorizada y registra automáticamente los candidatos nuevos en Investigación. Se sigue conservando la revisión humana de los cargos y personas.

## Funcionamiento
1. El usuario autorizado elige Retail/e-commerce o Servicios/leads y, opcionalmente, un rubro.
2. `lr_pros_barrido_estado` consulta el cursor y los totales compartidos por segmento/palabra clave.
3. La Edge Function `lr-pros-descubrir` consulta el siguiente bloque de la fuente disponible y excluye empresas idénticas ya registradas por nombre normalizado + dominio. No fusiona empresas solo por dominio.
4. `lr_pros_importar` incorpora automáticamente a Investigación los nuevos resultados, junto con sus evidencias y estatus pendientes de revisión. Reimportaciones no crean duplicados por lote.
5. `lr_pros_barrido_avanzar` avanza el cursor únicamente al completar la importación, conserva acumulados y audita el usuario.
6. Cada nuevo barrido continúa explorando hasta agotar la fuente, tras lo cual vuelve al inicio para descubrir futuras novedades. Esto **no garantiza** resultados nuevos en cada intento.

## Límites y seguridad
- El sistema no usa sesiones de LinkedIn ni realiza scraping de perfiles. No existe un límite numérico de "5" derivado de políticas de LinkedIn.
- Wikidata opera con páginas de 32 resultados y timeout de 16 s; Brave Search, cuando exista una API key legítima, trabaja con páginas de 20. Son límites operativos del proveedor por solicitud, no un techo del total acumulado.
- Se respeta cualquier `429`/cuota y se muestra el motivo del error en el panel. No se activan crons ni mensajes.
- Los nombres o cargos importados son preliminares y la promoción requiere confirmación humana documentada.

## Orden de despliegue
- Aplicar `src/modules/prospeccion/BBDD/prospeccion-barridos-v2.sql` en staging/producción antes de publicar la interfaz.
- Desplegar la Edge Function y verificar permisos RLS/RPC.
- Publicar la UI siguiendo los estilos existentes de LR Suite.

## Pruebas
- Simular dos cuentas autorizadas y un usuario denegado.
- Barrido inicial cursor 0, avance 32, nuevo barrido cursor 32; una importación repetida no altera datos existentes.
- Verificar que un fallo de búsqueda no avanza el cursor y que los resultados registrados quedan en Investigación.
- Comprobar regresiones de Seguimiento comercial y presentación móvil.
