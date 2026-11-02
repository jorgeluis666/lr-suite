# BBDD · CRM

`crm.sql` crea el CRM de la fase 1 y hace la primera sincronización. Se ejecuta completo en
Supabase > SQL Editor y es idempotente.

Requisitos (el script para con el nombre del que falte): `is_lr_suite_pending_user()`,
`lr_suite_private_data`, `lr_suite_prospectos`, las tablas de la Agenda y `mc_leads`.

## Cómo reconoce a la misma persona

Por cualquiera de tres datos, normalizados para que el mismo dato escrito de dos formas coincida:

| Dato     | Normalización                                                             | Ejemplo                      |
| -------- | ------------------------------------------------------------------------- | ---------------------------- |
| Teléfono | Solo dígitos, con código de país (el formato del `wa_id`). Un celular de 9 dígitos que empieza en 9 recibe el 51. Menos de 10 dígitos no se usa. | `+51 987 654 321` → `51987654321` |
| Correo   | Minúsculas, sin espacios; lo que no parece correo no se usa.              | `ANA@Empresa.pe ` → `ana@empresa.pe` |
| LinkedIn | Solo el tramo del perfil.                                                 | `https://www.linkedin.com/in/Ana-P/?locale=es` → `in/ana-p` |

Un registro sin ninguno de los tres no se puede cruzar y queda en `lr_suite_crm_sin_identidad`.

**Nunca fusiona sola a dos personas.** Si un registro tiene el teléfono de un contacto y el correo de
otro, se vincula al más antiguo y el par queda en `lr_suite_crm_duplicados` para que alguien decida.

## Tablas

Solo se leen desde el panel (RLS con `is_lr_suite_pending_user()`); se escriben con las funciones.

| Tabla                      | Qué guarda                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `lr_suite_crm_contactos`   | Una fila por persona. Solo el id: nombre, empresa, etapa y origen se calculan de sus registros, así no hay dos versiones del mismo dato. |
| `lr_suite_crm_identidades` | Qué teléfono, correo o perfil es de quién. Clave `(tipo, valor)`: un dato, una persona. |
| `lr_suite_crm_vinculos`    | Qué registro de cada fuente (`fuente`, `fuente_id`) es de quién.           |
| `lr_suite_crm_duplicados`  | Pares de contactos que parecen la misma persona: `pendiente` o `distintos`. |

## Vistas (solo lectura, `security_invoker`)

| Vista                                | Para qué                                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| `lr_suite_crm_toques`                | Las cinco fuentes con las mismas columnas. Es lo que lee la sincronización. |
| `lr_suite_crm_contactos_360`         | La ficha: nombre, empresa, datos, origen, etapa, fuentes, montos cotizado y ganado, si tiene un duplicado pendiente. |
| `lr_suite_crm_actividades`           | La historia de cada contacto: registros, hitos de Prospección y contactos anotados en Prospección y Cotizaciones. |
| `lr_suite_crm_embudo`                | Contactos y montos por etapa y origen.                              |
| `lr_suite_crm_sin_identidad`         | Registros que no se pudieron cruzar: se completan en su módulo.     |
| `lr_suite_crm_duplicados_pendientes` | Las sospechas por revisar, con nombre, empresa y fuentes de cada lado. |

Con `security_invoker`, quien abre la vista pasa por el RLS de cada fuente; sin él, la vista correría
con los permisos de su dueño y saltaría el RLS.

## Funciones

| Función                                    | Qué hace                                                       |
| ------------------------------------------ | -------------------------------------------------------------- |
| `lr_suite_crm_sincronizar()`               | Cruza todo y devuelve un JSON con lo que hizo. Se puede repetir: lo ya vinculado no se toca. Suelta los vínculos de registros borrados y borra los contactos que se quedan sin ninguno. |
| `lr_suite_crm_fusionar(queda, sale)`       | Pasa todo de `sale` a `queda` y borra `sale`.                  |
| `lr_suite_crm_distintos(a, b)`             | Cierra la sospecha: no se vuelve a preguntar.                  |
| `lr_suite_crm_etapa(fuente, estado)`       | La tabla de equivalencias de etapas (ver `../README.md`).      |

Las tres primeras corren desde el SQL Editor, con `service_role` o desde el panel con una cuenta de
la Suite (`lr_suite_crm_puede()`); a cualquier otra le responden «Sin permiso».

## Validar los cruces

```sql
-- Volver a cruzar (después de cargar leads, prospectos o cotizaciones nuevas).
select public.lr_suite_crm_sincronizar();

-- Las fichas, las de más fuentes primero: ahí se ve si el cruce funciona.
select nombre, empresa, telefono, correo, origen, etapa, fuentes, monto_cotizado
from public.lr_suite_crm_contactos_360
order by registros desc, ultimo_movimiento_at desc;

-- La historia de una persona.
select fecha, fuente, tipo, detalle
from public.lr_suite_crm_actividades
where contacto_id = '<id>'
order by fecha;

-- El embudo.
select * from public.lr_suite_crm_embudo order by etapa_orden, origen;

-- Lo que falta: registros sin datos para cruzar y sospechas por decidir.
select * from public.lr_suite_crm_sin_identidad;
select * from public.lr_suite_crm_duplicados_pendientes;

-- Decidir una sospecha.
select public.lr_suite_crm_fusionar('<id que queda>', '<id que sale>');
select public.lr_suite_crm_distintos('<id a>', '<id b>');
```

En esta fase la sincronización es a pedido: se vuelve a correr cuando se quiera ver lo último. La
automática (triggers o pg_cron) es la fase 3.

## Probado

Contra Postgres 16 con las tablas reales de Prospección y Agenda y datos de prueba: una persona en
cuatro fuentes queda en un solo contacto con su historia completa, la URL de LinkedIn con
parámetros y el correo en mayúsculas cruzan, un registro con el teléfono de uno y el correo de otro
queda como duplicado pendiente (y se fusiona bien), la segunda corrida no crea nada, al borrar una
fuente se borra su contacto, y una cuenta con sesión que no es de la Suite ve cero filas y no puede
sincronizar ni fusionar.
