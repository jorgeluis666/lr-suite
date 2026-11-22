# Cortes publicitarios del CRM

El primer gráfico se lee directamente de `lr_acrm_capturas` usando la sesión del usuario, al desplegar el panel. Recorre todas las páginas y cuenta los rubros vacíos o marcados como desconocidos en «Sin rubro». No depende de la página ni del filtro de la tabla de leads.

El segundo usa un corte privado guardado en `lr_suite_private_data`, clave `acrm-rubros-publicidad`. Es volumen de anunciantes, no inversión ni cantidad de anuncios. No hay barrido automático de Google o Meta.

Para actualizar el corte:

1. Leer los valores de las pestañas **Empresas** (columnas B:D desde la fila 4, con encabezado) e **Historial de pauta** (A:G desde la fila 4, con encabezado) de la hoja de prospección enlazada en el módulo. Consultar su metadata y paginar si crece; no truncar la lectura. Guardar esas lecturas fuera del repositorio.
2. Pasar ambos arrays a `LRACRMRubros.publicidad(empresas, historial)`, de `src/modules/prospeccion/acrm-rubros.js`. El resultado solo contiene agregados, cobertura, fechas y fuente. Verificar la fuente y la fecha antes de importarlo.
3. Con una conexión autorizada a Supabase, comprobar que `lr_suite_private_data` mantiene RLS activo y sus políticas para miembros de LR Suite. Validar `version: 1`, `metrica: anunciantes`, fuente, fechas y que cada serie sume su total. Guardar el JSON agregado en `payload`, mediante un upsert de la clave `acrm-rubros-publicidad`, actualizando `updated_at`; no reemplazar un corte más reciente. Usar parámetros SQL o escapar correctamente el literal JSON. Releer y comparar el resultado y comprobar, dentro de una transacción, que un anónimo no puede leerlo y un miembro autorizado sí puede leer el corte y `lr_acrm_capturas`. No poner credenciales, agregados privados ni filas de origen en el repositorio. Los secretos de publicación de GitHub no tienen permisos para esta operación de base de datos.
4. En el CRM, desplegar **Análisis de rubros** y pulsar **Actualizar**. Esto relee ambos gráficos; no vuelve a consultar la hoja.

Una empresa se identifica por dominio. Se usa la última fila por fecha (y orden de fila cuando empatan). Una empresa con anuncios confirmados en Google y Meta cuenta una sola vez en «Google + Meta». Un número positivo se acepta solo si el estado es Exacto o Aproximado. «Sin resultados» es cero; «Sin verificar» y «Página por validar» no son cero. Los dominios del historial que no tienen ficha en Empresas se excluyen y se cuentan en `fueraCatalogo`. No se rescatan verificaciones antiguas para reemplazar un corte reciente desconocido.

Los rangos son diferentes: Google observa los últimos 30 días, Meta los anuncios activos al consultar. El panel conserva las fechas y cobertura para que la muestra no se confunda con todo el mercado.
