# Prospección en LinkedIn

Módulo del `index.html` (`id: "prospeccion"`) para la prospección en LinkedIn: un
registro por perfil al que la agencia escribe, para no contactar dos veces a la
misma persona y saber a quién ya se le envió la información.

## Qué guarda cada perfil

| Campo                   | Para qué                                                        |
| ----------------------- | --------------------------------------------------------------- |
| `nombre`, `apellido`    | La persona.                                                     |
| `linkedin_url`          | URL del perfil. Es su identidad: no puede repetirse.            |
| `correo`                | Correo de contacto.                                             |
| `web`                   | Web de la empresa.                                              |
| `empresa`, `cargo`      | Dónde trabaja y qué decide.                                     |
| `estado`                | En qué punto va el contacto (ver abajo).                        |
| `notas`                 | Qué se le dijo, qué se le envió, próximo paso.                  |
| `invitacion_enviada_en` | Cuándo se le envió la invitación.                               |
| `info_enviada_en`       | Cuándo se le envió la información.                              |
| `respondio_en`          | Cuándo respondió.                                               |
| `creado_por`            | Cuenta de la Suite que lo agregó.                               |

## Estados

`por_contactar` → `invitacion_enviada` → `conectado` → `info_enviada` →
`respondio` → `reunion` → `cliente`, y `descartado` para el que no va.

El estado se cambia desde la misma tabla. Al pasar a `invitacion_enviada`,
`info_enviada` o `respondio` se sella la fecha del hito **una sola vez**: si ya
tenía fecha, se respeta la primera, porque lo que interesa es cuándo ocurrió, no
cuántas veces se tocó el selector.

Las métricas de arriba leen esas fechas, no el estado actual: un perfil que hoy
es «Cliente» sigue contando como invitación enviada e información enviada.

## Cómo se cargan los perfiles

- **Nuevo perfil**: el formulario con los campos de arriba.
- **Pegar lista**: una línea por perfil, columnas en el orden del formulario
  (nombre, apellido, perfil, correo, web, empresa, cargo). Acepta tabulaciones
  —pegar directo desde una hoja de cálculo— o comas. También acepta una lista
  de puros enlaces. Ignora la fila de encabezados y los perfiles que ya están
  en la lista.
- **Exportar CSV**: la lista completa, para trabajarla fuera.

## El nombre se propone desde el enlace

El nombre real solo lo tiene LinkedIn y el navegador no puede leer el perfil:
LinkedIn pide sesión, bloquea la lectura desde otro sitio y lo prohíbe en sus
términos. Lo que sí trae la URL es el slug —`…/in/ana-rivas-8b4291`—, que casi
siempre es el nombre.

`prospectoNombreDesdeUrl()` lo convierte en nombre y apellido: descarta los
tramos con números (el hash del final) y las iniciales sueltas, y deja el primer
tramo como nombre y el resto como apellido. Devuelve `null` cuando no queda nada
usable (`/in/arivas23`, `/in/`), y entonces los campos se escriben a mano.

Se usa en dos sitios y **nunca pisa lo escrito**, solo llena lo vacío:

- En el formulario, al pegar la URL (y al salir del campo si se tecleó).
- Al pegar una lista, para las filas que traen enlace pero no nombre.

Es una propuesta, no un dato: no acierta con apodos ni con slugs sin nombre, por
eso los dos campos quedan siempre editables.

## Datos

Tabla propia de Supabase: `public.lr_suite_prospectos`
(`BBDD/prospeccion.sql`). No es una fila de `lr_suite_private_data` porque cada
cambio toca un solo perfil: así se escribe una fila y no la lista entera, y las
dos cuentas pueden trabajar a la vez sin pisarse.

La lista se lee al abrir el módulo, no al entrar a la Suite, para no gastar
lecturas en las sesiones que no lo usan.

Ningún perfil vive en el repositorio, que es público.
