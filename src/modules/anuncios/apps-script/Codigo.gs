/**
 * Anuncios · Lima Retail
 *
 * Web App que le pasa a Supabase lo que necesita el módulo «Anuncios» del tablero sin sacar las
 * carpetas de cliente de «Restringido»: se ejecuta con la cuenta dueña de las carpetas, así que lee
 * «01 Meta Ads» y «06 Artes» sin compartirlas por enlace.
 *
 * Dos acciones, las dos por GET y las dos con token:
 *   ?accion=carpeta&id=<carpeta>  →  {ok:true, archivos:[{id, name, tipo}]}
 *   ?accion=hoja&id=<hoja>        →  {ok:true, anuncios:[{nombre, campana, gasto, …}]}
 * Un fallo responde {ok:false, error:'…'} y la sincronización lo anota como aviso de ese mes.
 *
 * Ningún ID vive en este archivo: el repositorio es público. El token se guarda una vez en las
 * propiedades del script y el mismo valor va a Supabase con lr_suite_ads_set_endpoint().
 *
 * Puesta en marcha:
 *   1. script.google.com > proyecto nuevo, con la cuenta que ve las carpetas de los clientes.
 *   2. Pegar este archivo y poner la zona horaria del proyecto en Lima.
 *   3. Project Settings > Script Properties: TOKEN = una cadena larga al azar.
 *   4. Implementar > Nueva implementación > Aplicación web, «Ejecutar como: yo» y «Quién tiene
 *      acceso: cualquier persona». Copiar la URL que termina en /exec.
 *   5. En Supabase: select public.lr_suite_ads_set_endpoint('<URL /exec>', '<TOKEN>');
 * Al cambiar este archivo: Implementar > Administrar implementaciones > editar > Nueva versión.
 *
 * Para probarlo desde el editor: poner las propiedades PRUEBA_META y PRUEBA_ARTES con los ids de
 * esas dos carpetas de una marca y ejecutar probar().
 */

// ── Las columnas de la descarga de Meta ────────────────────────────────────
// Normalizadas: minúsculas y sin tildes. Se buscan POR NOMBRE, no por posición: Meta renombra
// alguna entre descargas («Importe gastado» pasó a «Monto gastado») y una hoja reconstruida desde
// la API trae menos columnas y en otro orden, y tiene que leerse igual.
var COLUMNAS = {
  dia: ['dia'],
  nombre: ['nombre del anuncio'],
  campana: ['nombre de la campana'],
  conjunto: ['nombre del conjunto de anuncios'],
  tipoResultado: ['tipo de resultado'],
  preview: ['enlace de vista previa'],
  gasto: ['importe gastado (pen)', 'monto gastado (pen)'],
  impresiones: ['impresiones'],
  clics: ['clics en el enlace'],
  interacciones: ['interacciones con la publicacion'],
  compras: ['compras'],
  ingresos: ['valor de conversion de compras'],
  conversaciones: ['conversaciones con mensajes iniciadas'],
  resultados: ['resultados']
};
// Sin estas tres no hay nada que sumar; las demás, si faltan, quedan en 0 o en blanco.
var OBLIGATORIAS = ['dia', 'nombre', 'gasto'];
var SUMAS = [
  'gasto',
  'impresiones',
  'clics',
  'interacciones',
  'compras',
  'ingresos',
  'conversaciones',
  'resultados'
];
// Del mismo anuncio en varias filas se guarda el primer valor no vacío. gviz devolvía el mayor
// alfabéticamente, que para un nombre de campaña no quiere decir nada.
var TEXTOS = ['campana', 'conjunto', 'tipoResultado'];
var DECIMALES = { gasto: 2, ingresos: 2 };

// ── Entrada ────────────────────────────────────────────────────────────────
/**
 * Se despliega como «Ejecutar como: yo» y «Quién tiene acceso: cualquier persona», así que la URL
 * sola no puede ser la llave: se exige el token de las propiedades del script y se compara entero,
 * sin cortar en el primer carácter distinto.
 */
function doGet(e) {
  var parametros = (e && e.parameter) || {};
  try {
    if (!iguales(parametros.token || '', propiedad('TOKEN', true))) {
      return json({ ok: false, error: 'sin permiso' });
    }
    var id = String(parametros.id || '').trim();
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('Falta el id o no es valido.');

    if (parametros.accion === 'carpeta') return json({ ok: true, archivos: listarCarpeta(id) });
    if (parametros.accion === 'hoja') return json({ ok: true, anuncios: anunciosDeHoja(id) });
    throw new Error('Accion no soportada: usa accion=carpeta o accion=hoja.');
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: String((error && error.message) || error) });
  }
}

// ── Listar una carpeta ─────────────────────────────────────────────────────
// Mismo contrato que tenía la vista pública de Drive: [{id, name, tipo}] ordenado por nombre, con
// tipo 'carpeta', 'hoja', 'video', 'imagen' u 'otro'.
function listarCarpeta(id) {
  var carpeta = DriveApp.getFolderById(id);
  var archivos = [];

  var subcarpetas = carpeta.getFolders();
  while (subcarpetas.hasNext()) {
    var sub = subcarpetas.next();
    if (sub.isTrashed()) continue;
    archivos.push({ id: sub.getId(), name: sub.getName(), tipo: 'carpeta' });
  }

  var hijos = carpeta.getFiles();
  while (hijos.hasNext()) {
    var archivo = hijos.next();
    if (archivo.isTrashed()) continue;
    archivos.push({ id: archivo.getId(), name: archivo.getName(), tipo: tipoDe(archivo) });
  }

  archivos.sort(function (a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return archivos;
}

function tipoDe(archivo) {
  var mime = archivo.getMimeType() || '';
  if (mime === MimeType.GOOGLE_SHEETS) return 'hoja';
  if (mime.indexOf('video/') === 0) return 'video';
  if (mime.indexOf('image/') === 0) return 'imagen';
  return 'otro';
}

// ── Anuncios de una hoja, sumados por anuncio ──────────────────────────────
// El export trae una fila por día x edad x sexo (miles por mes). Aquí se suma por «Nombre del
// anuncio» y salen unas decenas de filas, que es lo que guarda Supabase.
function anunciosDeHoja(id) {
  var hoja = SpreadsheetApp.openById(id);
  var valores = filasCrudas(hoja);
  var col = columnas(valores[0]);
  var zona = hoja.getSpreadsheetTimeZone();

  var grupos = {};
  var orden = [];
  for (var i = 1; i < valores.length; i += 1) {
    var fila = valores[i];
    var nombre = texto(fila[col.nombre]);
    if (!nombre) continue;

    var grupo = grupos[nombre];
    if (!grupo) {
      grupo = grupos[nombre] = nuevoGrupo(nombre);
      orden.push(grupo);
    }

    for (var t = 0; t < TEXTOS.length; t += 1) {
      var clave = TEXTOS[t];
      if (!grupo[clave] && col[clave] >= 0) grupo[clave] = texto(fila[col[clave]]);
    }
    if (!grupo.preview && col.preview >= 0) {
      var enlace = texto(fila[col.preview]);
      if (/^https:\/\//.test(enlace)) grupo.preview = enlace;
    }

    var dia = diaDe(fila[col.dia], zona);
    if (dia) {
      if (!grupo.desde || dia < grupo.desde) grupo.desde = dia;
      if (dia > grupo.hasta) grupo.hasta = dia;
    }

    for (var s = 0; s < SUMAS.length; s += 1) {
      var campo = SUMAS[s];
      if (col[campo] >= 0) grupo[campo] += numero(fila[col[campo]]);
    }
  }

  for (var g = 0; g < orden.length; g += 1) {
    for (var k = 0; k < SUMAS.length; k += 1) {
      var sumado = SUMAS[k];
      orden[g][sumado] = redondear(orden[g][sumado], DECIMALES[sumado] || 0);
    }
  }
  // Como en el módulo: primero el anuncio que más gastó.
  orden.sort(function (a, b) {
    return b.gasto - a.gasto;
  });
  return orden;
}

function nuevoGrupo(nombre) {
  var grupo = {
    nombre: nombre,
    campana: '',
    conjunto: '',
    tipoResultado: '',
    preview: '',
    desde: '',
    hasta: ''
  };
  for (var i = 0; i < SUMAS.length; i += 1) grupo[SUMAS[i]] = 0;
  return grupo;
}

// La pestaña con la descarga es la que tiene las cabeceras «Día» e «Importe gastado (PEN)» (o
// «Monto gastado»): así da igual cómo se llame la pestaña y si arriba hay filas de título.
function filasCrudas(hoja) {
  var pestanas = hoja.getSheets();
  for (var i = 0; i < pestanas.length; i += 1) {
    var valores = pestanas[i].getDataRange().getValues();
    for (var f = 0; f < valores.length; f += 1) {
      if (esCabecera(valores[f])) return valores.slice(f);
    }
  }
  throw new Error(
    'No se encontro la descarga de Meta (cabeceras "Dia" e "Importe gastado (PEN)" o "Monto gastado (PEN)").'
  );
}

function esCabecera(fila) {
  var tieneDia = false;
  var tieneGasto = false;
  for (var i = 0; i < fila.length; i += 1) {
    var celda = normalizar(fila[i]);
    if (COLUMNAS.dia.indexOf(celda) >= 0) tieneDia = true;
    if (COLUMNAS.gasto.indexOf(celda) >= 0) tieneGasto = true;
  }
  return tieneDia && tieneGasto;
}

function columnas(cabecera) {
  var normalizadas = cabecera.map(normalizar);
  var col = {};
  Object.keys(COLUMNAS).forEach(function (clave) {
    col[clave] = -1;
    for (var i = 0; i < normalizadas.length; i += 1) {
      if (COLUMNAS[clave].indexOf(normalizadas[i]) >= 0) {
        col[clave] = i;
        return;
      }
    }
  });
  var faltan = OBLIGATORIAS.filter(function (clave) {
    return col[clave] < 0;
  });
  if (faltan.length) {
    throw new Error(
      'Faltan columnas en la hoja: ' +
        faltan
          .map(function (clave) {
            return COLUMNAS[clave].join(' / ');
          })
          .join(', ')
    );
  }
  return col;
}

// ── Utilidades ─────────────────────────────────────────────────────────────
function normalizar(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function texto(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

function numero(valor) {
  if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
  var n = Number(String(valor === null || valor === undefined ? '' : valor).replace(/,/g, '').trim());
  return isFinite(n) ? n : 0;
}

function redondear(valor, decimales) {
  var factor = Math.pow(10, decimales);
  return Math.round(valor * factor) / factor;
}

// Una celda de fecha llega como Date: se formatea en la zona de la hoja para no correr el día.
function diaDe(valor, zona) {
  if (valor instanceof Date) return Utilities.formatDate(valor, zona || 'America/Lima', 'yyyy-MM-dd');
  var encontrado = texto(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return encontrado ? encontrado[0] : '';
}

function propiedad(nombre, obligatorio) {
  var valor = PropertiesService.getScriptProperties().getProperty(nombre) || '';
  if (!valor && obligatorio) {
    throw new Error(
      'Falta la propiedad de script ' + nombre + '. Project Settings > Script Properties.'
    );
  }
  return valor;
}

// Comparación de tiempo constante: no deja deducir el token a punta de intentos cronometrados.
function iguales(recibido, esperado) {
  if (recibido.length !== esperado.length) return false;
  var diferencia = 0;
  for (var i = 0; i < esperado.length; i += 1) {
    diferencia |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diferencia === 0;
}

function json(cuerpo) {
  return ContentService.createTextOutput(JSON.stringify(cuerpo)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ── Prueba a mano, desde el editor ─────────────────────────────────────────
// Necesita las propiedades PRUEBA_META y PRUEBA_ARTES. No deja nada escrito: solo informa.
function probar() {
  var meta = propiedad('PRUEBA_META', true);
  var artes = propiedad('PRUEBA_ARTES', true);

  var hojas = listarCarpeta(meta).filter(function (archivo) {
    return archivo.tipo === 'hoja';
  });
  console.log('01 Meta Ads: ' + hojas.length + ' hojas');
  if (hojas.length) {
    var anuncios = anunciosDeHoja(hojas[0].id);
    var gasto = anuncios.reduce(function (suma, anuncio) {
      return suma + anuncio.gasto;
    }, 0);
    console.log(
      hojas[0].name + ': ' + anuncios.length + ' anuncios, gasto S/ ' + gasto.toFixed(2) +
        (anuncios.length ? ' | el que mas gasto: ' + anuncios[0].nombre : '')
    );
  }

  listarCarpeta(artes).forEach(function (campana) {
    if (campana.tipo !== 'carpeta') return;
    console.log('06 Artes · ' + campana.name + ': ' + listarCarpeta(campana.id).length + ' piezas');
  });
}
