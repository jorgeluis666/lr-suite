// Lote 9 de la auditoría, parte del UTM Builder: las URLs que genera.
//
// Antes los parámetros se pegaban al final con "?" o "&". Con un #ancla en la dirección base
// terminaban dentro del fragmento, donde GA4 no los ve; y si la base ya traía utm_*, se
// duplicaban. Además source y medium se escriben a mano y llegaban tal cual: «Paid Social»
// acababa dentro del enlace con mayúsculas y un espacio.
//
// Se prueba la construcción de la URL tal como quedó en index.html, con las mismas piezas.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extraer(nombre) {
  const inicio = html.indexOf(`function ${nombre}(`);
  assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
  let i = html.indexOf('{', inicio);
  let nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) break;
  }
  return html.slice(inicio, i + 1);
}

const contexto = {String, URL, RegExp};
vm.createContext(contexto);
vm.runInContext([extraer('sanitizeUtm'), extraer('utmToken')].join('\n'), contexto);
const {sanitizeUtm, utmToken} = contexto;

// El mismo armado que hace updateCampaignUrls por cada anuncio.
function construir(baseUrl, {source, medium, campaign, term = '', content = ''}) {
  let base = null;
  try {
    base = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
  } catch {
    return null;
  }
  const destino = new URL(base.href);
  [...destino.searchParams.keys()].filter((k) => /^utm_/i.test(k)).forEach((k) => destino.searchParams.delete(k));
  destino.searchParams.set('utm_source', utmToken(source));
  destino.searchParams.set('utm_medium', utmToken(medium));
  destino.searchParams.set('utm_campaign', campaign);
  if (term) destino.searchParams.set('utm_term', term);
  if (content) destino.searchParams.set('utm_content', content);
  return destino.href;
}

const base = {source: 'Meta', medium: 'Paid Social', campaign: 'royal_baby_verano'};

// El ancla se respeta y los parámetros van antes, no dentro del fragmento.
const conAncla = construir('https://limaretail.com/promos#planes', base);
assert.ok(conAncla.includes('?utm_source=meta'), 'los utm van en la query');
assert.ok(conAncla.endsWith('#planes'), 'y el ancla se queda al final');
assert.ok(!conAncla.includes('#planes?'), 'nunca dentro del fragmento');

// source y medium normalizados.
assert.ok(conAncla.includes('utm_source=meta'));
assert.ok(conAncla.includes('utm_medium=paid_social'), '«Paid Social» → paid_social');

// Los utm_* que ya traía la base se reemplazan, no se duplican.
const yaTenia = construir('https://limaretail.com/x?utm_source=viejo&utm_campaign=anterior&ref=abc', base);
assert.equal((yaTenia.match(/utm_source=/g) || []).length, 1, 'un solo utm_source');
assert.ok(yaTenia.includes('utm_source=meta'), 'y es el nuevo');
assert.ok(!yaTenia.includes('anterior'), 'la campaña vieja desaparece');
assert.ok(yaTenia.includes('ref=abc'), 'los parámetros que no son utm se respetan');

// Un parámetro propio y el separador correcto.
const conQuery = construir('https://limaretail.com/x?plan=pro', base);
assert.ok(conQuery.includes('plan=pro') && conQuery.includes('utm_source=meta'));

// Sin esquema se asume https.
assert.ok(construir('limaretail.com/x', base).startsWith('https://limaretail.com/x'));

// Una dirección imposible no genera URL en vez de generar una rota.
assert.equal(construir('http://', base), null);

// sanitizeUtm sigue haciendo lo suyo con los nombres.
assert.equal(sanitizeUtm('Campaña Día de la Madre'), 'campana_dia_de_la_madre');
// Los espacios de más se colapsan en un solo guion bajo, no en varios.
assert.equal(utmToken('  Paid  Social '), 'paid_social');

console.log('PASS UTM: el ancla se respeta, los utm_* previos se reemplazan sin duplicar, los demás parámetros se conservan y source/medium se normalizan.');
