import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const start = html.indexOf('      function acrmLinkedinAbrirLote(');
const source = html.slice(start, html.indexOf('\n      }', start) + 8);
const cola = Array.from({length: 23}, (_, i) => ({url: `https://www.linkedin.com/in/contacto-${i}`}));
const estado = {cola, abiertos: new Set()};
const ventanas = [], avisos = [];
let bloquear = false;
const c = vm.createContext({
  acrmLinkedin: estado,
  acrmLeadAviso: texto => avisos.push(texto),
  window: {
    LRACRMLeads: {perfilLinkedin: url => url.startsWith('https://www.linkedin.com/in/') ? url : ''},
    open: (url, destino) => {
      assert.equal(url, 'about:blank');
      assert.equal(destino, '_blank');
      if (bloquear) return null;
      const ventana = {opener: 'original', location: {replace: url => ventana.url = url}};
      ventanas.push(ventana);
      return ventana;
    }
  }
});
vm.runInContext(source, c);
const abrir = () => vm.runInContext('acrmLinkedinAbrirLote()', c);
abrir();
assert.equal(ventanas.length, 10);
assert.deepEqual(ventanas.map(v => v.url), cola.slice(0, 10).map(p => p.url));
assert.ok(ventanas.every(v => v.opener === null));
bloquear = true;
abrir();
assert.equal(estado.abiertos.size, 10, 'un bloqueo no consume perfiles');
assert.match(avisos.at(-1), /Permite las ventanas emergentes/);
bloquear = false;
abrir();
assert.equal(ventanas.length, 20);
abrir();
assert.equal(ventanas.length, 23);
assert.equal(new Set(ventanas.map(v => v.url)).size, 23, 'no repite pestañas');
abrir();
assert.equal(ventanas.length, 23);
assert.match(avisos.at(-1), /Registra los mensajes/);
estado.cola = [{url: 'javascript:alert(1)'}];
abrir();
assert.equal(ventanas.length, 23, 'no abre destinos ajenos a perfiles LinkedIn');
console.log('OK: lotes de 10, destinos, aislamiento, bloqueos y reintentos sin duplicados');
