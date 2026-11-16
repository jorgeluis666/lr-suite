# Clientes: ficha e ingreso

Clientes conserva su catálogo, mapa de conexiones, carpetas, archivado y automatización. La pestaña **Ficha e ingreso** añade responsable, contacto, objetivos, servicios, módulos y un checklist de seis etapas dentro del mismo módulo. Cada tarjeta existente abre su ficha. Las fichas nuevas se incorporan al directorio sin requerir un repositorio o tablero previamente publicado.

El identificador de un cliente existente es la clave del primer proyecto de su grupo, igual que el mapa actual; varios proyectos de una marca no crean varias fichas. Los clientes nuevos reciben una clave estable derivada del nombre normalizado. El nombre de la ficha existente no es editable para evitar romper la asociación. Si se cambia una clave del catálogo en código, debe revisarse la asociación antes de publicarlo.

Los estados son revisiones explícitas del equipo: pendiente, en curso, bloqueado, completo y no aplica. Completo, bloqueado y no aplica exigen una evidencia o motivo. Cerrar el alta requiere responsable, objetivos y servicios; completar activación requiere resolver las etapas previas. El checklist no concede permisos, no publica tableros y no confirma automáticamente conexiones.

El diagnóstico de Nexus se abre en su sesión propia. La ficha permite anotar el espacio de trabajo y los IDs de cuentas; esta primera versión no sincroniza identidades entre aplicaciones ni copia el catálogo comercial `clients` de Nexus. Esas referencias no deben contener contraseñas ni tokens.

La persistencia reutiliza `lr_suite_private_data` y sus permisos actuales. No necesita migración ni una segunda tabla de clientes. El contrato, concurrencia y comprobaciones están en `BBDD/ingreso.md`. La interfaz se carga desde `ingreso.js` y `ingreso.css`, con versión en las URLs de los assets.

Validar con `node scripts/check-index.js` y `node --test tests/clientes-ingreso.cjs`. Antes de publicar, comprobar con una sesión autorizada la lectura y el guardado en Supabase; las pruebas locales usan datos sintéticos y no crean clientes reales.
