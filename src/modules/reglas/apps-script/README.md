# Apps Script · Reglas y Optimización

`Codigo.gs` crea en el Drive de cada marca la subcarpeta **«08 Reglas y Optimización»** con un
Sheet **«Reglas_Nexus_\<Marca\>»**, y lo puebla con los cuatro hitos del Ciclo Mensual de Análisis
y Optimización.

Es la única pieza que escribe en Drive. Leer las reglas no pasa por aquí: lo hace Supabase con
`../BBDD/reglas-nexus.sql`.

## Puesta en marcha

1. [script.google.com](https://script.google.com) → **Nuevo proyecto**. Nómbralo
   `LR Suite · Reglas y Optimización`.
2. Pega el contenido de `Codigo.gs` en el editor, reemplazando lo que traiga por defecto.
3. **Project Settings → Script Properties → Add script property**, dos propiedades:

   | Propiedad    | Valor                                                                 |
   | ------------ | --------------------------------------------------------------------- |
   | `ID_MAESTRO` | El ID del Sheet «Conexiones Drive Dashboard» (lo que va entre `/d/` y `/edit` en su URL). |
   | `TOKEN`      | Una cadena larga al azar. Solo hace falta si vas a desplegar el Web App (ver abajo). |

   Ningún ID va en el archivo: este repositorio es público.

4. En el editor, elige la función **`crearReglas`** y pulsa **Ejecutar**. La primera vez Google
   pide autorizar el acceso a Drive y a Sheets: es el permiso que necesita para crear las carpetas.
5. Abre **Ver → Registro de ejecución**. Dice cuántas hojas creó, cuántas ya existían y qué marcas
   saltó. Una marca aparece saltada cuando su fila del maestro no tiene link de carpeta, o cuando
   la carpeta no se puede abrir con tu cuenta.

Repetir el paso 4 es seguro: lo que ya existe no se duplica y **un valor ajustado a mano no se
pisa**. Solo se agregan los hitos que falten, y los encabezados se reescriben siempre porque son
el contrato con el tablero. Para devolver una marca a los valores de fábrica:
`reponerHitos('Royal Baby')`.

## La hoja que queda

| ID Regla | Semana / Hito                     | Métrica (Trigger) | Operador | Valor | Acción Automática     | Activar IA | Instrucción Estratégica para la IA |
| -------- | --------------------------------- | ----------------- | -------- | ----- | --------------------- | ---------- | ---------------------------------- |
| R_01     | Hito 1: Calibración (Semana 1)    | `dias_mes`        | `<=`     | 7     | `alerta_pacing`       | ✓          | Objetivo: Establecer línea base…   |
| R_02     | Hito 2: Creatividades (Semana 2)  | `dias_mes`        | `<=`     | 14    | `pausar_fatigados`    | ✓          | Objetivo: Evaluar qué comunicación…|
| R_03     | Hito 3: Pivot de Públicos (Sem. 3)| `dias_mes`        | `<=`     | 21    | `alerta_overlap`      | ✓          | Objetivo: Atacar la segmentación…  |
| R_04     | Hito 4: Lift (Semana 4)           | `dias_mes`        | `>`      | 21    | `escalar_presupuesto` | ✓          | Objetivo: Exprimir el presupuesto… |

El orden de las columnas es el contrato con el tablero: si cambia una, hay que cambiarla también
en `../BBDD/reglas-nexus.sql` y en el `index.html`.

**Qué se puede editar por marca** sin tocar el código: el `Valor` (mover el corte de semana),
el `Operador`, la `Acción Automática`, el check de `Activar IA` y, sobre todo, la
`Instrucción Estratégica`. Una marca puede querer que su Hito 3 hable de keywords y otra de
públicos de Meta.

**Qué no conviene cambiar**: el `ID Regla` (es por donde el tablero reconoce la fila) ni la
`Métrica`, mientras el tablero solo sepa evaluar `dias_mes`.

## El Web App (necesario)

Las carpetas «08 Reglas y Optimización» tienen **la herencia de permisos apagada**, para que el
cliente de la marca no vea el método de trabajo de la agencia. Eso deja fuera los dos caminos por
los que Supabase lee Drive normalmente: la vista pública de la carpeta no la abre, y una API key de
Google tampoco, porque **una key no autentica a nadie, solo abre archivos públicos**.

El Web App sí, porque se ejecuta con la cuenta de quien lo despliega. Por eso aquí no es un
respaldo: es el camino.

1. **Implementar → Nueva implementación → Aplicación web**.
2. «Ejecutar como»: **Yo**. «Quién tiene acceso»: **Cualquier persona**.
3. Copia la URL que termina en `/exec`.
4. Pruébala con el token de las propiedades del script:

```bash
curl "https://script.google.com/macros/s/<ID_DE_LA_IMPLEMENTACION>/exec?token=<TOKEN>"
```

Sin token, o con uno distinto, responde `{"error":"sin permiso"}`. La comparación es de tiempo
constante, así que la URL no deja adivinar el token a punta de intentos cronometrados.

5. Guarda la URL y el token en Supabase, en una línea que **no** va al repositorio:

```sql
select public.lr_suite_reglas_set_webapp('<URL_DEL_WEB_APP>', '<TOKEN>') ->> 'lastSync';
```

Cada vez que cambies el código hay que **crear una implementación nueva** (o editar la existente
y subir la versión): la URL `/exec` sirve la última versión implementada, no lo que está en el
editor.

## Qué hace cada función

| Función                | Para qué                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| `crearReglas()`        | Fase 1. Crea carpetas y hojas, y agrega los hitos que falten.                 |
| `reponerHitos(marca)`  | Borra las filas de datos de una marca y repone los cuatro hitos de fábrica.    |
| `barrido()`            | Fase 2. Junta las reglas de todas las marcas y las deja en el registro.        |
| `doGet(e)`             | El barrido como JSON, detrás del token.                                       |
