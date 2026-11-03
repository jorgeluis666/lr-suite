# Importación incremental de Connections.csv por usuario

En **Prospección → Mi base LinkedIn** cada cuenta autorizada conserva su propio conjunto de contactos. Se trata de espacios de datos separados en el mismo Supabase (RLS por `auth.uid()`), no de dos proyectos ni bases físicas distintas.

## Primer archivo
Solicitar desde LinkedIn la exportación oficial y extraer únicamente `Connections.csv`. No cargar el ZIP completo. La interfaz detecta la cabecera incluso si hay notas previas, muestra una vista previa y permite guardar los contactos. No se almacenan direcciones de correo del CSV ni se conserva el archivo bruto.

## Actualizaciones
Al volver a importar un CSV, `lr_pros_importar_mis_contactos` (lotes de 100 filas) agrega los nuevos, actualiza cambios y deja los demás sin borrar. Un lote repetido es idempotente. Cada cuenta tiene historial propio de cargas y visualización aislada. Los contactos sin URL se identifican tentativamente por nombre+apellido+empresa; los homónimos ambiguos deben revisarse.

## Completar y agregar perfiles
La pestaña **Agregar perfil** permite registrar manualmente una URL `linkedin.com/in/`, el cargo y la ubicación. Solo se marca `peru_verificado` cuando el usuario lo confirma expresamente. El CSV oficial normalmente no certifica la ubicación, así que las nuevas filas empiezan pendientes.

## Seguridad y límites
Los datos privados se guardan en `public.lr_pros_contactos_propios` (RLS por propietario) y el historial en `lr_pros_cargas_propias`. Ninguna cuenta ve los registros de otra, ni puede editar directamente las tablas. La RPC autentica a Jorge o Diego, y no permite al anónimo importar. No hay scraping de LinkedIn, invitaciones, mensajes ni tareas programadas.

Las tablas previas de Investigación compartida y Seguimiento comercial no se modifican. La base personal no se promueve automáticamente a seguimiento.
