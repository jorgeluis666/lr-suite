# Prospección · «Todos» (lista unificada por equipo)

La interfaz de Prospección elimina los dos niveles de navegación anteriores, los paneles de métricas y el filtro «Solo Perú confirmado». Presenta un listado único «Todos», con tres acciones auxiliares que siguen siendo necesarias: **Cargar CSV**, **Agregar perfil** e **Historial de cargas**.

## Lectura compartida con permisos
- Las importaciones siguen guardándose por usuario en `lr_pros_contactos_propios` y se actualizan incrementalmente mediante `lr_pros_importar_mis_contactos`. No se borran datos anteriores.
- `lr_pros_contactos_unificados` es una vista `security_invoker` que muestra perfiles distintos por URL canónica de LinkedIn. Cuando dos aportantes incorporan la misma URL, se ve una ficha con `aportado_por` indicando sus nombres.
- Si una exportación no contiene URL, se usa la clave nombre+apellido+empresa registrada para una coincidencia tentativa. No se fusionan nombres sin identidad confiable entre campos diferentes.
- `lr_pros_colaboradores` mantiene una lista de participantes con cuentas Supabase **confirmadas**. Inicialmente Jorge Luis y Diego. Solo un miembro administrador puede dar acceso a otra cuenta existente con `lr_pros_autorizar_colaborador(email,nombre)`.
- La vista y las tablas aplican RLS y no permiten acceso `anon`; los demás módulos y sus políticas permanecen intactos.

## Administración de nuevos usuarios
Antes de que un usuario futuro pueda aportar contactos, su cuenta debe estar creada y confirmada, tener acceso a LR Suite, y un administrador debe habilitarla mediante `lr_pros_autorizar_colaborador`. No se permite que cualquier usuario autenticado desconocido vea la cartera comercial.

## Pruebas
- En staging se simularon aportes de Jorge y Diego: dos contactos idénticos por URL aparecen como una sola ficha, indicando ambos aportantes.
- La vista se consultó con ambas cuentas; no se muestra ningún contacto a un usuario sin permiso.
- Las inserciones siguen asignadas al `auth.uid()` real y el historial de cargas sigue restringido al propietario.
- El aspecto conserva tipografías, botones, bordes y colores de LR Suite.

La funcionalidad no envía invitaciones, mensajes ni extrae datos de LinkedIn automáticamente.
