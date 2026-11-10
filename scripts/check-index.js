// Comprueba que lo que se va a publicar al menos compila.
//
// GitHub Pages publica desde la rama: un push con un error de sintaxis en index.html se sirve
// igual, y lo que ve la gente es una página en blanco o la portada colgada. Esto no prueba que la
// app funcione —para eso están tests/—, prueba lo mínimo: que todo el JavaScript que el navegador
// va a ejecutar se puede compilar, que las llaves del CSS cierran y que los archivos que
// index.html carga existen de verdad.
//
// Solo usa módulos de Node: no hace falta npm install para correrlo.
//
//   node scripts/check-index.js
//
// Sale con código 1 y dice qué falló. Si pasa, no imprime nada más que el resumen.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const raiz = path.resolve(__dirname, "..");
const problemas = [];
let revisados = 0;

function leer(relativo) {
  return fs.readFileSync(path.join(raiz, relativo), "utf8");
}

// ── 1. El JavaScript escrito dentro de index.html ──────────────────────────
const html = leer("index.html");
const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!inline.length) problemas.push("index.html no tiene ningún <script> propio: algo se rompió al generarlo");
inline.forEach((coincidencia, i) => {
  revisados += 1;
  try {
    new vm.Script(coincidencia[1]);
  } catch (error) {
    // La línea que da el error es relativa al bloque; se traduce a la del archivo para poder ir.
    const lineaDelBloque = Number((String(error.stack || "").match(/evalmachine[^:]*:(\d+)/) || [])[1] || 0);
    const lineaInicial = html.slice(0, coincidencia.index).split("\n").length;
    problemas.push(
      `index.html, bloque <script> nº ${i + 1} (línea ~${lineaInicial + lineaDelBloque}): ${error.message}`
    );
  }
});

// ── 2. Los archivos que index.html carga ───────────────────────────────────
// Una ruta mal escrita no rompe el compilado, pero deja el módulo sin su código y el fallo
// aparece recién al abrir esa pantalla.
const referencias = [...html.matchAll(/(?:src|href)="\.\/([^"?]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);
for (const relativa of new Set(referencias)) {
  if (!fs.existsSync(path.join(raiz, relativa))) problemas.push(`index.html carga «${relativa}», que no existe`);
}

// ── 3. El JavaScript de los módulos y los scripts de correo ────────────────
const sueltos = [...new Set(referencias.filter((r) => r.endsWith(".js")))];
for (const relativa of sueltos) {
  if (!fs.existsSync(path.join(raiz, relativa))) continue;
  revisados += 1;
  try {
    new vm.Script(leer(relativa));
  } catch (error) {
    problemas.push(`${relativa}: ${error.message}`);
  }
}
for (const relativa of ["lr-suite-config.js"]) {
  if (!fs.existsSync(path.join(raiz, relativa))) {
    problemas.push(`falta ${relativa}: sin él no hay login`);
    continue;
  }
  revisados += 1;
  try {
    new vm.Script(leer(relativa));
  } catch (error) {
    problemas.push(`${relativa}: ${error.message}`);
  }
}

// ── 4. Las llaves del CSS ──────────────────────────────────────────────────
// Una llave sin cerrar no da error en ningún sitio: simplemente deja de aplicarse todo lo que
// viene después, y la página sale descuadrada sin una sola queja en la consola.
const estilos = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
estilos.forEach((css, i) => {
  revisados += 1;
  let nivel = 0;
  for (const caracter of css) {
    if (caracter === "{") nivel += 1;
    else if (caracter === "}") nivel -= 1;
    if (nivel < 0) break;
  }
  if (nivel !== 0) {
    problemas.push(`index.html, bloque <style> nº ${i + 1}: las llaves no cierran (sobran ${nivel > 0 ? nivel + " abiertas" : -nivel + " cerradas"})`);
  }
});
const css = [...new Set(referencias.filter((r) => r.endsWith(".css")))];
for (const relativa of css) {
  if (!fs.existsSync(path.join(raiz, relativa))) continue;
  revisados += 1;
  let nivel = 0;
  for (const caracter of leer(relativa)) {
    if (caracter === "{") nivel += 1;
    else if (caracter === "}") nivel -= 1;
  }
  if (nivel !== 0) problemas.push(`${relativa}: las llaves del CSS no cierran`);
}

// ── Resultado ──────────────────────────────────────────────────────────────
if (problemas.length) {
  console.error(`✗ ${problemas.length} problema${problemas.length === 1 ? "" : "s"} que impiden publicar:\n`);
  for (const problema of problemas) console.error(`  · ${problema}`);
  process.exit(1);
}
console.log(`✓ ${revisados} piezas revisadas: el JavaScript compila, el CSS cierra y los archivos que index.html carga existen.`);
