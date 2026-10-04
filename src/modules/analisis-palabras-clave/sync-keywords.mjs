#!/usr/bin/env node
// Análisis de Palabras Clave: sincronización desde Google Drive con el mismo lector que usa el
// index.html (keyword-report.js). Sirve para verificar los informes y revisar los datos en local; la
// actualización diaria del sitio la hace Supabase (BBDD/sincronizacion-drive.sql).
//
// Uso:
//   node src/modules/analisis-palabras-clave/sync-keywords.mjs --folder <ID>   lee la carpeta y guarda
//   node src/modules/analisis-palabras-clave/sync-keywords.mjs --check         solo informa, no escribe
//   node src/modules/analisis-palabras-clave/sync-keywords.mjs --file <csv>    importa un informe local
//
// Opciones y variables:
//   --folder <ID> o LR_KEYWORDS_FOLDER_ID   carpeta de Drive (después se recuerda en el manifiesto).
//   --out <dir>                            salida; por defecto private/palabras-clave (fuera de git).
//   GOOGLE_DRIVE_API_KEY                   opcional: lista la carpeta con Drive API v3.
//
// Salida: keywords.json (modelo normalizado), manifest.json (archivos leídos) y raw/ (copia cruda de
// cada informe). Código de salida 1 si no se pudo leer ningún informe o si un mes no cuadra con su
// fila de totales.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const report = require("./keyword-report.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");

function readArgs(argv) {
  const args = { check: false, folder: "", file: "", out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") args.check = true;
    else if (arg === "--folder") args.folder = argv[++index] || "";
    else if (arg === "--file") args.file = argv[++index] || "";
    else if (arg === "--out") args.out = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Opción desconocida: ${arg}`);
  }
  return args;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// Orden: Drive API (si hay key), vista pública de la carpeta, último manifiesto guardado.
async function listFolder(folderId, previousManifest) {
  const errors = [];
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (apiKey) {
    try {
      const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,modifiedTime)&pageSize=1000&key=${apiKey}`;
      const data = JSON.parse(await fetchText(url));
      return { discovery: "drive-api", files: (data.files || []).filter(report.isReportFile), errors };
    } catch (error) {
      errors.push(`Drive API: ${error.message}`);
    }
  }
  try {
    const html = await fetchText(`https://drive.google.com/embeddedfolderview?id=${folderId}`);
    const files = report.parseFolderHtml(html).filter(report.isReportFile);
    if (!files.length) throw new Error("la carpeta no muestra hojas ni CSV (¿sigue compartida por enlace?)");
    return { discovery: "embeddedfolderview", files, errors };
  } catch (error) {
    errors.push(`vista pública: ${error.message}`);
  }
  if (previousManifest?.files?.length && previousManifest.folderId === folderId) {
    return { discovery: "manifest", files: previousManifest.files, errors };
  }
  throw new Error(`No se pudo listar la carpeta: ${errors.join(" · ")}`);
}

const fmt = (value, digits = 0) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("es-PE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function printVerification(checks) {
  const lines = [
    ["Mes", "Filas", "Impr. filas", "Impr. total", "Clics filas", "Clics total", "Costo filas", "Costo total", "Dif. costo", "Conv. filas", "Conv. total", "Cuadra"]
  ];
  checks.forEach(({ month, check }) => {
    lines.push([
      month.id,
      fmt(check.rows),
      fmt(check.sums.impressions),
      fmt(check.totals?.impressions),
      fmt(check.sums.clicks),
      fmt(check.totals?.clicks),
      fmt(check.sums.cost, 2),
      fmt(check.totals?.cost, 2),
      check.diff ? fmt(check.diff.cost, 2) : "—",
      fmt(check.sums.conversions, 2),
      fmt(check.totals?.conversions, 2),
      check.ok === null ? "sin total" : check.ok ? "sí" : "NO"
    ]);
  });
  const widths = lines[0].map((_, column) => Math.max(...lines.map((line) => String(line[column]).length)));
  console.log("\nVerificación contra la fila de totales de cada informe:");
  lines.forEach((line, index) => {
    console.log(line.map((cell, column) => (column === 0 ? String(cell).padEnd(widths[column]) : String(cell).padStart(widths[column]))).join("  "));
    if (index === 0) console.log(widths.map((width) => "-".repeat(width)).join("  "));
  });
  const excluded = checks.filter(({ month }) => month.excluded.rows);
  if (excluded.length) {
    console.log("\nCampañas excluidas (no entran al modelo; sí a la verificación, porque el total del informe las incluye):");
    excluded.forEach(({ month }) => {
      const { campaigns, impressions, clicks, cost, conversions } = month.excluded;
      if (impressions || clicks || cost || conversions) {
        console.log(`  ${month.id}  ${campaigns.join(", ")}: ${fmt(impressions)} impr. · ${fmt(clicks)} clics · ${fmt(cost, 2)} ${month.currency} · ${fmt(conversions, 2)} conv.`);
      }
    });
  }
}

// Compara el contenido sin las marcas de tiempo (la vista pública muestra "10:12 pm" hoy y una fecha
// mañana): solo cuenta como cambio lo que cambia los datos.
function contentSignature(model) {
  return JSON.stringify({
    months: (model?.months || []).map((month) => ({ ...month, modifiedTime: undefined })),
    files: (model?.drive?.files || []).map((file) => [file.id, file.name])
  });
}

function describeChanges(previous, next) {
  if (!previous) return ["primera sincronización"];
  const before = new Map((previous.months || []).map((month) => [month.id, JSON.stringify({ ...month, modifiedTime: "" })]));
  const after = new Map(next.months.map((month) => [month.id, JSON.stringify({ ...month, modifiedTime: "" })]));
  const changes = [];
  after.forEach((value, id) => {
    if (!before.has(id)) changes.push(`${id} nuevo`);
    else if (before.get(id) !== value) changes.push(`${id} actualizado`);
  });
  before.forEach((_, id) => {
    if (!after.has(id)) changes.push(`${id} ya no está en la carpeta`);
  });
  return changes;
}

const safeName = (value) => String(value).replace(/[<>:"/\\|?*]+/g, "-").trim();

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 20).join("\n"));
    return 0;
  }
  const outDir = path.resolve(projectRoot, args.out || "private/palabras-clave");
  const modelFile = path.join(outDir, "keywords.json");
  const manifestFile = path.join(outDir, "manifest.json");
  const previousModel = readJson(modelFile);
  const previousManifest = readJson(manifestFile);
  const now = new Date().toISOString();

  const checks = [];
  const raw = [];
  let drive;
  let months;

  if (args.file) {
    // Informe local: reemplaza su mes en el modelo guardado y conserva los demás.
    const text = fs.readFileSync(path.resolve(args.file), "utf8");
    const parsed = report.parseReport(text, { name: path.basename(args.file), id: "", modifiedTime: now });
    checks.push(parsed);
    raw.push({ month: parsed.month, text });
    const others = (previousModel?.months || []).filter((month) => month.id !== parsed.month.id);
    drive = { ...(previousModel?.drive || {}), lastSync: now };
    months = [...others, parsed.month];
  } else {
    const folderId = args.folder || process.env.LR_KEYWORDS_FOLDER_ID || previousManifest?.folderId;
    if (!folderId) throw new Error("Falta la carpeta: usa --folder <ID> o la variable LR_KEYWORDS_FOLDER_ID.");
    const listing = await listFolder(folderId, previousManifest);
    listing.errors.forEach((error) => console.warn(`Aviso al listar: ${error}`));
    console.log(`Carpeta listada con ${listing.discovery}: ${listing.files.length} archivo(s).`);

    const results = await Promise.allSettled(
      listing.files.map(async (file) => {
        const text = await fetchText(report.exportUrl(file));
        return { file, text, parsed: report.parseReport(text, file) };
      })
    );
    const failed = [];
    results.forEach((result, index) => {
      const file = listing.files[index];
      if (result.status === "fulfilled") {
        checks.push(result.value.parsed);
        raw.push({ month: result.value.parsed.month, text: result.value.text });
      } else {
        failed.push(file);
        console.warn(`No se pudo leer «${file.name}»: ${result.reason?.message || result.reason}`);
      }
    });
    // Un informe que falla conserva su mes anterior.
    const kept = (previousModel?.months || []).filter((month) => failed.some((file) => file.id === month.driveFileId));
    months = [...checks.map((item) => item.month), ...kept];
    drive = { folderId, discovery: listing.discovery, lastSync: now, files: listing.files };
  }

  if (!checks.length) {
    console.error("No se pudo leer ningún informe.");
    return 1;
  }
  checks.sort((a, b) => a.month.id.localeCompare(b.month.id));
  printVerification(checks);

  const model = report.buildModel(months, drive);
  if (model.duplicates.length) console.warn(`\nAviso: más de un archivo para ${model.duplicates.join(", ")}; se usa el modificado más recientemente.`);
  const changed = contentSignature(model) !== contentSignature(previousModel);
  const changes = changed ? describeChanges(previousModel, model) : [];
  console.log(`\nCambios: ${changed ? `sí (${changes.join(", ")})` : "no"}`);

  if (args.check) {
    console.log("Modo --check: no se escribió nada.");
  } else if (changed) {
    fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });
    raw.forEach(({ month, text }) => {
      fs.writeFileSync(path.join(outDir, "raw", `${month.id} ${safeName(month.sourceFile || "informe")}${/\.csv$/i.test(month.sourceFile) ? "" : ".csv"}`), text);
    });
    fs.writeFileSync(modelFile, JSON.stringify(model));
    fs.writeFileSync(
      manifestFile,
      JSON.stringify(
        {
          folderId: model.drive.folderId,
          discovery: model.drive.discovery,
          lastSync: model.drive.lastSync,
          files: model.drive.files,
          months: checks.map(({ month, check }) => ({ id: month.id, sourceFile: month.sourceFile, driveFileId: month.driveFileId, rows: check.rows, ok: check.ok }))
        },
        null,
        2
      )
    );
    console.log(`Guardado en ${path.relative(projectRoot, outDir)}: keywords.json, manifest.json y raw/.`);
  } else {
    console.log("Sin cambios: no se reescriben los archivos.");
  }

  return checks.some(({ check }) => check.ok === false) ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
