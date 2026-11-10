# Indicador diario y revisión de marcas

`gasto-diario.js` y `gasto-diario.css` añaden la tarjeta anterior a «Pacing por marca» en el módulo estático de `index.html`.

- Marca y fechas filtran conjuntamente el indicador y la serie. El indicador muestra el último día del período frente al día calendario anterior, incluso si ese día queda fuera del rango visible. Si falta la base o es cero, no se inventa un porcentaje.
- **Datos de ejemplo**: la serie diaria es una fixture determinista por marca, independiente de los acumulados del informe. El total es la suma de esas series. No representa gasto real ni se guarda en la base. El aviso permanece visible en todas las selecciones. Para conectar datos reales se necesita primero un histórico diario por marca, fecha e importe en una moneda común; no debe reconstruirse dividiendo el acumulado.
- La revisión de marcas usa el estado mensual real de `gastoPorMarca`, conservando los umbrales de la aplicación. No pretende que las anomalías sean del rango diario simulado. La primera marca tiene alerta si existe alguna; las siguientes se eligen al azar con pesos 6 (rose), 3 (amber), 1 (resto), sin repetir inmediatamente. Todas siguen siendo elegibles.
- El banner es blanco y discreto, sin cabecera amarilla. Rota cada 8 segundos, con anterior, siguiente, pausa y «Ver marca». La rotación no cambia el filtro hasta pulsar «Ver marca». Se pausa con foco/hover, pestaña oculta y, inicialmente, con movimiento reducido. `shell()` desmonta el temporizador.
- La transparencia de la maqueta corresponde al fondo de la imagen exportada; la aplicación conserva su fondo y sistema de tarjetas.

Validación: `npm ci --prefix tests/acrm --ignore-scripts` y `node tests/acrm/gasto-diario.mjs` (reutiliza el entorno JSDOM existente).
