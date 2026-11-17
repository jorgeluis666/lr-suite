# Análisis de Palabras Clave

Módulo del `index.html`. Muestra el comportamiento de las palabras clave de Google Ads **por marca y por
campaña**, mes a mes, a partir de los informes guardados en Google Drive.

Una **marca** es una cuenta de Google Ads con su carpeta de informes. Quien la llena es Nexus, que es lo
único que habla con la API de Google Ads: dar de alta una marca aquí es registrar en Supabase el id de la
carpeta donde Nexus deja su informe mensual de palabras clave. Como solo hay palabras clave en las campañas
de búsqueda, el módulo muestra todas las campañas de Google Search de esa cuenta y ninguna otra.

## Archivos

- `keyword-report.js`: lector de los informes y configuración (`CONFIG.excludeCampaigns`). Es **el mismo
  archivo** para el navegador (el `index.html` lo carga con `<script src>`) y para Node (`require`), así
  ambos interpretan los informes igual.
- `sync-keywords.mjs`: script de Node para leer la carpeta, verificar cada mes contra su fila de totales y
  revisar los datos en local.
- `BBDD/sincronizacion-drive.sql`: sincronización diaria en Supabase (pg_cron) y RPC del botón "Actualizar".
- `BBDD/README.md`: filas que se guardan en `lr_suite_private_data`.
- La interfaz (`keywordsModule()` y funciones `keyword*`) y sus estilos (`.keywords-*`) viven en el
  `index.html`, como el resto de módulos.

## Fuente

Una carpeta de Drive **por marca**, compartida como "Cualquier persona con el enlace: Lector", con un
informe por mes (`<Marca> Google Ads <Mes> <Año>` o el nombre que use su destino en Nexus, como hojas de
Google Sheets; también se aceptan CSV). Nexus comparte así lo que él mismo creó, que es el caso de casi
todas estas carpetas.

**Los ID de las carpetas no están en el repositorio** (es público): se guardan en Supabase al dar de alta
cada marca (`lr_suite_keywords_set_marca`). Quien tenga uno puede leer todos los informes de esa cuenta.

La cuenta de la agencia es la marca `lima-retail`: conserva la clave `keywords` de siempre, porque de ella
sale la inversión mensual en Google Ads de Pérdidas y Ganancias. Las demás guardan en `keywords:<id>`.

## Formato del informe

"Informe de palabras clave de búsqueda" exportado de Google Ads:

1. Fila 1: título. Fila 2: rango de fechas ("1 de septiembre de 2026 - 30 de septiembre de 2026").
2. Fila 3: encabezados. Esta cuenta exporta: Estado de palabras clave, Palabra clave, Tipo de concordancia,
   Campaña, Grupo de anuncios, Estado, Motivos del estado, URL final, Impr., Clics, Código de moneda,
   Prom. CPC, CTR, Costo, Nivel de calidad, CTR prev., Exp. en página de destino, Relevancia del anuncio,
   Porcentaje de impr. de búsqueda, Porcentaje de conv., Conversiones, Costo/conv.
3. Una fila por palabra clave y grupo de anuncios.
4. Filas finales que empiezan con `Total:` ("Total: Palabras clave", "Total: Cuenta"...).

Reglas del lector:

- La fila de encabezados se busca entre las primeras 12: la que tiene "Palabra clave" y "Campaña".
- Las columnas se leen **por nombre normalizado** (minúsculas, sin tildes, espacios colapsados, incluido el
  espacio duro U+00A0 que trae "CTR prev."), nunca por posición. Se toleran columnas nuevas o reordenadas.
  Si una exportación trae "% impr. perdidas (ranking)" y "% impr. parte sup.", también se leen.
- El CSV se lee respetando comillas (`"1,244"`).
- El mes sale de la fila del rango de fechas (acepta "setiembre" y "septiembre"); si no está, del nombre del
  archivo. Se guarda también el periodo (inicio y fin).
- Se ignoran las filas `Total…` y las que no traen palabra clave o campaña.
- Moneda: la de la columna "Código de moneda" (hoy USD). No se asume.
- Cuota de impresiones y componentes del nivel de calidad: texto tal cual ("< 10%"); "--" se guarda como
  `null`. CTR, CPC, tasa de conversión y costo por conversión **no se guardan**: se calculan siempre sobre
  las sumas, como Google Ads.

### Números dañados por Google Sheets

Al convertir el CSV en hoja, Sheets lee la coma de miles como decimal y pierde los ceros finales:

- `1,290` queda como `1,29` y `1,200` como `1,2`. En impresiones y clics, si el grupo después de la última
  coma tiene 1 o 2 dígitos, se completa con ceros a la derecha: `1,29` → 1290. Pasó de verdad en estos
  informes: `1,01`, `2,25`, `3,41`, `4,06` y el total de agosto `10,75`.
- Un costo puede convertirse en fecha (`01.04`, `1/04/2026`): se lee día.mes como número (1.04).

### Verificación

Para cada mes, la suma de **todas** las filas (también las de campañas excluidas, porque el total del
informe las incluye) debe cuadrar con la fila "Total: Palabras clave filtradas" o, en esta cuenta,
"Total: Palabras clave": impresiones, clics y conversiones exactos; el costo puede diferir en céntimos por
el redondeo de cada fila (tolerancia: 0,05). El script imprime la tabla y el módulo muestra un aviso si un
mes no cuadra.

### Gasto de la cuenta (Pérdidas y Ganancias)

La fila `Total: Cuenta` se guarda aparte en `account` (impresiones, clics, costo y conversiones): es todo lo
que gastó la cuenta en el mes, también en campañas sin palabras clave (Máximo rendimiento, Display) y en las
excluidas, porque se pagaron. Pérdidas y Ganancias la usa como inversión mensual en Google Ads. Puede ser
mayor que "Total: Palabras clave" (mayo y junio de 2026). El script la muestra en la columna "Costo cuenta".

## Modelo normalizado

```json
{
  "schemaVersion": 2,
  "defaultMonth": "2026-09",
  "months": [{
    "id": "2026-09", "label": "Septiembre 2026", "sourceFile": "Lima Retail Google Ads Setiembre 2026",
    "driveFileId": "…", "modifiedTime": "…", "period": { "start": "2026-09-01", "end": "2026-09-30" },
    "currency": "USD",
    "check": { "label": "Total: Palabras clave", "ok": true, "totals": { … }, "diff": { … } },
    "account": { "impressions", "clicks", "cost", "conversions" },
    "excluded": { "campaigns": ["Website traffic-Search-15"], "rows": 2, "impressions": 40, … },
    "keywords": [{ "keyword", "matchType", "campaign", "adGroup", "state", "status", "reasons",
                   "impressions", "clicks", "cost", "conversions",
                   "qualityScore", "impressionShare", "expectedCtr", "landingPage", "adRelevance" }]
  }],
  "duplicates": [],
  "drive": { "folderId", "discovery", "lastSync", "files": [{ "id", "name", "mimeType", "modifiedTime" }] }
}
```

`drive.files` es la lista de hojas que leyó la última sincronización; el botón "Actualizar" la reutiliza.
Si dos archivos traen el mismo mes, gana el modificado más recientemente.

## Campañas excluidas

`CONFIG.excludeCampaigns` en `keyword-report.js`. Hoy: `Website traffic-Search-15`, la campaña de la palabra
clave "booking" creada en el hackeo de la cuenta (en septiembre gastó USD 33,04 con 13 clics).

Se quitan al interpretar cada informe (datos publicados por la sincronización diaria, botón "Actualizar" y
script de Node) y otra vez al mostrar, para que una caché vieja del navegador tampoco las traiga. La copia
cruda de los informes en Supabase sí las conserva, porque la verificación contra el total las necesita.
Para agregar una campaña: sumarla a la lista y subir el `?v=` del `<script src>` en el `index.html`.

## Sincronización

```txt
Google Ads ──(API)──> Nexus ──(hoja del mes)──> Carpeta de Drive de cada marca
                                                          │  CSV de cada hoja
                                                          ▼
                                       Supabase: lr_suite_keywords_refresh()
                                           │  pg_cron "lr-suite-keywords-daily": 06:20 Lima (11:20 UTC)
                                           ▼
   lr_suite_private_data: "keywords-status" (~4 KB, todas las marcas)
                          "keywords" y "keywords:<marca>" (~75 KB por mes y marca)
                                           │  al abrir el módulo: solo la marca que se mira
                                           ▼
                 index.html: keyword-report.js interpreta los CSV ──> caché en IndexedDB
```

**Diaria (servidor).** `lr_suite_keywords_refresh()` recorre las marcas configuradas
(`lr_suite_keywords_marcas()`). Por cada una lista su carpeta en este orden: Drive API v3 con una key
guardada en Supabase Vault (opcional), la vista pública `embeddedfolderview`, el último manifiesto guardado.
Descarga cada informe, guarda el manifiesto en su fila de `keywords-status` y la copia cruda en la fila de la
marca. Compara el contenido por hash, sin fechas: si nada cambió no reescribe los informes. Un informe que
falla conserva su copia anterior, y **una marca que falla entera no detiene a las demás**: su fila conserva
lo anterior y el fallo queda anotado (`error`). No necesita credenciales mientras las carpetas sigan
compartidas por enlace.

**Al abrir el módulo.** El navegador muestra su caché y lee la fila pequeña `keywords-status`, que trae la
lista de marcas con su hash. Solo descarga la fila grande **de la marca que se está mirando**, y solo si su
contenido publicado cambió (otro hash) y es más reciente que la caché: con doce cuentas, traerlas todas en
cada visita serían más de diez megas para ver una. Al cambiar de marca se descarga la suya, una sola vez por
visita. La caché gana a lo publicado solo si su `lastSync` es más reciente (un "Actualizar" posterior al
cron). La caché vive en IndexedDB y no en `localStorage` —una entrada por marca, más la lista—, porque el
`localStorage` de esta app guarda la sesión de Supabase y las tareas y ya estuvo al límite; los filtros sí se
guardan en `localStorage`, la marca elegida incluida.

**Botón "Actualizar" (navegador).** Pide a Supabase la lista actual de la carpeta de la marca que se está
mirando (RPC `list_lr_suite_keyword_files(<marca>)`, una sola petición), así un mes nuevo aparece al instante
sin poner una API key en el navegador. Después descarga cada hoja directo de Google con
`https://docs.google.com/spreadsheets/d/<id>/export?format=csv`, que responde con CORS abierto (sin API key),
en paralelo con `Promise.allSettled`: una hoja que falla no frena a las demás y conserva su mes anterior.
Interpreta, aplica las exclusiones, repinta sin recargar y guarda en la caché. Si el RPC no está instalado
usa las hojas conocidas, y si no hay ninguna recarga la última versión publicada. Lo leído así queda solo en
ese navegador; la copia publicada se renueva con el cron.

## Script de Node

```bash
node src/modules/analisis-palabras-clave/sync-keywords.mjs --folder <ID>   # lee la carpeta y guarda
node src/modules/analisis-palabras-clave/sync-keywords.mjs --check         # solo informa
node src/modules/analisis-palabras-clave/sync-keywords.mjs --file <csv>    # importa un informe local
```

- Lista la carpeta (Drive API si existe `GOOGLE_DRIVE_API_KEY`, vista pública, último manifiesto), exporta
  cada hoja, imprime la tabla de verificación e informa si hubo cambios (sin contar fechas).
- Escribe en `private/palabras-clave/` (fuera de git): `keywords.json`, `manifest.json` y `raw/` con la
  copia cruda de cada informe. La carpeta se recuerda en el manifiesto; también acepta
  `LR_KEYWORDS_FOLDER_ID`.
- Sale con código 1 si no pudo leer ningún informe o si un mes no cuadra.
- El sitio no lee estos archivos: los datos no se commitean porque el repositorio es público.

## Instalación

1. Supabase > SQL Editor: ejecutar `BBDD/sincronizacion-drive.sql` completo.
2. En el mismo editor, una línea por marca y sin guardarlas en el repo (guardan el ID y sincronizan esa
   marca al instante):
   `select public.lr_suite_keywords_set_marca('lima-retail', 'Lima Retail', '<ID_DE_LA_CARPETA>');`
   `select public.lr_suite_keywords_set_marca('royal-baby', 'Royal Baby', '<ID_DE_LA_CARPETA>');`
   El id va en minúsculas, con guiones y sin tildes: viaja en la clave de los datos y en el filtro de la
   pantalla. Las que hay: `select public.lr_suite_keywords_marcas();`. Para quitar una (sale de la
   configuración y se borra su copia de los informes):
   `select public.lr_suite_keywords_quitar_marca('<id>');`
   La instalación anterior usaba `lr_suite_keywords_set_folder('<ID>')`, que sigue existiendo y es
   exactamente la marca `lima-retail`.
3. Opcional: `select vault.create_secret('<API_KEY>', 'lr_suite_google_drive_api_key');` para listar con
   Drive API v3 en vez de la vista pública.
4. Si la última actualización tiene más de 30 horas, el módulo avisa: revisar el cron con las consultas del
   final del SQL.
