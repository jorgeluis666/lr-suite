/**
 * Reglas y Optimización · Lima Retail
 *
 * Crea en el Drive de cada marca la subcarpeta «08 Reglas y Optimización» con un Sheet
 * «Reglas_Nexus_<Marca>», y lo puebla con el Ciclo Mensual de Análisis y Optimización: cuatro
 * hitos, uno por semana del mes. Ese Sheet es lo que el equipo edita; el tablero solo lo lee.
 *
 * Ningún ID vive en este archivo: el repositorio es público. El ID del maestro «Conexiones Drive
 * Dashboard» se guarda una vez en las propiedades del script (ver README.md, «Puesta en marcha»).
 *
 * Funciones para ejecutar a mano, desde el editor:
 *   crearReglas()      Fase 1. Crea lo que falte y puebla los hitos. Se puede repetir sin miedo.
 *   barrido()          Fase 2. Junta las reglas de todas las marcas y las muestra en el registro.
 *   doGet(e)           Fase 2 como Web App. Es un respaldo: lo normal es que Supabase lea las
 *                      hojas directamente (ver BBDD/reglas-nexus.sql).
 */

// ── Lo que define la estructura ────────────────────────────────────────────
// El orden de las columnas es el contrato con el tablero y con la sincronización de Supabase:
// si aquí cambia una, hay que cambiarla en BBDD/reglas-nexus.sql y en el index.html.
var COLUMNAS = [
  'ID Regla',
  'Semana / Hito',
  'Métrica (Trigger)',
  'Operador',
  'Valor',
  'Acción Automática',
  'Activar IA',
  'Instrucción Estratégica para la IA'
];

// «08» es el número libre que sigue a las siete carpetas del estándar de la agencia y queda antes
// de «99 Archivos sueltos», así que la carpeta aparece donde corresponde sin reordenar nada.
var CARPETA_REGLAS = '08 Reglas y Optimización';
var PREFIJO_ARCHIVO = 'Reglas_Nexus_';

// El Ciclo Mensual de Análisis y Optimización. El disparador de los cuatro es el día del mes:
// a cada día le corresponde un hito y solo uno, en este orden.
var HITOS = [
  [
    'R_01',
    'Hito 1: Calibración (Semana 1)',
    'dias_mes',
    '<=',
    7,
    'alerta_pacing',
    true,
    'Objetivo: Establecer línea base y proyectar cierre. Acción: Genera una "Alerta de Proyección" ' +
      'frente al objetivo. Si la proyección matemática está por debajo, redacta un plan de ' +
      'contingencia inmediato enfocado en redistribución de presupuesto hacia los canales con ' +
      'mejor CPA/ROAS.'
  ],
  [
    'R_02',
    'Hito 2: Creatividades (Semana 2)',
    'dias_mes',
    '<=',
    14,
    'pausar_fatigados',
    true,
    'Objetivo: Evaluar qué comunicación resuena. Acción: Crea un "Mapa de Costo-Eficiencia ' +
      'Creativa" detallando los formatos que generan ventas al menor costo. Finaliza con una ' +
      '"Guía de Producción" dándole feedback al cliente sobre qué material gráfico producir.'
  ],
  [
    'R_03',
    'Hito 3: Pivot de Públicos (Semana 3)',
    'dias_mes',
    '<=',
    21,
    'alerta_overlap',
    true,
    'Objetivo: Atacar la segmentación si el volumen se estanca. Acción: Genera una "Radiografía ' +
      'del Comprador" con insights demográficos rentables. Luego, explica cómo el "Desbloqueo de ' +
      'Escala" (apertura a nuevos segmentos o exclusión de keywords) protegerá el margen.'
  ],
  [
    'R_04',
    'Hito 4: Lift (Semana 4)',
    'dias_mes',
    '>',
    21,
    'escalar_presupuesto',
    true,
    'Objetivo: Exprimir el presupuesto y demostrar valor. Acción: Haz una "Demostración de ' +
      'Impacto (Lift)", comparando cómo la proyección de la Semana 1 fue superada por los ' +
      'cambios. Cierra con una "Estrategia Puente" de inversión para el mes siguiente.'
  ]
];

var OPERADORES = ['<', '<=', '==', '>=', '>', '!='];

// ── Propiedades del script ─────────────────────────────────────────────────
function propiedad(nombre, obligatorio) {
  var valor = PropertiesService.getScriptProperties().getProperty(nombre) || '';
  if (!valor && obligatorio) {
    throw new Error(
      'Falta la propiedad de script ' + nombre + '. Project Settings > Script Properties.'
    );
  }
  return valor;
}

// ── El maestro: qué marcas hay y dónde está su carpeta ─────────────────────
// «Hoja 1» del maestro: columna A el nombre de la marca, columna C el link de su carpeta raíz.
// De ese link sale el ID; una fila sin link o con un link que no es de carpeta se salta y se dice.
function marcas() {
  var hoja = SpreadsheetApp.openById(propiedad('ID_MAESTRO', true)).getSheetByName('Hoja 1');
  if (!hoja) throw new Error('El maestro no tiene una pestaña «Hoja 1».');

  var filas = hoja.getDataRange().getValues();
  var salida = [];
  for (var i = 1; i < filas.length; i += 1) {
    var marca = String(filas[i][0] || '').trim();
    var link = String(filas[i][2] || '').trim();
    if (!marca) continue;
    var id = idDeCarpeta(link);
    salida.push({ marca: marca, carpeta: id, link: link, fila: i + 1 });
  }
  return salida;
}

function idDeCarpeta(link) {
  var encontrado = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(link || '');
  return encontrado ? encontrado[1] : '';
}

// ── Fase 1: crear la estructura y poblar los hitos ─────────────────────────
/**
 * Recorre las marcas del maestro y deja, en cada una, «08 Reglas y Optimización» con su
 * «Reglas_Nexus_<Marca>» poblado.
 *
 * Se puede ejecutar todas las veces que haga falta: lo que ya existe no se duplica y, sobre todo,
 * un valor que el equipo haya ajustado a mano no se pisa. Solo se agregan los hitos que falten.
 * Para devolver una hoja a los valores de fábrica: reponerHitos('<Marca>').
 */
function crearReglas() {
  var resumen = { creadas: 0, existentes: 0, hitosAgregados: 0, saltadas: [] };

  marcas().forEach(function (entrada) {
    if (!entrada.carpeta) {
      resumen.saltadas.push(entrada.marca + ' (fila ' + entrada.fila + ': sin link de carpeta)');
      return;
    }

    var raiz;
    try {
      raiz = DriveApp.getFolderById(entrada.carpeta);
    } catch (error) {
      resumen.saltadas.push(entrada.marca + ' (la carpeta no se pudo abrir: ' + error.message + ')');
      return;
    }

    var carpeta = subcarpeta(raiz, CARPETA_REGLAS);
    var nombre = PREFIJO_ARCHIVO + entrada.marca;
    var existente = archivoEnCarpeta(carpeta, nombre);
    var hoja;

    if (existente) {
      resumen.existentes += 1;
      hoja = SpreadsheetApp.openById(existente.getId()).getSheets()[0];
    } else {
      var libro = SpreadsheetApp.create(nombre);
      // create() deja el archivo en la raíz de Mi unidad: se mueve a la carpeta de la marca.
      DriveApp.getFileById(libro.getId()).moveTo(carpeta);
      hoja = libro.getSheets()[0];
      hoja.setName('Reglas');
      resumen.creadas += 1;
    }

    resumen.hitosAgregados += poblar(hoja);
    formatear(hoja);
  });

  Logger.log(
    'Hojas creadas: %s · ya existían: %s · hitos agregados: %s',
    resumen.creadas,
    resumen.existentes,
    resumen.hitosAgregados
  );
  if (resumen.saltadas.length) Logger.log('Saltadas:\n- %s', resumen.saltadas.join('\n- '));
  return resumen;
}

// Las doce carpetas de hoy ya existen con la herencia de permisos apagada, así que esto las
// encuentra y no crea nada. La que se cree para una marca nueva nace heredando los permisos de la
// carpeta de la marca, donde hay cuentas del lado del cliente: hay que apagarle la herencia a mano
// (clic derecho > Compartir > Acceso restringido) antes de que alguien escriba una instrucción.
// DriveApp no expone ese ajuste; el servicio avanzado de Drive sí, si algún día se automatiza.
function subcarpeta(raiz, nombre) {
  var encontradas = raiz.getFoldersByName(nombre);
  return encontradas.hasNext() ? encontradas.next() : raiz.createFolder(nombre);
}

function archivoEnCarpeta(carpeta, nombre) {
  var encontrados = carpeta.getFilesByName(nombre);
  return encontrados.hasNext() ? encontrados.next() : null;
}

/**
 * Deja los encabezados en la fila 1 y, debajo, los hitos que falten. Devuelve cuántos agregó.
 *
 * Los encabezados se reescriben siempre (son el contrato con el tablero), pero las filas de datos
 * solo se agregan: si «R_02» ya está con un valor distinto al de fábrica, es porque alguien lo
 * ajustó para esa marca y manda sobre la plantilla.
 */
function poblar(hoja) {
  hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);

  var presentes = {};
  var ultima = hoja.getLastRow();
  if (ultima > 1) {
    hoja
      .getRange(2, 1, ultima - 1, 1)
      .getValues()
      .forEach(function (fila) {
        var id = String(fila[0] || '').trim();
        if (id) presentes[id] = true;
      });
  }

  var faltan = HITOS.filter(function (hito) {
    return !presentes[hito[0]];
  });
  if (!faltan.length) return 0;

  hoja.getRange(hoja.getLastRow() + 1, 1, faltan.length, COLUMNAS.length).setValues(faltan);
  // Los hitos se leen por día del mes, así que conviene que se vean en orden aunque se hayan
  // agregado en tandas distintas.
  hoja.getRange(2, 1, hoja.getLastRow() - 1, COLUMNAS.length).sort({ column: 1, ascending: true });
  return faltan.length;
}

/** Devuelve una marca a los valores de fábrica: borra sus filas de datos y repone los cuatro hitos. */
function reponerHitos(marca) {
  var hoja = hojaDeMarca(marca);
  if (!hoja) throw new Error('No se encontró la hoja de reglas de ' + marca + '.');
  if (hoja.getLastRow() > 1) {
    hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();
  }
  var agregados = poblar(hoja);
  formatear(hoja);
  Logger.log('%s: %s hitos repuestos.', marca, agregados);
  return agregados;
}

function hojaDeMarca(marca) {
  var buscada = String(marca || '').trim();
  var encontrada = null;
  marcas().forEach(function (entrada) {
    if (encontrada || entrada.marca !== buscada || !entrada.carpeta) return;
    var carpeta = subcarpeta(DriveApp.getFolderById(entrada.carpeta), CARPETA_REGLAS);
    var archivo = archivoEnCarpeta(carpeta, PREFIJO_ARCHIVO + entrada.marca);
    if (archivo) encontrada = SpreadsheetApp.openById(archivo.getId()).getSheets()[0];
  });
  return encontrada;
}

// ── Que la hoja se deje leer y editar sin romperse ──────────────────────────
// La validación del Operador y de Activar IA no es cosmética: el tablero compara esos valores
// literalmente, y un «mayor que» escrito a mano en lugar de «>» deja la regla sin aplicar.
function formatear(hoja) {
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold').setWrap(true);

  var anchos = [90, 230, 150, 90, 70, 170, 90, 620];
  for (var i = 0; i < anchos.length; i += 1) hoja.setColumnWidth(i + 1, anchos[i]);

  var filas = Math.max(hoja.getLastRow() - 1, 1);
  hoja.getRange(2, 4, filas, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(OPERADORES, true).build()
  );
  hoja.getRange(2, 7, filas, 1).insertCheckboxes();
  hoja.getRange(2, 8, filas, 1).setWrap(true);
  hoja.getRange(2, 1, filas, COLUMNAS.length).setVerticalAlignment('top');
}

// ── Fase 2: el barrido ─────────────────────────────────────────────────────
/**
 * Junta las reglas de todas las marcas en un solo objeto.
 *
 * Forma: { generado, marcas: [{ marca, archivo, reglas: [{ id, hito, metrica, operador, valor,
 * accion, ia, instruccion }] }], avisos: [] }
 */
function barrido() {
  var salida = { generado: new Date().toISOString(), marcas: [], avisos: [] };

  marcas().forEach(function (entrada) {
    if (!entrada.carpeta) {
      salida.avisos.push(entrada.marca + ': sin link de carpeta en el maestro.');
      return;
    }

    var carpeta;
    try {
      carpeta = subcarpeta(DriveApp.getFolderById(entrada.carpeta), CARPETA_REGLAS);
    } catch (error) {
      salida.avisos.push(entrada.marca + ': ' + error.message);
      return;
    }

    var archivo = archivoEnCarpeta(carpeta, PREFIJO_ARCHIVO + entrada.marca);
    if (!archivo) {
      salida.avisos.push(entrada.marca + ': todavía no tiene hoja de reglas. Ejecuta crearReglas().');
      return;
    }

    var hoja = SpreadsheetApp.openById(archivo.getId()).getSheets()[0];
    var filas = hoja.getDataRange().getValues();
    var reglas = [];
    for (var i = 1; i < filas.length; i += 1) {
      var regla = leerFila(filas[i]);
      if (regla) reglas.push(regla);
    }

    salida.marcas.push({
      marca: entrada.marca,
      archivo: archivo.getId(),
      actualizado: archivo.getLastUpdated().toISOString(),
      reglas: reglas
    });
  });

  Logger.log(JSON.stringify(salida, null, 2));
  return salida;
}

// Una fila sin ID de regla o sin métrica no es una regla: suele ser una nota que alguien dejó al
// pie de la hoja, y no debe llegar al tablero como si fuera algo que aplicar.
function leerFila(fila) {
  var id = String(fila[0] || '').trim();
  var metrica = String(fila[2] || '').trim();
  if (!id || !metrica) return null;
  return {
    id: id,
    hito: String(fila[1] || '').trim(),
    metrica: metrica,
    operador: String(fila[3] || '').trim(),
    valor: Number(fila[4]),
    accion: String(fila[5] || '').trim(),
    ia: fila[6] === true || String(fila[6]).trim().toUpperCase() === 'VERDADERO' ||
      String(fila[6]).trim().toUpperCase() === 'TRUE',
    instruccion: String(fila[7] || '').trim()
  };
}

/**
 * El barrido como Web App. Es un respaldo para cuando las hojas no se puedan compartir por
 * enlace: lo normal es que Supabase las lea directo (BBDD/reglas-nexus.sql).
 *
 * Se despliega como «Ejecutar como: yo» y «Quién tiene acceso: cualquier persona», así que la
 * URL sola no puede ser la llave: se exige un token guardado en las propiedades del script y se
 * compara entero, sin cortar en el primer carácter distinto.
 */
function doGet(e) {
  var esperado = propiedad('TOKEN', true);
  var recibido = (e && e.parameter && e.parameter.token) || '';
  if (!iguales(recibido, esperado)) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'sin permiso' })).setMimeType(
      ContentService.MimeType.JSON
    );
  }
  return ContentService.createTextOutput(JSON.stringify(barrido())).setMimeType(
    ContentService.MimeType.JSON
  );
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
