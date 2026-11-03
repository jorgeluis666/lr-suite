# Seguimiento comercial en «Todos»

Cada contacto tiene una ficha compartida y un historial de mensajes enviados. El botón **Gestionar** permite:

- Registrar fecha de envío, canal y tema/resumen. No envía mensajes.
- Cambiar el estado comercial y programar el próximo contacto.
- Clasificar la empresa como E-Commerce, Servicios, ambos, otro o sin clasificar.
- Registrar una cantidad de trabajadores verificada, con fuente y fecha obligatorias. Vacío significa desconocido, no cero. Son datos de la empresa de esa ficha; no se propagan por coincidencias de nombre a otras empresas/contactos.

Los filtros operan en Supabase antes de paginar. E-Commerce y Servicios incluyen la categoría «ambos». El filtro de seguimientos pendientes incluye hoy y fechas vencidas (America/Lima), excepto clientes y descartados. La tabla muestra número de mensajes, último envío y próxima fecha; el detalle muestra los 200 mensajes más recientes. El contador no tiene ese límite.

## Activación

1. Tener aplicada `BBDD/prospeccion-contactos-equipo-unificados.sql` y sus prerrequisitos (no volver a ejecutar ese script antiguo si ya está aplicado).
2. Ejecutar `BBDD/prospeccion-seguimiento-v1.sql` en el SQL Editor del proyecto Supabase correspondiente. La nueva migración sí admite repetición.
3. Publicar `index.html`, `contactos-propios.js` y `investigacion-integrada.css` juntos después de la migración. Sus versiones de caché se actualizaron.
4. Comprobar con dos colaboradores autorizados que una ficha y un mensaje guardados por uno sean visibles al otro. Probar también que un usuario no autorizado no pueda consultarlos ni escribir.

No se ha aplicado esta migración a producción desde el entorno de desarrollo. No se configuró un proveedor externo de enriquecimiento: las cifras requieren una fuente aportada por el usuario. Tampoco se migró automáticamente el seguimiento antiguo de `lr_suite_prospectos`.

## Persistencia y permisos

`lr_pros_fichas` y `lr_pros_mensajes` son independientes de las cargas CSV. La identidad es la URL canónica de LinkedIn o, cuando no existe, la clave tentativa nombre/apellido/empresa. El cambio de fila representante entre dos aportantes de la misma URL no cambia el seguimiento. No cambiar una identidad tentativa a URL sin reconciliar primero su seguimiento: son identidades diferentes.

La escritura pasa exclusivamente por `lr_pros_guardar_seguimiento`, que verifica permisos y existencia del contacto. RLS restringe lecturas a colaboradores autorizados. Los envíos se agregan individualmente, registran al usuario real y usan un UUID para permitir reintentos sin duplicación. Una carga CSV no sustituye el historial. La edición de la ficha usa el último guardado; no bloquea ediciones simultáneas.

## Verificación local

Las pruebas usan PostgreSQL embebido (PGlite) y DOM simulado (jsdom), sin cuentas ni datos reales:

```sh
npm install --prefix /tmp/pros-validation --no-audit --no-fund @electric-sql/pglite@0.5.15 jsdom@30.1.3
NODE_PATH=/tmp/pros-validation/node_modules node scripts/prospeccion/seguimiento.test.cjs
node --check src/modules/prospeccion/contactos-propios.js
npx --no-install eslint src/modules/prospeccion/contactos-propios.js
```

Cubren migración repetible, permisos, validación de fuente, registro idempotente, filtros enviados al servidor, guardado desde la interfaz y escape de contenido. No sustituyen la comprobación con PostgREST y sesiones reales tras desplegar.

## Despliegue automatizado

`scripts/prospeccion/deploy.py` comprueba acceso y configuración de Pages, aplica la migración mediante la API administrativa de Supabase, verifica esquema/permisos y recién entonces hace push del commit a `main`. Comprueba que los tres archivos publicados coincidan por SHA-256. Se detiene si Pages usa otra configuración, si el árbol no está limpio o si el remoto contiene cambios no integrados.

Requiere `SUPABASE_ACCESS_TOKEN` mediante configuración segura del entorno, autenticación existente de Git/GitHub y acceso a `api.supabase.com`, `api.github.com`, `github.com` y `jorgeluis666.github.io`. Nunca guardar el token en el repositorio.

```sh
python3 scripts/prospeccion/deploy.py          # comprobar accesos
python3 scripts/prospeccion/deploy.py --apply  # migrar y publicar
```

Este automatismo está preparado, pero no se ha ejecutado contra producción por falta de credencial administrativa y permisos de red activos. Las pruebas con una sesión real de LR Suite requieren una cuenta de prueba autorizada; no se reutilizan contraseñas ni sesiones extraídas de otros usuarios.
