# Reglas y Optimización

Las proyecciones y las sugerencias de **Alertas de Gasto** ya no salen de umbrales escritos en el
`index.html`: siguen el **Ciclo Mensual de Análisis y Optimización** de la agencia, cuatro hitos
declarados en una hoja por marca que el equipo edita sin tocar código.

```txt
Apps Script          Drive de la marca              Supabase            index.html
crearReglas()  ──►   08 Reglas y Optimización  ──►  pg_cron 06:40  ──►  Alertas de Gasto
                     Reglas_Nexus_<Marca>           reglas-nexus        El hito que toca
                                                          │
                                                          └──► Edge Function reglas-analisis ──► Claude
```

## Los cuatro hitos

El disparador de los cuatro es el día del mes (`dias_mes`). Se evalúan en el orden de la hoja y
gana el primero que cumple, así que cada día del mes cae en un hito y solo en uno.

| ID   | Hito                              | Corte  | Acción Automática     | Qué entrega                                          |
| ---- | --------------------------------- | ------ | --------------------- | ---------------------------------------------------- |
| R_01 | Calibración (Semana 1)            | `<= 7` | `alerta_pacing`       | Alerta de Proyección y plan de contingencia.          |
| R_02 | Creatividades (Semana 2)          | `<= 14`| `pausar_fatigados`    | Mapa de Costo-Eficiencia Creativa y Guía de Producción. |
| R_03 | Pivot de Públicos (Semana 3)      | `<= 21`| `alerta_overlap`      | Radiografía del Comprador y Desbloqueo de Escala.     |
| R_04 | Lift (Semana 4)                   | `> 21` | `escalar_presupuesto` | Demostración de Impacto y Estrategia Puente.          |

Un mes que ya cerró no tiene «hoy»: se lee con su último día, que cae en el Hito 4. Así mirar
septiembre en octubre no muestra el hito de la semana en que está quien mira.

## Qué calcula el tablero y qué no

«Alertas de Gasto» solo ve presupuesto y proyección de Google Ads, así que de las cuatro acciones
hay dos que puede respaldar con cifras y dos que no:

| Acción                | En el tablero                                                                |
| --------------------- | ---------------------------------------------------------------------------- |
| `alerta_pacing`       | **Sí.** Los avisos de proyección que ya calculaba el módulo.                  |
| `escalar_presupuesto` | **Sí.** Cuentas cuya proyección cierra por debajo de lo asignado, con el monto que queda suelto. |
| `pausar_fatigados`    | **No.** Frecuencia y fatiga creativa son datos de nivel anuncio: están en Anuncios. |
| `alerta_overlap`      | **No.** El solapamiento de públicos también.                                  |

Las dos que no se anuncian igual —el hito corre y su instrucción se muestra— pero la tarjeta dice
dónde están los datos en lugar de inventar una cifra. El análisis de la IA recibe las cifras de
gasto que sí hay y tiene instrucción explícita de decir qué le faltó, bajo el título «Falta para
completar este hito», en lugar de estimarlo.

## Las piezas

| Pieza                           | Qué hace                                                                 |
| ------------------------------- | ------------------------------------------------------------------------ |
| `apps-script/Codigo.gs`         | Crea «08 Reglas y Optimización» y la hoja de cada marca, y la puebla. Lo único que escribe en Drive. |
| `BBDD/reglas-nexus.sql`         | pg_cron diario que lee las hojas y las deja en `lr_suite_private_data` «reglas-nexus». |
| `index.html`                    | La tarjeta «El hito que toca», dentro de Clientes → Alertas de Gasto.     |
| `supabase/functions/reglas-analisis` | Le pasa a Claude la instrucción estratégica más las cifras y devuelve el análisis. |

## Puesta en marcha

1. **Drive**: ya está. Las doce marcas de «Hoja 1» del maestro tienen su carpeta
   «08 Reglas y Optimización» con la hoja `Reglas_Nexus_<Marca>` poblada con los cuatro hitos, y la
   carpeta restringida a las cuentas de la agencia que ya tenían esa carpeta de marca. Esa hoja es
   la raíz editable: lo que se cambie ahí manda.

   `crearReglas()` del Apps Script sigue sirviendo para una marca nueva. Ojo: crea la carpeta sin
   restringir, así que después hay que apagarle la herencia de permisos a mano.

2. **Supabase**: ejecuta `BBDD/reglas-nexus.sql` completo en el SQL Editor y conecta el barrido con
   `lr_suite_reglas_set_webapp()` (ver «Permisos», más abajo).

3. **Edge Function**:

   ```bash
   supabase functions deploy reglas-analisis
   ```

   Usa el secreto `ANTHROPIC_API_KEY`, el mismo del asistente de WhatsApp, así que no hay nada nuevo
   que configurar. El modelo se puede cambiar sin tocar código con
   `supabase secrets set REGLAS_MODELO=claude-sonnet-5-5`.

4. **Tablero**: Clientes → Alertas de Gasto → «Actualizar reglas».

Mientras falte el paso 1 o el 2, la tarjeta no inventa ningún hito: explica qué falta y muestra los
avisos de la última sincronización.

## Permisos: por qué hace falta el Web App

Las doce carpetas «08 Reglas y Optimización» existen ya en Drive, cada una dentro de su marca,
junto a «02 Google Ads», y todas con **la herencia de permisos apagada**. Sin eso, la hoja heredaba
los permisos de la carpeta de la marca, y varias de esas carpetas están compartidas con cuentas del
lado del cliente o con terceros. Cualquiera de ellos habría podido leer y editar la instrucción
estratégica, que es el método de trabajo de la agencia y habla del cliente en tercera persona.

La consecuencia es que **los dos caminos directos a Drive dejan de servir**:

| Camino | Por qué no |
| --- | --- |
| Vista pública de la carpeta | La carpeta ya no es pública. |
| Drive API con una key en Vault | Una API key **no autentica a nadie**: solo abre archivos públicos. Contra una carpeta restringida falla igual. |
| **Web App del Apps Script** | **Funciona**: se ejecuta con la cuenta de su dueño, así que ve lo privado, y va detrás de un token. |

Por eso el despliegue del Web App (`apps-script/README.md`) no es opcional, y su URL y token se
guardan con:

```sql
select public.lr_suite_reglas_set_webapp('<URL_DEL_WEB_APP>', '<TOKEN>') ->> 'lastSync';
```

El camino de lectura directa sigue en el SQL para una instalación donde las hojas sí estén
compartidas por enlace, pero no es el de esta agencia.

## Editar una regla

Se edita en el Sheet de la marca y al día siguiente el tablero la aplica (o al instante con
«Actualizar reglas»).

- **Se puede cambiar**: `Valor` (mover el corte de la semana), `Operador`, `Acción Automática`, el
  check de `Activar IA` y la `Instrucción Estratégica`. Una marca puede querer que su Hito 3 hable
  de keywords y otra de públicos de Meta.
- **No conviene cambiar**: `ID Regla` (es por donde se reconoce la fila) ni `Métrica`, mientras el
  tablero solo sepa evaluar `dias_mes`.
- Si una marca queda con cortes que dejan días sin cubrir, la tarjeta lo dice en lugar de elegir un
  hito al azar.

El operador se compara tal como está escrito: una celda con «mayor que» en lugar de `>` deja la
regla sin aplicar. Por eso la columna trae validación de datos con la lista de operadores.

## Costos y egress

- **Lectura**: una fila de ~20 KB al abrir Alertas de Gasto, una vez por sesión. Igual que los
  presupuestos.
- **Escritura**: una fila al día, la del pg_cron.
- **Modelo**: solo cuando alguien pulsa «Pedir el análisis». Nada se guarda: el texto vive lo que
  dure la sesión del navegador.

## Qué se descartó del plan original

El plan de partida pedía un Web App de Apps Script como API y un backend en Node o Python. Ninguno
hacía falta:

- **El Web App como API** se cambió por el patrón que ya usa el repo: pg_cron con la extensión
  `http` lee Drive directamente desde Postgres. Una pieza menos y ninguna URL pública con las
  reglas de todas las marcas. El `doGet` quedó escrito como respaldo, detrás de un token, para el
  caso de que las hojas no se puedan compartir por enlace.
- **El backend en Node o Python** no existe: LR Suite es un `index.html` estático. Lo que necesita
  servidor —la llamada al modelo— vive en una Edge Function, donde la clave es un secreto de
  Supabase y el navegador nunca la ve.
- **OpenAI / Gemini** se cambió por Claude, que es el modelo que ya usa el asistente de WhatsApp
  con su clave ya configurada.
