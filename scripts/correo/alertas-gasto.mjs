#!/usr/bin/env node
/* ============================================================
   scripts/correo/alertas-gasto.mjs — Alertas de gasto diarias por correo.

   Lo corre .github/workflows/alertas-gasto.yml todos los días a las 8:30 a. m. de Lima.
   Pide a Supabase el informe de gasto y la lista de correos con la función
   public.lr_suite_alertas_gasto(clave) (src/modules/alertas-gasto/BBDD/alertas-gasto-correo.sql)
   y manda un correo con la estética de LR Suite y lo mismo que dice la campana de la barra
   superior: el total del mes, el pacing de cada canal día a día (el mismo gráfico del panel,
   dibujado con tablas porque Gmail borra los SVG), el pacing de cada marca que no va en ritmo y
   las anomalías del gasto diario.

   Los cálculos son los del panel (gastoModelo(), gastoFila(), gastoResumen(), gastoPorMarca(),
   gastoNotifPacingItems() y gastoNotifDiarioItems() en index.html). Si cambia un umbral, cambia
   en los dos sitios: el correo y la campana tienen que decir lo mismo.

   Uso:
     node scripts/correo/alertas-gasto.mjs                          # envío real
     node scripts/correo/alertas-gasto.mjs --dry-run                # arma el correo sin enviarlo
     node scripts/correo/alertas-gasto.mjs --preview correo.html    # escribe el correo en un archivo
     node scripts/correo/alertas-gasto.mjs --datos datos.json ...   # usa { gasto, destinatarios } de un archivo

   Variables de entorno:
     LR_GASTO_CLAVE                              → clave de la función de Supabase (secret del repo)
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  → cuenta de correo del hosting (alertas@limaretail.com)
     DRY_RUN=true                                → equivale a --dry-run
     SUPABASE_URL, SUPABASE_KEY                  → opcionales: por defecto, los de lr-suite-config.js
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argValue = flag => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const PREVIEW = argValue('--preview');
const DATOS = argValue('--datos');

const SUITE_URL = 'https://suite.limaretail.com/';
const LOGO = new URL('assets/lima-retail-logo.png', SUITE_URL).href;
const ZONA = 'America/Lima';

// Los mismos umbrales del módulo y de la campana (index.html). Cambiar uno acá obliga a cambiarlo allá.
const GASTO_TOLERANCIA = 0.05;
const GASTO_SUBUSO = 0.85;
const GASTO_DIARIO_TECHO = 1.5;
const GASTO_NOTIF_SALTO = 0.35;
const GASTO_NOTIF_SALTO_ALTO = 0.75;
const GASTO_NOTIF_SALTO_MINIMO = 5;
const GASTO_NOTIF_ORDEN = { late: 0, warn: 1, '': 2 };
const GASTO_ORDEN_ESTADO = ['sobregirado', 'se-pasa', 'al-limite', 'sin-gasto', 'corto', 'en-ritmo', 'sin-presupuesto'];
const GASTO_PLATAFORMAS = [
  { id: 'google', label: 'Google Ads' },
  { id: 'meta', label: 'Meta Ads' },
];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ── Datos ─────────────────────────────────────────────────────
// La URL y la clave publicable de Supabase son las del panel (lr-suite-config.js): no son secretas.
function supabaseConfig() {
  const archivo = fs.readFileSync(path.join(ROOT, 'lr-suite-config.js'), 'utf8');
  const url = process.env.SUPABASE_URL || (archivo.match(/url:\s*"([^"]+)"/) || [])[1];
  const key = process.env.SUPABASE_KEY || (archivo.match(/anonKey:\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error('no se encontró la URL o la clave publicable de Supabase en lr-suite-config.js');
  return { url, key };
}

async function leerAlertas() {
  if (DATOS) return JSON.parse(fs.readFileSync(DATOS, 'utf8'));
  const clave = process.env.LR_GASTO_CLAVE;
  if (!clave) throw new Error('falta LR_GASTO_CLAVE (la clave que muestra alertas-gasto-correo.sql)');
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/rpc/lr_suite_alertas_gasto`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_clave: clave }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${(body && (body.message || body.hint)) || 'sin detalle'}`);
  return body;
}

// La marca de una cuenta sin marca elegida a mano se adivina del nombre de la cuenta, igual que en
// el panel (gastoMarcaSugerida). La lista de marcas es la del módulo de Clientes, que vive en el
// index.html: se lee de ahí para no tener dos listas que se separen, y así el correo agrupa las
// cuentas igual que la campana.
let marcasCache = null;
function marcasDeLaSuite() {
  if (marcasCache) return marcasCache;
  let bloque = '';
  try {
    const archivo = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    bloque = (archivo.match(/const clientesProyectos = \[([\s\S]*?)\n {6}\];/) || [])[1] || '';
  } catch {
    bloque = '';
  }
  const marcas = [...bloque.matchAll(/cliente:\s*"([^"]+)"/g)].map(m => m[1]);
  marcasCache = [...new Set(marcas)].sort((a, b) => a.localeCompare(b));
  // Sin la lista, cada cuenta sin marca elegida a mano saldría con su nombre crudo y el correo
  // agruparía distinto que la campana. Se dice en el log en vez de callarlo.
  if (!marcasCache.length) console.warn('⚠  No se pudo leer la lista de marcas del index.html: las cuentas sin marca saldrán con el nombre de la cuenta.');
  return marcasCache;
}

// ── Fechas y formatos (los mismos del panel) ──────────────────
const diaLima = valor => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(valor));
const fechaCorta = clave => {
  const [y, m, d] = clave.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
};
const fechaLarga = clave => {
  const [y, m, d] = clave.split('-').map(Number);
  const texto = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
const normalizeText = valor => String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const gastoClave = texto => normalizeText(texto).replace(/[^a-z0-9]/g, '');

const porcentaje = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmtMetricPercent = valor => `${porcentaje.format(valor)}%`;

const gastoFormatos = new Map();
// Cada cuenta tiene su moneda. Los montos del mes van sin céntimos; el ritmo diario sí los necesita.
function gastoMonto(value, moneda = 'PEN') {
  const monto = Number(value) || 0;
  const codigo = /^[A-Z]{3}$/.test(String(moneda)) ? String(moneda) : 'PEN';
  const decimales = Math.abs(monto) < 100 ? 2 : 0;
  const clave = `${codigo}|${decimales}`;
  if (!gastoFormatos.has(clave)) {
    gastoFormatos.set(clave, new Intl.NumberFormat('es-PE', {
      style: 'currency', currency: codigo, maximumFractionDigits: decimales, minimumFractionDigits: decimales,
    }));
  }
  return gastoFormatos.get(clave).format(monto).replace(/\s/g, ' ');
}

function gastoMesEtiqueta(mes) {
  const [anio, numero] = String(mes || '').split('-');
  const nombre = MESES[Number(numero) - 1] || '';
  return nombre ? `${nombre[0].toUpperCase()}${nombre.slice(1)} ${anio}` : String(mes || '');
}

function gastoDiasDelMes(mes) {
  const [anio, numero] = String(mes || '').split('-').map(Number);
  if (!anio || !numero) return 30;
  return new Date(anio, numero, 0).getDate();
}

function gastoDiasCubiertos(informe) {
  const desde = new Date(`${informe.desde}T12:00:00Z`);
  const hasta = new Date(`${informe.hasta}T12:00:00Z`);
  const dias = Math.round((hasta - desde) / 86400000) + 1;
  return Number.isFinite(dias) && dias > 0 ? dias : 1;
}

// El informe trae el coste en la moneda de la cuenta y convertido a la del administrador: de esas
// dos cifras sale el tipo de cambio. Una cuenta en otra moneda y sin gasto no lo tiene, así que no
// puede sumar al total.
function gastoTipoCambio(cuenta) {
  if (!cuenta.monedaConvertida || cuenta.moneda === cuenta.monedaConvertida) return 1;
  return cuenta.coste && cuenta.costeConvertido ? cuenta.costeConvertido / cuenta.coste : 0;
}

const gastoPlataforma = cuenta => (cuenta?.plataforma === 'meta' ? 'meta' : 'google');

// ── El modelo del módulo, tal cual ────────────────────────────
function gastoMarcaDe(datos, cuenta) {
  const guardada = datos?.cuentas?.[cuenta.id];
  if (guardada && typeof guardada.marca === 'string') return guardada.marca;
  const clave = gastoClave(cuenta.nombre);
  return marcasDeLaSuite().find(marca => clave.includes(gastoClave(marca))) || '';
}

const gastoPresupuesto = (datos, cuenta, mes) => Number(datos?.cuentas?.[cuenta.id]?.presupuestos?.[mes]) || 0;

// El semáforo, en un solo sitio: lo usan la fila de cada cuenta y el pacing por marca.
function gastoEstadoDe(presupuesto, gastado, proyeccion) {
  if (!presupuesto) return { id: 'sin-presupuesto', texto: 'Sin presupuesto', tono: '' };
  if (gastado > presupuesto) return { id: 'sobregirado', texto: 'Sobregirado', tono: 'rose' };
  if (!gastado) return { id: 'sin-gasto', texto: 'Sin gasto', tono: 'amber' };
  if (proyeccion > presupuesto * (1 + GASTO_TOLERANCIA)) return { id: 'se-pasa', texto: 'Se pasará', tono: 'rose' };
  if (proyeccion > presupuesto) return { id: 'al-limite', texto: 'Al límite', tono: 'amber' };
  if (proyeccion < presupuesto * GASTO_SUBUSO) return { id: 'corto', texto: 'Quedará corto', tono: 'amber' };
  return { id: 'en-ritmo', texto: 'En ritmo', tono: 'green' };
}

function gastoFila(datos, cuenta, informe, mes) {
  const presupuesto = gastoPresupuesto(datos, cuenta, mes);
  const diasMes = gastoDiasDelMes(mes);
  const dias = Math.min(diasMes, gastoDiasCubiertos(informe));
  const ritmo = cuenta.coste / dias;
  const proyeccion = ritmo * diasMes;
  return {
    cuenta,
    marca: gastoMarcaDe(datos, cuenta),
    presupuesto,
    dias,
    diasMes,
    ritmo,
    proyeccion,
    consumido: presupuesto ? cuenta.coste / presupuesto : 0,
    desvio: presupuesto ? proyeccion - presupuesto : 0,
    // Lo que daría el presupuesto diario cargado en Google si corriera todo el mes.
    diarioProyectado: cuenta.diario * diasMes,
    cambio: gastoTipoCambio(cuenta),
    estado: gastoEstadoDe(presupuesto, cuenta.coste, proyeccion),
  };
}

// Al total solo entran las cuentas con tipo de cambio: las demás se cuentan aparte y se dicen. El
// consumido y el desvío se miden solo sobre las cuentas que tienen presupuesto.
function gastoResumen(filas, dias, diasMes) {
  const convertibles = filas.filter(fila => fila.cambio);
  const asignadas = convertibles.filter(fila => fila.presupuesto);
  const presupuesto = asignadas.reduce((suma, fila) => suma + fila.presupuesto * fila.cambio, 0);
  const gastado = convertibles.reduce((suma, fila) => suma + fila.cuenta.coste * fila.cambio, 0);
  const gastadoAsignado = asignadas.reduce((suma, fila) => suma + fila.cuenta.coste * fila.cambio, 0);
  const restan = Math.max(0, diasMes - dias);
  return {
    presupuesto,
    gastado,
    gastadoAsignado,
    proyeccion: convertibles.reduce((suma, fila) => suma + fila.proyeccion * fila.cambio, 0),
    proyeccionAsignada: asignadas.reduce((suma, fila) => suma + fila.proyeccion * fila.cambio, 0),
    consumido: presupuesto ? gastadoAsignado / presupuesto : 0,
    ritmo: dias ? gastado / dias : 0,
    // Lo que habría que gastar cada día de los que quedan para cerrar justo en lo asignado.
    idealDiario: presupuesto && restan ? Math.max(0, presupuesto - gastadoAsignado) / restan : 0,
    restan,
    cuentas: filas.length,
    conPresupuesto: asignadas.length,
    sinCambio: filas.length - convertibles.length,
  };
}

function gastoModelo(datos) {
  const informes = datos?.informes || {};
  const meses = Object.keys(informes).sort().reverse();
  // Siempre el informe más reciente, igual que el módulo.
  const mes = meses[0] || '';
  const informe = mes ? informes[mes] : null;
  if (!informe) return { meses, mes: '', informe: null, filas: [], totales: null, porPlataforma: [] };
  const filas = (informe.cuentas || [])
    .map(cuenta => gastoFila(datos, cuenta, informe, mes))
    .sort((left, right) => right.cuenta.coste - left.cuenta.coste);
  const moneda = filas.find(fila => fila.cuenta.monedaConvertida)?.cuenta.monedaConvertida || filas[0]?.cuenta.moneda || 'PEN';
  const dias = filas[0]?.dias || gastoDiasCubiertos(informe);
  const diasMes = gastoDiasDelMes(mes);
  const totales = { moneda, dias, diasMes, ...gastoResumen(filas, dias, diasMes) };
  const porPlataforma = GASTO_PLATAFORMAS.map(plataforma => {
    const suyas = filas.filter(fila => gastoPlataforma(fila.cuenta) === plataforma.id);
    return { ...plataforma, filas: suyas, resumen: gastoResumen(suyas, dias, diasMes) };
  });
  return { meses, mes, informe, filas, totales, porPlataforma, datos };
}

// El pacing por marca: cómo va cada una contra lo suyo, que es como se contrata. El presupuesto de
// la marca es la suma del de sus cuentas. Solo entran las cuentas con tipo de cambio.
function gastoPorMarca(modelo) {
  if (!modelo.totales) return [];
  const { dias, diasMes, moneda } = modelo.totales;
  const grupos = new Map();

  modelo.filas.forEach(fila => {
    const marca = fila.marca || 'Sin marca';
    const grupo = grupos.get(marca) || {
      marca, cuentas: 0, sinCambio: 0, conPresupuesto: 0, presupuesto: 0, gastado: 0, proyeccion: 0, plataformas: {},
    };
    grupo.cuentas += 1;
    if (!fila.cambio) {
      grupo.sinCambio += 1;
    } else {
      if (fila.presupuesto) grupo.conPresupuesto += 1;
      grupo.presupuesto += fila.presupuesto * fila.cambio;
      grupo.gastado += fila.cuenta.coste * fila.cambio;
      grupo.proyeccion += fila.proyeccion * fila.cambio;
      const idPlataforma = gastoPlataforma(fila.cuenta);
      const suma = grupo.plataformas[idPlataforma] || { presupuesto: 0, gastado: 0 };
      suma.presupuesto += fila.presupuesto * fila.cambio;
      suma.gastado += fila.cuenta.coste * fila.cambio;
      grupo.plataformas[idPlataforma] = suma;
    }
    grupos.set(marca, grupo);
  });

  return [...grupos.values()]
    .map(grupo => Object.assign(grupo, {
      moneda,
      ritmo: dias ? grupo.gastado / dias : 0,
      consumido: grupo.presupuesto ? grupo.gastado / grupo.presupuesto : 0,
      desvio: grupo.presupuesto ? grupo.proyeccion - grupo.presupuesto : 0,
      // Lo que habría que gastar por día en lo que queda para cerrar justo en lo asignado.
      porDia: grupo.presupuesto && diasMes > dias ? Math.max(0, grupo.presupuesto - grupo.gastado) / (diasMes - dias) : 0,
      estado: gastoEstadoDe(grupo.presupuesto, grupo.gastado, grupo.proyeccion),
    }))
    .sort((left, right) =>
      GASTO_ORDEN_ESTADO.indexOf(left.estado.id) - GASTO_ORDEN_ESTADO.indexOf(right.estado.id) ||
      right.gastado - left.gastado);
}

// La fila del total: el mes entero con las mismas cifras que una marca.
function gastoTotalDelMes(modelo) {
  const total = modelo.totales;
  const plataformas = {};
  modelo.porPlataforma.forEach(plataforma => {
    if (!plataforma.resumen.cuentas) return;
    plataformas[plataforma.id] = { presupuesto: plataforma.resumen.presupuesto, gastado: plataforma.resumen.gastado };
  });
  return {
    marca: 'Total del mes',
    cuentas: total.cuentas,
    sinCambio: total.sinCambio,
    conPresupuesto: total.conPresupuesto,
    presupuesto: total.presupuesto,
    gastado: total.gastado,
    proyeccion: total.proyeccion,
    plataformas,
    moneda: total.moneda,
    ritmo: total.ritmo,
    consumido: total.consumido,
    desvio: total.proyeccionAsignada - total.presupuesto,
    porDia: total.idealDiario,
    restan: total.restan,
    estado: gastoEstadoDe(total.presupuesto, total.gastadoAsignado, total.proyeccionAsignada),
  };
}

// ── Los avisos de la campana ──────────────────────────────────
// El ritmo diario de cada cuenta en el mes anterior, para poder decir si el de ahora subió.
function gastoRitmoPrevio(modelo) {
  const previo = modelo.meses.find(mes => mes < modelo.mes);
  const informe = previo ? modelo.datos?.informes?.[previo] : null;
  if (!informe) return null;
  const dias = gastoDiasCubiertos(informe);
  const ritmos = new Map();
  (informe.cuentas || []).forEach(cuenta => ritmos.set(cuenta.id, dias ? cuenta.coste / dias : 0));
  return { mes: previo, ritmos };
}

function gastoNotifPacingItems(modelo) {
  return gastoPorMarca(modelo)
    .filter(marca => marca.presupuesto && marca.estado.id !== 'en-ritmo')
    .map(marca => {
      const moneda = marca.moneda;
      const avance = `${modelo.totales.dias} de ${modelo.totales.diasMes} días del mes`;
      const textos = {
        sobregirado: {
          tono: 'late',
          texto: `Ya gastó ${gastoMonto(marca.gastado, moneda)} de los ${gastoMonto(marca.presupuesto, moneda)} asignados, con ${avance}.`,
        },
        'se-pasa': {
          tono: 'late',
          texto: `Al ritmo de ${gastoMonto(marca.ritmo, moneda)} por día cerraría en ${gastoMonto(marca.proyeccion, moneda)}: ${gastoMonto(marca.desvio, moneda)} por encima de lo asignado.`,
        },
        'al-limite': {
          tono: 'warn',
          texto: `Va justo: proyecta ${gastoMonto(marca.proyeccion, moneda)} contra ${gastoMonto(marca.presupuesto, moneda)} asignados, con ${avance}.`,
        },
        'sin-gasto': {
          tono: 'warn',
          texto: `Tiene ${gastoMonto(marca.presupuesto, moneda)} asignados y no gastó nada en ${avance}.`,
        },
        corto: {
          tono: '',
          texto: `Proyecta ${gastoMonto(marca.proyeccion, moneda)}: quedarían ${gastoMonto(Math.max(0, marca.presupuesto - marca.proyeccion), moneda)} sin usar de lo asignado.`,
        },
      }[marca.estado.id];
      if (!textos) return null;
      return {
        familia: 'pacing',
        titulo: marca.marca,
        etiqueta: marca.estado.texto,
        tonoEstado: marca.estado.tono,
        texto: textos.texto,
        apoyo: marca.porDia
          ? `Ideal ${gastoMonto(marca.porDia, moneda)}/día en los ${modelo.totales.restan} ${modelo.totales.restan === 1 ? 'día' : 'días'} que quedan`
          : '',
        cifra: fmtMetricPercent(marca.consumido * 100),
        unidad: 'consumido',
        peso: marca.gastado,
        tono: textos.tono,
      };
    })
    .filter(Boolean);
}

// Lo que puede disparar el gasto de un día para otro: que el ritmo haya saltado frente al mes
// pasado, que el tope diario cargado en Google dé para mucho más de lo asignado, o que una cuenta
// esté gastando sin presupuesto, que es gastar sin techo.
function gastoNotifDiarioItems(modelo) {
  const previo = gastoRitmoPrevio(modelo);
  const items = [];
  modelo.filas.forEach(fila => {
    const { cuenta } = fila;
    const moneda = cuenta.moneda || 'PEN';
    const nombre = fila.marca || cuenta.nombre;
    // La cuenta solo se nombra cuando aporta algo: en una marca de una sola cuenta que se llama
    // igual, repetirla es ruido.
    const cuentaDicha = cuenta.nombre === nombre ? '' : `${cuenta.nombre} · `;
    const antes = previo?.ritmos.get(cuenta.id) || 0;
    const salto = antes ? fila.ritmo / antes - 1 : 0;
    if (antes && salto >= GASTO_NOTIF_SALTO && fila.ritmo - antes >= GASTO_NOTIF_SALTO_MINIMO) {
      items.push({
        familia: 'diario',
        titulo: nombre,
        etiqueta: 'Gasto diario al alza',
        tonoEstado: salto >= GASTO_NOTIF_SALTO_ALTO ? 'rose' : 'amber',
        texto: `Pasó de ${gastoMonto(antes, moneda)} a ${gastoMonto(fila.ritmo, moneda)} por día frente a ${gastoMesEtiqueta(previo.mes)}.`,
        apoyo: `${cuentaDicha}a este ritmo cierra en ${gastoMonto(fila.proyeccion, moneda)}`,
        cifra: `+${fmtMetricPercent(salto * 100)}`,
        unidad: 'al día',
        peso: (fila.ritmo - antes) * fila.diasMes,
        tono: salto >= GASTO_NOTIF_SALTO_ALTO ? 'late' : 'warn',
      });
    }
    if (fila.presupuesto && cuenta.diario && fila.diarioProyectado > fila.presupuesto * GASTO_DIARIO_TECHO) {
      items.push({
        familia: 'diario',
        titulo: nombre,
        etiqueta: 'Tope diario holgado',
        tonoEstado: 'amber',
        texto: `El tope cargado en Google (${gastoMonto(cuenta.diario, moneda)} al día) da para ${gastoMonto(fila.diarioProyectado, moneda)} en el mes, muy por encima de los ${gastoMonto(fila.presupuesto, moneda)} asignados.`,
        apoyo: `${cuentaDicha}nada le impide dispararse un día`,
        cifra: `${(fila.diarioProyectado / fila.presupuesto).toFixed(1)}×`,
        unidad: 'de lo asignado',
        peso: fila.diarioProyectado - fila.presupuesto,
        tono: 'warn',
      });
    }
    if (!fila.presupuesto && cuenta.coste) {
      items.push({
        familia: 'diario',
        titulo: nombre,
        etiqueta: 'Gasta sin presupuesto',
        tonoEstado: 'amber',
        texto: `Lleva ${gastoMonto(cuenta.coste, moneda)} en ${gastoMesEtiqueta(modelo.mes)} y no tiene presupuesto asignado: no hay con qué frenarla.`,
        apoyo: `${cuentaDicha}${gastoMonto(fila.ritmo, moneda)} por día`,
        cifra: gastoMonto(fila.ritmo, moneda),
        unidad: 'al día',
        peso: cuenta.coste,
        tono: 'warn',
      });
    }
  });
  return items;
}

// Primero lo urgente; dentro de cada color, el pacing antes que las anomalías, porque el pacing es
// dinero que ya se movió y la anomalía es lo que podría moverse mañana.
function gastoNotificationItems(modelo) {
  if (!modelo.informe) return [];
  return [...gastoNotifPacingItems(modelo), ...gastoNotifDiarioItems(modelo)].sort((left, right) =>
    GASTO_NOTIF_ORDEN[left.tono] - GASTO_NOTIF_ORDEN[right.tono] ||
    (left.familia === right.familia ? 0 : left.familia === 'pacing' ? -1 : 1) ||
    right.peso - left.peso);
}

// ── Correo ────────────────────────────────────────────────────
// Estética de LR Suite: fondo #f6f9fc, tarjetas blancas con borde #dce3ef y radio 12px, azul #2563eb
// y la cifra de cada aviso como en la campana (azul suave para un aviso, azul lleno para uno urgente).
// Todo en tablas y estilos en línea para Gmail y Outlook.
const C = {
  bg: '#f6f9fc', card: '#ffffff', line: '#dce3ef', lineSoft: '#e2e8f0',
  ink: '#0f172a', muted: '#475569', subtle: '#64748b', brand: '#2563eb', brandSoft: '#eff6ff', brandLine: '#bfdbfe',
  rose: '#be123c', roseSoft: '#fff1f2', roseLine: '#fecdd3',
  amber: '#b45309', amberSoft: '#fffbeb', amberLine: '#fde68a',
  green: '#1d4ed8', gray: '#f1f5f9',
};
const FONT = "Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const pill = (texto, fg, bg, bd) =>
  `<span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${bd};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;white-space:nowrap;">${texto}</span>`;

// El mismo badge del semáforo del módulo: rose, amber o neutro.
function badgeEstado(texto, tono) {
  const colores = tono === 'rose'
    ? [C.rose, C.roseSoft, C.roseLine]
    : tono === 'amber' ? [C.amber, C.amberSoft, C.amberLine]
      : tono === 'green' ? [C.green, C.brandSoft, C.brandLine] : [C.muted, '#f8fafc', C.line];
  return pill(esc(texto), colores[0], colores[1], colores[2]);
}

// La cifra de la derecha, como la campana: azul lleno si es urgente, azul suave si es un aviso.
function cifraBadge(item) {
  const estilo = item.tono === 'late'
    ? `background:${C.brand};color:#ffffff;`
    : item.tono === 'warn' ? `background:${C.brandSoft};color:${C.green};` : `background:${C.gray};color:${C.muted};`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="right" style="border-collapse:separate;"><tr>
    <td align="center" style="${estilo}border-radius:8px;padding:4px 8px;min-width:56px;font-family:${FONT};">
      <div style="font-size:15px;font-weight:700;line-height:1.1;white-space:nowrap;">${esc(item.cifra)}</div>
      <div style="font-size:9px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;">${esc(item.unidad)}</div>
    </td></tr></table>`;
}

function filaAviso(item, i) {
  const borde = i ? `border-top:1px solid ${C.lineSoft};` : '';
  return `<tr>
    <td style="padding:10px 12px;${borde}font-family:${FONT};">
      <div style="font-size:13px;font-weight:600;color:${C.ink};">${esc(item.titulo)}</div>
      <div style="margin-top:5px;">${badgeEstado(item.etiqueta, item.tonoEstado)}</div>
      <div style="font-size:12px;color:${C.subtle};margin-top:5px;line-height:1.5;">${esc(item.texto)}</div>
      ${item.apoyo ? `<div style="font-size:12px;color:${C.subtle};margin-top:2px;line-height:1.5;">${esc(item.apoyo)}</div>` : ''}
    </td>
    <td width="76" valign="middle" style="padding:10px 12px;${borde}">${cifraBadge(item)}</td>
  </tr>`;
}

const etiqueta = texto =>
  `<div style="font-size:11px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">${texto}</div>`;

const tarjeta = cuerpo =>
  `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;">
      <tr><td style="padding:20px;font-family:${FONT};">${cuerpo}</td></tr>
    </table>
  </td></tr>`;

function kpi(etiquetaKpi, valor, sub) {
  return `<td valign="top" width="49%" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;padding:12px 14px;font-family:${FONT};">
    <div style="font-size:10px;font-weight:700;color:${C.subtle};text-transform:uppercase;letter-spacing:0.1em;">${esc(etiquetaKpi)}</div>
    <div style="font-size:19px;font-weight:700;color:${C.ink};margin-top:6px;">${esc(valor)}</div>
    <div style="font-size:11px;color:${C.subtle};margin-top:4px;line-height:1.4;">${esc(sub)}</div>
  </td>`;
}

// Las cuatro cifras del mes: lo asignado (con lo de cada plataforma debajo), lo gastado, el ritmo
// diario con el ideal que haría cerrar en lo asignado, y la proyección al cierre con su desvío.
function totalDelMesHtml(modelo) {
  const total = gastoTotalDelMes(modelo);
  const moneda = total.moneda;
  const partes = GASTO_PLATAFORMAS
    .map(plataforma => ({ plataforma, valor: total.plataformas?.[plataforma.id]?.presupuesto || 0 }))
    .filter(parte => parte.valor)
    .map(parte => `${parte.plataforma.label} ${gastoMonto(parte.valor, moneda)}`);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr>
        ${kpi('Asignado', total.presupuesto ? gastoMonto(total.presupuesto, moneda) : '—', partes.join(' · ') || 'Ninguna cuenta con presupuesto')}
        <td width="8" style="width:8px;"></td>
        ${kpi('Gastado', gastoMonto(total.gastado, moneda), total.presupuesto ? `${fmtMetricPercent(total.consumido * 100)} de lo asignado` : 'Sin presupuesto con qué compararlo')}
      </tr>
      <tr><td colspan="3" height="8" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
      <tr>
        ${kpi('Ritmo diario', gastoMonto(total.ritmo, moneda), total.porDia
          ? `Ideal ${gastoMonto(total.porDia, moneda)}/día en los ${total.restan} ${total.restan === 1 ? 'día' : 'días'} que quedan`
          : 'Sin ritmo que exigir')}
        <td width="8" style="width:8px;"></td>
        ${kpi('Proyección al cierre', gastoMonto(total.proyeccion, moneda), total.presupuesto
          ? `${total.desvio >= 0 ? '+' : '−'}${gastoMonto(Math.abs(total.desvio), moneda)} frente a lo asignado`
          : 'Sin presupuesto asignado')}
      </tr>
    </table>`;
}

// ── El pacing de cada canal, día a día ────────────────────────
// El mismo bloque que el panel («Pacing de gasto por canal y día», gastoPacingCanales() y
// gastoCanalChartHtml() en index.html): cada plataforma contra su línea ideal a lo largo de los
// días del mes. Si cambia uno, cambia el otro.
//
// El correo no puede llevar el SVG del panel: Gmail borra los <svg> y bloquea las imágenes en
// data:, así que el gráfico se dibuja con tablas —una columna por día del mes y, en cada una, dos
// marcas: por dónde va el gasto y por dónde iría la línea ideal—. Es el mismo dibujo con la única
// herramienta que entienden todos los clientes de correo.
//
// Solo entran las cuentas con presupuesto asignado, igual que el consumido y el desvío de
// gastoResumen: contra las demás no hay línea ideal que comparar.
function pacingCanales(modelo) {
  if (!modelo.totales || !modelo.porPlataforma) return [];
  const { dias, diasMes, moneda } = modelo.totales;
  const canal = (label, resumen) => {
    const presupuesto = resumen.presupuesto;
    const gastado = resumen.gastadoAsignado;
    const proyeccion = resumen.proyeccionAsignada;
    return {
      label,
      moneda,
      diasMes,
      dias: Math.min(Math.max(dias, 1), diasMes),
      presupuesto,
      gastado,
      proyeccion,
      // El ritmo de la curva es el de las cuentas con presupuesto, no el de todas: si no, la recta
      // no terminaría en el punto que dibuja el gráfico.
      ritmo: dias ? gastado / dias : 0,
      idealDiario: presupuesto ? presupuesto / diasMes : 0,
      consumido: presupuesto ? gastado / presupuesto : 0,
      desvio: presupuesto ? proyeccion - presupuesto : 0,
      cuentas: resumen.cuentas,
      conPresupuesto: resumen.conPresupuesto,
      estado: gastoEstadoDe(presupuesto, gastado, proyeccion),
    };
  };
  const canales = modelo.porPlataforma
    .filter(plataforma => plataforma.resumen.cuentas)
    .map(plataforma => canal(plataforma.label, plataforma.resumen))
    .filter(uno => uno.presupuesto || uno.gastado);
  // El total solo cuando hay dos canales: con uno repetiría la misma curva debajo.
  if (canales.length > 1) canales.push(canal('Las dos plataformas', modelo.totales));
  return canales;
}

const GRAFICO_ALTO = 76;
const GRAFICO_IDEAL = '#94a3b8';
// Un hueco y una marca: con el alto en el estilo y en el atributo, y la línea y la letra a cero,
// para que Outlook no le sume el alto de una línea de texto a cada bloque.
const grafHueco = alto => (alto > 0 ? `<div style="height:${alto}px;line-height:${alto}px;font-size:0;">&#8203;</div>` : '');
const grafMarca = color => `<div style="height:3px;line-height:3px;font-size:0;background:${color};">&#8203;</div>`;

function graficoCanalHtml(canal) {
  const { dias, diasMes, presupuesto, ritmo, moneda } = canal;
  // Un poco de aire sobre la cifra más alta para que la curva no toque el borde.
  const tope = Math.max(presupuesto, canal.proyeccion, canal.gastado) * 1.08;
  if (!tope) return '';
  // Pasado el día del informe ya no hay dato, hay cálculo: la marca cambia al color del semáforo.
  const colorProyeccion = canal.estado.tono === 'rose' ? C.rose : canal.estado.tono === 'amber' ? C.amber : C.brand;
  const alto = valor => Math.round((1 - Math.min(valor, tope) / tope) * GRAFICO_ALTO);
  const columnas = [];
  for (let dia = 1; dia <= diasMes; dia++) {
    // La recta del gasto y la recta del ideal. La del gasto es una sola para todo el mes: pasado el
    // corte, la proyección continúa el mismo ritmo.
    const puntos = [{ arriba: alto(ritmo * dia), color: dia <= dias ? C.brand : colorProyeccion }];
    if (presupuesto) puntos.push({ arriba: alto((presupuesto * dia) / diasMes), color: GRAFICO_IDEAL });
    puntos.sort((izq, der) => izq.arriba - der.arriba);
    let usado = 0;
    let celda = '';
    puntos.forEach(punto => {
      celda += grafHueco(punto.arriba - usado) + grafMarca(punto.color);
      usado = punto.arriba + 3;
    });
    // Todas las columnas terminan a la misma altura: así la franja del día del corte llega de
    // arriba abajo y la línea del eje queda recta por debajo de todas.
    celda += grafHueco(GRAFICO_ALTO + 3 - usado);
    // El día hasta donde llega el informe: a su derecha ya no hay dato, hay cálculo. Sin esta
    // franja, un canal en ritmo dibuja la proyección del mismo azul que el gasto y no habría
    // manera de ver dónde termina lo que de verdad se gastó.
    const franja = dia === dias ? ` background:${C.gray};` : '';
    columnas.push(`<td valign="top" style="padding:0 1px;${franja}">${celda}</td>`);
  }
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse;margin-top:8px;">
      <tr>${columnas.join('')}</tr>
      <tr><td colspan="${diasMes}" height="1" bgcolor="${C.line}" style="height:1px;line-height:1px;font-size:0;">&#8203;</td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:3px;font-family:${FONT};">
      <tr>
        <td align="left" style="font-size:10px;color:${C.subtle};">1</td>
        <td align="center" style="font-size:10px;color:${C.subtle};">día ${dias} · hasta donde llega el informe</td>
        <td align="right" style="font-size:10px;color:${C.subtle};">${diasMes}</td>
      </tr>
    </table>
    <div style="font-size:12px;color:${C.muted};margin-top:7px;line-height:1.5;">
      <strong style="color:${C.ink};">${esc(gastoMonto(canal.gastado, moneda))}</strong> de ${presupuesto ? esc(gastoMonto(presupuesto, moneda)) : '—'}${presupuesto ? ` · ${fmtMetricPercent(canal.consumido * 100)}` : ''} ·
      ritmo ${esc(gastoMonto(ritmo, moneda))}/día${canal.idealDiario ? ` contra ${esc(gastoMonto(canal.idealDiario, moneda))} de la línea ideal` : ''} ·
      cierra en <strong style="color:${C.ink};">${esc(gastoMonto(canal.proyeccion, moneda))}</strong>${presupuesto ? ` (${canal.desvio >= 0 ? '+' : '−'}${esc(gastoMonto(Math.abs(canal.desvio), moneda))})` : ''}
    </div>`;
}

// Los tres gráficos van uno debajo de otro y no en columnas: a 600 px de ancho, tres gráficos de
// 30 días al lado darían columnas de dos píxeles y no se leería ninguno.
function tarjetaCanales(modelo) {
  const canales = pacingCanales(modelo);
  if (!canales.length) return '';
  const total = modelo.totales;
  const leyenda = (color, texto) =>
    `<span style="white-space:nowrap;"><span style="display:inline-block;width:14px;height:3px;background:${color};vertical-align:middle;"></span> <span style="color:${C.subtle};">${texto}</span></span>`;
  return tarjeta(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:15px;font-weight:700;color:${C.ink};font-family:${FONT};">Pacing por canal y día</td>
        <td align="right">${pill(`${total.dias} de ${total.diasMes} días`, C.muted, C.gray, C.lineSoft)}</td>
      </tr>
    </table>
    ${canales.map((canal, i) => `
      <div style="${i ? `margin-top:14px;padding-top:14px;border-top:1px solid ${C.lineSoft};` : 'margin-top:12px;'}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;font-weight:600;color:${C.ink};font-family:${FONT};">${esc(canal.label)}
              <span style="font-weight:400;color:${C.subtle};">· ${plural(canal.conPresupuesto, 'cuenta', 'cuentas')} con presupuesto</span>
            </td>
            <td align="right">${badgeEstado(canal.estado.texto, canal.estado.tono)}</td>
          </tr>
        </table>
        ${graficoCanalHtml(canal)}
      </div>`).join('')}
    <div style="font-size:11px;color:${C.subtle};margin-top:12px;line-height:1.6;">
      ${leyenda(GRAFICO_IDEAL, 'línea ideal del presupuesto')} &nbsp; ${leyenda(C.brand, 'gastado hasta el informe')} &nbsp; ${leyenda(C.amber, 'proyección al cierre, en el color del semáforo')}<br>
      La línea gris es el presupuesto asignado repartido por igual entre los ${total.diasMes} días del mes: por encima de ella el canal va
      adelantado y por debajo, atrasado. La franja marca el día ${total.dias}, hasta donde llega el informe; a su derecha es proyección.
      El informe trae el acumulado del mes, no el gasto de cada día, así que la línea azul sube al ritmo medio: la cifra del corte es real
      y la forma del camino no.
    </div>
  `);
}

function tarjetaAvisos(titulo, items, vacio) {
  return tarjeta(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:15px;font-weight:700;color:${C.ink};font-family:${FONT};">${esc(titulo)}</td>
        <td align="right">${pill(items.length ? plural(items.length, 'aviso', 'avisos') : 'Sin avisos', C.muted, C.gray, C.lineSoft)}</td>
      </tr>
    </table>
    ${items.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid ${C.line};border-radius:10px;border-collapse:separate;border-spacing:0;">
          ${items.map(filaAviso).join('')}
        </table>`
      : `<div style="margin-top:10px;border:1px dashed ${C.line};border-radius:10px;padding:16px;font-size:13px;color:${C.subtle};">${esc(vacio)}</div>`}
  `);
}

// Un informe atrasado no se puede presentar como el gasto de hoy. Hay dos formas de estarlo: que el
// último informe sea de un mes que ya cerró, con lo que todo el correo habla del mes pasado, o que
// sea del mes en curso pero lleve días sin actualizarse. Mismo criterio que el módulo y la campana
// (index.html, gastoInformeVejez): si cambia acá, cambia también allá.
const GASTO_INFORME_HORAS = 72;

function gastoInformeVejez(modelo, hoy) {
  const informe = modelo?.informe;
  if (!informe || !modelo.mes) return null;
  const enCurso = String(hoy).slice(0, 7);
  if (modelo.mes < enCurso) {
    return {
      tono: 'late',
      titulo: `El último informe es de ${gastoMesEtiqueta(modelo.mes)}`,
      texto: `No hay informe de ${gastoMesEtiqueta(enCurso)}: todo lo que dice este correo es el gasto de ${gastoMesEtiqueta(modelo.mes)}${informe.hasta ? `, hasta el ${fechaCorta(informe.hasta)}` : ''}. No es el gasto de este mes.`,
    };
  }
  if (!informe.hasta) return null;
  const horas = (Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${informe.hasta}T23:59:59Z`)) / 3600000;
  if (horas <= GASTO_INFORME_HORAS) return null;
  return {
    tono: 'warn',
    titulo: `El informe no se actualiza hace ${plural(Math.floor(horas / 24), 'día', 'días')}`,
    texto: `Llega hasta el ${fechaCorta(informe.hasta)}: el gastado, los semáforos y las proyecciones de este correo son de esa fecha.`,
  };
}

function armarCorreo(modelo, hoy) {
  const items = gastoNotificationItems(modelo);
  const urgentes = items.filter(item => item.tono === 'late').length;
  const pacing = items.filter(item => item.familia === 'pacing');
  const diario = items.filter(item => item.familia === 'diario');
  const mes = modelo.mes ? gastoMesEtiqueta(modelo.mes) : '';
  const vejez = gastoInformeVejez(modelo, hoy);

  // Con el informe de un mes cerrado, el asunto lo dice antes que nada: si no, «8 avisos, 1 para
  // hoy» se lee como ocho marcas desbocadas hoy, y son la foto del mes pasado.
  const asunto = !modelo.informe
    ? `LR Suite · Alertas de gasto del ${fechaCorta(hoy)}: todavía no hay informe cargado`
    : vejez?.tono === 'late'
      ? `LR Suite · Alertas de gasto del ${fechaCorta(hoy)}: sin informe de ${gastoMesEtiqueta(String(hoy).slice(0, 7))} · ${items.length ? `${plural(items.length, 'aviso', 'avisos')} de ${mes}` : `todo en ritmo en ${mes}`}`
      : items.length
        ? `LR Suite · Alertas de gasto del ${fechaCorta(hoy)}: ${plural(items.length, 'aviso', 'avisos')}${urgentes ? `, ${urgentes} para hoy` : ''} · ${mes}`
        : `LR Suite · Alertas de gasto del ${fechaCorta(hoy)}: todo en ritmo en ${mes}`;

  const titular = !modelo.informe
    ? 'Todavía no hay informe cargado'
    : items.length
      ? [plural(items.length, 'aviso', 'avisos'), urgentes ? `${urgentes} para hoy` : '', mes].filter(Boolean).join(' · ')
      : `Todo en ritmo en ${mes}`;

  const bajada = !modelo.informe
    ? 'Sube el informe de Google Ads en Alertas de Gasto para que haya qué avisar.'
    : [
      `Informe de ${mes}: ${modelo.totales.dias} de ${modelo.totales.diasMes} días`,
      `${plural(modelo.totales.cuentas, 'cuenta', 'cuentas')}, ${modelo.totales.conPresupuesto} con presupuesto`,
      modelo.totales.sinCambio ? `${modelo.totales.sinCambio} en otra moneda, fuera del total` : '',
    ].filter(Boolean).join(' · ');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<title>LR Suite · Alertas de gasto</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:${FONT};">

    <!-- Encabezado: la marca como en la barra lateral de la Suite -->
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;">
        <tr>
          <td style="padding:14px 12px 14px 20px;width:44px;" width="44"><img src="${LOGO}" width="44" height="44" alt="Lima Retail" style="display:block;width:44px;height:44px;border:0;"></td>
          <td style="padding:14px 0;">
            <div style="font-size:18px;font-weight:800;color:${C.ink};line-height:1.1;">LR Suite</div>
            <div style="font-size:12px;color:${C.subtle};margin-top:3px;">Lima Retail · Alertas de Gasto</div>
          </td>
          <td align="right" style="padding:14px 20px;">${pill(esc(fechaCorta(hoy)), C.green, C.brandSoft, C.brandLine)}</td>
        </tr>
      </table>
    </td></tr>

    ${vejez ? tarjeta(`
      ${etiqueta('Informe atrasado')}
      <div style="font-size:16px;font-weight:700;color:${vejez.tono === 'late' ? C.rose : C.amber};line-height:1.3;">${esc(vejez.titulo)}</div>
      <div style="font-size:13px;color:${C.muted};margin-top:6px;line-height:1.5;">${esc(vejez.texto)}</div>
    `) : ''}

    ${tarjeta(`
      ${etiqueta(`${modelo.informe ? 'Total del mes' : 'Alertas de gasto'} · ${esc(fechaLarga(hoy))}`)}
      <div style="font-size:20px;font-weight:700;color:${C.ink};">${esc(titular)}</div>
      <div style="font-size:14px;color:${C.muted};margin-top:6px;line-height:1.5;">${esc(bajada)}</div>
      ${modelo.informe ? totalDelMesHtml(modelo) : ''}
    `)}

    ${modelo.informe ? tarjetaCanales(modelo) : ''}
    ${modelo.informe ? tarjetaAvisos('Pacing por marca', pacing, 'Ninguna marca se sale de lo asignado.') : ''}
    ${modelo.informe ? tarjetaAvisos('Gasto diario', diario, 'Ningún salto en el gasto diario ni tope suelto.') : ''}

    <tr><td align="center" style="padding:22px 0 8px;">
      <a href="${SUITE_URL}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;font-family:${FONT};">Abrir Alertas de Gasto</a>
    </td></tr>
    <tr><td align="center" style="padding:8px 0 0;font-size:11px;line-height:1.6;color:${C.subtle};font-family:${FONT};">
      Llega todos los días a las 8:30 a. m. con lo mismo que avisa la campana de la Suite.<br>
      El pacing sale del informe del mes; el gasto diario se compara con el mes anterior.<br>
      Los correos que lo reciben se cambian con la ruedita del panel de Notificaciones de LR Suite.
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
  return { asunto, html, items, urgentes, pacing, diario, vejez };
}

// ── El Control de Automatización ──────────────────────────────
// Al terminar, el script anota su propia corrida en la pieza «correo-gasto»
// (src/modules/control-automatizacion/BBDD/correos-automatizacion.sql). Hacen falta las dos: la de
// pg_cron solo dice que GitHub aceptó arrancar el workflow, y esta dice si el correo salió. Usa la
// misma clave con la que pidió los datos, así que no hay ningún secreto nuevo que guardar.
//
// Nunca tumba el envío: si el Control no está instalado o la llamada falla, se avisa y ya. Un
// correo que salió bien no se convierte en una corrida fallida porque no se pudo anotar.
const INICIO = new Date().toISOString();

async function anotarCorrida(estado, detalle = {}, error = null) {
  if (DATOS || PREVIEW || DRY_RUN) return;
  const clave = process.env.LR_GASTO_CLAVE;
  if (!clave) return;
  try {
    const { url, key } = supabaseConfig();
    const res = await fetch(`${url}/rest/v1/rpc/lr_suite_correo_anotar`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_clave: clave,
        p_pieza: 'correo-gasto',
        p_estado: estado,
        p_detalle: detalle,
        p_error: error,
        p_desde: INICIO,
      }),
    });
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => null);
      const motivo = (cuerpo && (cuerpo.message || cuerpo.hint)) || `HTTP ${res.status}`;
      // PGRST202 = la función no existe todavía: el Control no está instalado y no es un problema.
      console.warn(`⚠  No se anotó la corrida en el Control de Automatización: ${motivo}`);
    }
  } catch (err) {
    console.warn(`⚠  No se anotó la corrida en el Control de Automatización: ${err.message}`);
  }
}

// ── Envío por el correo del hosting (SMTP) ────────────────────
// El remitente es la misma cuenta que se autentica: los hostings rechazan un "From" de otra cuenta.
async function enviar(destinatarios, asunto, html) {
  const faltan = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(nombre => !process.env[nombre]);
  if (faltan.length) throw new Error(`faltan ${faltan.join(', ')} (correo del hosting)`);
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: `LR Suite <${process.env.SMTP_USER}>`,
    to: destinatarios.map(d => d.email),
    subject: asunto,
    html,
  });
  return info.messageId || '(sin id)';
}

async function main() {
  const hoy = diaLima(Date.now());
  const datos = await leerAlertas();
  const modelo = gastoModelo(datos.gasto && typeof datos.gasto === 'object' ? datos.gasto : {});
  const destinatarios = (Array.isArray(datos.destinatarios) ? datos.destinatarios : []).filter(d => d && d.email);
  const { asunto, html, items, urgentes, pacing, diario, vejez } = armarCorreo(modelo, hoy);
  const para = destinatarios.map(d => (d.nombre ? `${d.nombre} <${d.email}>` : d.email)).join(', ');

  console.log(`▶ Alertas de gasto · ${hoy}`);
  console.log(`  Informe    : ${modelo.mes || '(ninguno)'}${vejez ? ` ⚠ ${vejez.titulo}` : ''}`);
  console.log(`  Avisos     : ${items.length} (${urgentes} para hoy · ${pacing.length} de pacing · ${diario.length} de gasto diario)`);
  console.log(`  Asunto     : ${asunto}`);
  console.log(`  Para       : ${para || '(nadie)'}`);

  if (PREVIEW) {
    fs.writeFileSync(PREVIEW, html, 'utf8');
    console.log(`🖼  Vista previa escrita en ${PREVIEW} (sin envío).`);
    return { enviados: 0 };
  }
  if (DRY_RUN) {
    console.log('[DRY-RUN] Sin envío.');
    return { enviados: 0 };
  }
  if (!destinatarios.length) {
    console.log('⏭  La lista de correos está vacía: no se envía.');
    return { enviados: 0 };
  }
  const id = await enviar(destinatarios, asunto, html);
  console.log(`✅ Correo enviado por el correo del hosting (${process.env.SMTP_HOST}). ID: ${id}`);
  return { enviados: destinatarios.length, avisos: items.length, mes: modelo.mes || '' };
}

main()
  .then((resumen) => anotarCorrida('ok', resumen || {}))
  .catch(async (err) => {
    console.error(`❌ ${err.message}`);
    await anotarCorrida('error', {}, err.message);
    process.exit(1);
  });
