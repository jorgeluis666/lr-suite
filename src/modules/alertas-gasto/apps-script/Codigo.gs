/**
 * Alertas de Gasto · Lima Retail
 *
 * Web App que le pasa a Supabase el «Informe de rendimiento» de Google Ads desde su carpeta de
 * Drive, ya leído y sumado por cuenta. Se ejecuta con la cuenta dueña de la carpeta, así que no hay
 * que compartirla por enlace.
 *
 * Una acción, por GET y con token:
 *   ?accion=informe  →  {ok:true, plataforma:'google', desde, hasta, archivo:{…}, cuentas:[…]}
 * Un fallo responde {ok:false, error:'…'} y la sincronización lo anota sin pisar lo que había.
 *
 * El informe es el que hasta octubre de 2026 se subía a mano desde el tablero: el de rendimiento a
 * nivel de cuenta del MCC, con una fila por cuenta y la línea del periodo encima de la tabla. La
 * lectura de abajo es la misma que hacía el navegador, movida acá tal cual: es la que ya había
 * leído bien los informes reales, y cambiarla de camino no es motivo para reescribirla.
 *
 * De la carpeta se lee **el archivo modificado más recientemente** que tenga la columna «Nombre de
 * cuenta»: el informe programado de Google Ads deja uno nuevo en cada corrida y el que vale es el
 * último. Los demás se quedan donde están, que son el historial.
 *
 * Ningún ID vive en este archivo: el repositorio es público. El token y la carpeta se guardan en
 * las propiedades del script, y el mismo token va a Supabase con lr_suite_gasto_set_endpoint().
 *
 * Puesta en marcha:
 *   1. script.google.com > proyecto nuevo, con la cuenta que ve la carpeta de los informes.
 *   2. Pegar este archivo y poner la zona horaria del proyecto en Lima.
 *   3. Project Settings > Script Properties:
 *        TOKEN           = una cadena larga al azar
 *        GASTO_FOLDER_ID = id de la carpeta de Drive donde cae el informe programado
 *   4. Implementar > Nueva implementación > Aplicación web, «Ejecutar como: yo» y «Quién tiene
 *      acceso: cualquier persona». Copiar la URL que termina en /exec.
 *   5. En Supabase: select public.lr_suite_gasto_set_endpoint('<URL /exec>', '<TOKEN>');
 * Al cambiar este archivo: Implementar > Administrar implementaciones > editar > Nueva versión.
 *
 * Para probarlo desde el editor, sin Supabase: ejecutar probar().
 */

var MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'
];
// En los informes de Google «septiembre» va con p; la hoja de Lima Retail lo escribe sin ella.
var MESES_ALIAS = { septiembre: 8 };

// Las columnas del informe, normalizadas (minúsculas, sin tildes). Se buscan POR NOMBRE: Google
// cambia el orden según las métricas que lleve el informe.
var COL_CUENTA = 'nombre de cuenta';
var COL_COSTE = 'coste';

function doGet(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('TOKEN');
    var params = (e && e.parameter) || {};
    if (!token || params.token !== token) return responder({ ok: false, error: 'token invalido' });
    if (params.accion !== 'informe') return responder({ ok: false, error: 'accion desconocida' });
    return responder(informe(params.carpeta || props.getProperty('GASTO_FOLDER_ID')));
  } catch (error) {
    return responder({ ok: false, error: String((error && error.message) || error) });
  }
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// ── El informe más reciente de la carpeta ──────────────────────────────────
function informe(carpetaId) {
  if (!carpetaId) return { ok: false, error: 'falta GASTO_FOLDER_ID en las propiedades del script' };
  var carpeta;
  try {
    carpeta = DriveApp.getFolderById(carpetaId);
  } catch (error) {
    return { ok: false, error: 'no se pudo abrir la carpeta: ' + String((error && error.message) || error) };
  }

  var candidatos = [];
  var it = carpeta.getFiles();
  while (it.hasNext()) {
    var archivo = it.next();
    var tipo = archivo.getMimeType();
    if (tipo !== MimeType.GOOGLE_SHEETS && tipo !== 'text/csv' && tipo !== 'text/plain') continue;
    candidatos.push({ archivo: archivo, fecha: archivo.getLastUpdated().getTime() });
  }
  if (!candidatos.length) return { ok: false, error: 'la carpeta no tiene hojas ni CSV' };
  candidatos.sort(function (a, b) { return b.fecha - a.fecha; });

  // Del más nuevo al más viejo hasta dar con uno que sea el informe: en la carpeta puede haber
  // otras cosas, y un archivo suelto no puede dejar al tablero sin gasto.
  var motivos = [];
  for (var i = 0; i < candidatos.length && i < 10; i++) {
    var file = candidatos[i].archivo;
    var texto;
    try {
      texto = textoDe(file);
    } catch (errorLectura) {
      motivos.push(file.getName() + ': ' + String((errorLectura && errorLectura.message) || errorLectura));
      continue;
    }
    var leido = parseInforme(texto);
    if (leido.error) {
      motivos.push(file.getName() + ': ' + leido.error);
      continue;
    }
    leido.informe.ok = true;
    leido.informe.archivo = {
      id: file.getId(),
      nombre: file.getName(),
      modificado: file.getLastUpdated().toISOString()
    };
    return leido.informe;
  }
  return { ok: false, error: 'ningun archivo de la carpeta es el informe de rendimiento · ' + motivos.join(' · ') };
}

function textoDe(file) {
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    // El informe programado llega como hoja: se exporta a CSV para leerlo igual que un CSV suelto.
    var url = 'https://docs.google.com/spreadsheets/d/' + file.getId() + '/export?format=csv';
    var respuesta = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (respuesta.getResponseCode() !== 200) throw new Error('Google respondio ' + respuesta.getResponseCode());
    return respuesta.getContentText();
  }
  return file.getBlob().getDataAsString('UTF-8');
}

// ── Lectura del informe ────────────────────────────────────────────────────
// Lo que sigue es, sin cambios de fondo, lo que hacía el navegador cuando el informe se subía a
// mano (index.html, hasta el 1 de noviembre de 2026). Los nombres de columna y las trampas que
// esquiva —la línea del periodo, el «Código de moneda» repetido, la fila de totales— salen de
// informes reales, así que se mueven tal cual.

function normalizar(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function numero(valor) {
  var texto = String(valor == null ? '' : valor).replace(/\s/g, '').replace('%', '');
  if (!texto || texto === '--') return 0;
  var limpio = texto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  var valorNumerico = Number(limpio);
  return isFinite(valorNumerico) ? valorNumerico : 0;
}

// "20 de octubre de 2026" o "2026-10-20" → "2026-10-20".
function fecha(texto) {
  var fuente = String(texto || '').trim();
  var iso = fuente.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var largo = normalizar(fuente).match(/(\d{1,2}) de ([a-z]+) de (\d{4})/);
  if (!largo) return '';
  var mes = MESES.indexOf(largo[2]);
  if (mes < 0 && MESES_ALIAS[largo[2]] != null) mes = MESES_ALIAS[largo[2]];
  if (mes < 0) return '';
  return largo[3] + '-' + ('0' + (mes + 1)).slice(-2) + '-' + ('0' + largo[1]).slice(-2);
}

// La línea del periodo va encima de la tabla: "1 de octubre de 2026 - 20 de octubre de 2026".
function periodo(linea) {
  var partes = String(linea || '').split(/\s[-–—]\s/);
  if (partes.length < 2) return null;
  var desde = fecha(partes[0]);
  var hasta = fecha(partes[1]);
  return desde && hasta && desde <= hasta ? { desde: desde, hasta: hasta } : null;
}

function parseInforme(texto) {
  var filas = Utilities.parseCsv(String(texto || '')).filter(function (fila) {
    return fila.some(function (celda) { return String(celda).trim(); });
  });
  if (!filas.length) return { error: 'el archivo esta vacio' };

  var cabeceraIndex = -1;
  for (var i = 0; i < filas.length; i++) {
    for (var j = 0; j < filas[i].length; j++) {
      if (normalizar(filas[i][j]) === COL_CUENTA) { cabeceraIndex = i; break; }
    }
    if (cabeceraIndex >= 0) break;
  }
  if (cabeceraIndex < 0) return { error: 'no tiene la columna «Nombre de cuenta»' };

  var rango = null;
  for (var k = 0; k < cabeceraIndex && !rango; k++) rango = periodo(filas[k][0]);
  if (!rango) return { error: 'no trae la linea del periodo encima de la tabla' };

  var cabecera = filas[cabeceraIndex].map(normalizar);
  // «Código de moneda» sale dos veces (la de la cuenta y la convertida): indexOf toma la primera,
  // que es la de la cuenta, que es la que manda en su presupuesto.
  var columna = function (nombre) { return cabecera.indexOf(nombre); };
  var iNombre = columna(COL_CUENTA);
  var iId = columna('id de cliente externo de la cuenta');
  var iEstado = columna('estado de la cuenta');
  var iMoneda = columna('codigo de moneda');
  var iCoste = columna(COL_COSTE);
  var iConvertido = columna('coste (moneda convertida)');
  var iMonedaConvertida = columna('codigo de moneda convertida');
  var iDiario = columna('presupuesto diario total');
  var iImpresiones = columna('impr.');
  var iClics = columna('clics');
  var iConversiones = columna('conversiones');
  if (iCoste < 0) return { error: 'no trae la columna «Coste»' };

  var cuentas = filas
    .slice(cabeceraIndex + 1)
    .filter(function (fila) {
      // Las filas de totales no son cuentas: van sin nombre y empiezan con "Total:".
      var nombre = String(fila[iNombre] || '').trim();
      return nombre && !/^total/.test(normalizar(fila[0] || ''));
    })
    .map(function (fila) {
      var nombre = String(fila[iNombre]).trim();
      return {
        plataforma: 'google',
        id: (iId >= 0 ? String(fila[iId] || '').trim() : '') || nombre,
        nombre: nombre,
        estado: iEstado >= 0 ? String(fila[iEstado] || '').trim() : '',
        moneda: (iMoneda >= 0 ? String(fila[iMoneda] || '').trim() : '').toUpperCase(),
        monedaConvertida: (iMonedaConvertida >= 0 ? String(fila[iMonedaConvertida] || '').trim() : '').toUpperCase(),
        coste: numero(fila[iCoste]),
        costeConvertido: iConvertido >= 0 ? numero(fila[iConvertido]) : 0,
        diario: iDiario >= 0 ? numero(fila[iDiario]) : 0,
        impresiones: iImpresiones >= 0 ? numero(fila[iImpresiones]) : 0,
        clics: iClics >= 0 ? numero(fila[iClics]) : 0,
        conversiones: iConversiones >= 0 ? numero(fila[iConversiones]) : 0
      };
    });
  if (!cuentas.length) return { error: 'no trae ninguna cuenta' };
  return { informe: { plataforma: 'google', desde: rango.desde, hasta: rango.hasta, cuentas: cuentas } };
}

// ── Prueba desde el editor ─────────────────────────────────────────────────
function probar() {
  var props = PropertiesService.getScriptProperties();
  var resultado = informe(props.getProperty('GASTO_FOLDER_ID'));
  if (!resultado.ok) {
    console.log('✗ ' + resultado.error);
    return;
  }
  console.log('▶ ' + resultado.archivo.nombre + ' (' + resultado.archivo.modificado + ')');
  console.log('  Periodo: ' + resultado.desde + ' → ' + resultado.hasta);
  console.log('  Cuentas: ' + resultado.cuentas.length);
  var total = 0;
  resultado.cuentas.forEach(function (cuenta) {
    total += cuenta.costeConvertido || cuenta.coste;
    console.log('   · ' + cuenta.nombre + ' · ' + cuenta.moneda + ' ' + cuenta.coste + ' · tope ' + cuenta.diario);
  });
  console.log('  Gasto total (moneda convertida): ' + Math.round(total * 100) / 100);
}
