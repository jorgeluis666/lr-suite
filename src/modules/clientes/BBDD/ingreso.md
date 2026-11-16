# Persistencia de fichas de ingreso

Se reutiliza la tabla privada existente `lr_suite_private_data`, con una fila por cliente: `key = cliente-ingreso:<clave del catálogo>`. No se añaden tablas, grants, políticas, RPCs ni seeds de clientes. RLS sigue usando `is_lr_suite_pending_user()` para lectura, inserción y actualización; un usuario simplemente autenticado no obtiene acceso por este cambio.

`payload` versión 1 contiene nombre, responsable, contacto, servicios, objetivos, módulos, referencias manuales al espacio y cuentas de Nexus, y un checklist indexado por alta/accesos/configuracion/validacion/activacion/seguimiento. Cada etapa guarda estado, responsable y nota de evidencia. Todos los campos tienen límites de longitud. El estado no representa un permiso ni una certificación automática. La validación de la interfaz no es una barrera de seguridad frente a miembros autorizados que escriben directamente en la tabla.

Las filas nuevas se insertan, nunca se sobrescriben por upsert. Una colisión muestra un conflicto. Las actualizaciones comparan `key` y el `updated_at` exacto leído y exigen una fila devuelta; una pestaña obsoleta conserva el formulario y pide recargar. No se reescribe el catálogo completo ni las claves de carpetas o archivado. Cada guardado avanza el timestamp incluso en el mismo milisegundo.

La lectura filtra por prefijo, solicita solo key/payload/updated_at y limita a 501 filas para detectar que se necesita paginación por encima de 500 fichas. Las fichas no se guardan en localStorage, archivos públicos ni Git. No se permite borrado desde esta interfaz. El archivado sigue siendo el existente del directorio.

Comprobación en un entorno autorizado: leer una ficha, guardar un cambio, volver a leerlo; abrir dos sesiones con la misma versión, guardar en una y verificar conflicto en la otra; comprobar que el rol anónimo no puede leer la tabla. No ejecutar seeds ni escrituras sintéticas contra producción para probarlo. El historial de cambios y una identidad interoperable entre plataformas quedan fuera de esta primera entrega.
