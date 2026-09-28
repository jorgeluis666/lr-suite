// Metricool Analysis — persistencia local y lectura del PDF de Metricool
// Extraído de index.html al ocultar el módulo: la suite no carga este archivo.
// Para reactivarlo, reincorporar el código al <script> principal de index.html.

function cloneMetricoolReport(report = metricool) {
  return JSON.parse(JSON.stringify(report));
}

function readMetricoolSnapshot() {
  try {
    const raw = window.localStorage.getItem(METRICOOL_REPORT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getMetricoolReport() {
  return readMetricoolSnapshot()?.report || metricool;
}

function saveMetricoolReport(report, fileName) {
  try {
    window.localStorage.setItem(
      METRICOOL_REPORT_STORAGE_KEY,
      JSON.stringify({
        fileName,
        savedAt: new Date().toISOString(),
        report
      })
    );
  } catch {
    metricoolUploadNotice = {
      detail: "El reporte se procesó, pero el navegador no permitió guardarlo para la próxima visita.",
      status: "Aviso",
      title: "PDF procesado sin persistencia"
    };
  }
}

function clearMetricoolReport() {
  try {
    window.localStorage.removeItem(METRICOOL_REPORT_STORAGE_KEY);
  } catch {
    // El archivo tambien debe funcionar si el navegador bloquea localStorage.
  }
}

function normalizeMetricoolText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseMetricoolNumber(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/,/g, "");
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)([KM])?$/i);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[2]?.toUpperCase() === "K") return Math.round(base * 1000);
  if (match[2]?.toUpperCase() === "M") return Math.round(base * 1000000);
  return base;
}

function parseMetricoolPercent(value) {
  const match = String(value || "").trim().match(/^([+-]?\d+(?:\.\d+)?)%$/);
  return match ? Number(match[1]) : null;
}

function metricoolPairAfter(lines, label) {
  const startIndex = lines.findIndex((line) =>
    normalizeMetricoolText(line).includes(normalizeMetricoolText(label))
  );
  if (startIndex < 0) return null;

  let value = null;
  let change = null;
  for (let index = startIndex + 1; index < Math.min(lines.length, startIndex + 6); index += 1) {
    if (value === null) value = parseMetricoolNumber(lines[index]);
    if (change === null) change = parseMetricoolPercent(lines[index]);
    if (value !== null && change !== null) break;
  }

  return value === null ? null : { change, value };
}

function metricoolFirstPair(lines) {
  let value = null;
  let change = null;
  for (let index = 1; index < Math.min(lines.length, 8); index += 1) {
    if (value === null) value = parseMetricoolNumber(lines[index]);
    if (change === null) change = parseMetricoolPercent(lines[index]);
    if (value !== null && change !== null) break;
  }
  return value === null ? null : { change, value };
}

function metricoolAverage(values) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function parseMetricoolDate(value) {
  const months = {
    ene: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dic: "12"
  };
  const match = normalizeMetricoolText(value).match(/(\d{1,2})\s+([a-z]+)\s+(\d{2,4})/);
  if (!match) return null;

  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${months[match[2].slice(0, 3)] || "01"}-${match[1].padStart(2, "0")}`;
}

function parseMetricoolCover(lines) {
  const text = lines.join(" ");
  const range = text.match(/(\d{1,2}\s+\w+\s+\d{2,4})\s*-\s*(\d{1,2}\s+\w+\s+\d{2,4})/i);
  const handle = lines.find((line) => /^@?[a-z0-9_.]{3,40}$/i.test(String(line).trim()));
  const brand = lines.find((line) => {
    const clean = String(line || "").trim();
    return (
      clean.length > 3 &&
      clean.length < 80 &&
      !/^social media/i.test(clean) &&
      !/^@/.test(clean) &&
      /[a-z]/i.test(clean) &&
      clean.includes(" ")
    );
  });

  return {
    brand: brand || null,
    from: range ? parseMetricoolDate(range[1]) : null,
    handle: handle ? `@${String(handle).replace(/^@/, "")}` : null,
    to: range ? parseMetricoolDate(range[2]) : null
  };
}

function metricoolChannel(report, name) {
  return report.channels.find((channel) => channel.name === name);
}

function buildMetricoolReportFromPdf(pages, fileName) {
  const report = cloneMetricoolReport();
  const cover = parseMetricoolCover(pages[0] || []);
  const changes = {
    followers: [],
    impressions: [],
    interactions: [],
    posts: []
  };
  let foundMetrics = 0;
  let instagramReachFromPdf = false;

  if (cover.from) report.meta.from = cover.from;
  if (cover.to) report.meta.to = cover.to;
  if (cover.brand) report.meta.brand = cover.brand;
  if (cover.handle) report.meta.handle = cover.handle;
  if (report.meta.from && report.meta.to) {
    report.meta.days =
      Math.round((new Date(report.meta.to) - new Date(report.meta.from)) / 86400000) + 1;
  }
  report.meta.source = `PDF cargado: ${fileName.replace(/[<>]/g, "")}`;

  for (const lines of pages) {
    const text = normalizeMetricoolText(lines.join(" "));
    const instagram = metricoolChannel(report, "Instagram");
    const tiktok = metricoolChannel(report, "TikTok");
    const firstPair = metricoolFirstPair(lines);
    const isInstagram =
      text.includes("balance de seguidores") ||
      text.includes("contenido total") ||
      text.includes("reels") ||
      text.includes("historias");
    const isTikTok =
      text.includes("posts") ||
      text.includes("reprod") ||
      text.includes("visitas al perfil") ||
      text.includes("publicaciones vistas");

    if (text.includes("seguidores") && firstPair) {
      const channel = isTikTok && !isInstagram ? tiktok : instagram;
      channel.followers = firstPair.value;
      changes.followers.push(firstPair.change);
      foundMetrics += 1;

      const postsPair = metricoolPairAfter(lines, isTikTok && !isInstagram ? "Posts" : "Contenido total");
      if (postsPair) {
        channel.posts = postsPair.value;
        changes.posts.push(postsPair.change);
      }
    }

    if ((text.includes("visualizaciones") || text.includes("reprod")) && firstPair) {
      const channel = isTikTok ? tiktok : instagram;
      channel.reachLabel = `${fmtNumber(firstPair.value)} ${
        isTikTok ? "visualizaciones" : "visualizaciones"
      }`;
      channel.reach = firstPair.value;
      if (!isTikTok) instagramReachFromPdf = true;
      changes.impressions.push(firstPair.change);
      foundMetrics += 1;

      const postsPair = metricoolPairAfter(lines, isTikTok ? "Posts" : "Contenido total");
      if (postsPair && isTikTok) {
        channel.posts = postsPair.value;
        changes.posts.push(postsPair.change);
      }
    }

    if (text.includes("impresiones") && firstPair && !text.includes("historias ordenadas") && !instagramReachFromPdf) {
      instagram.reachLabel = `${fmtNumber(firstPair.value)} impresiones`;
      instagram.reach = firstPair.value;
      instagramReachFromPdf = true;
      changes.impressions.push(firstPair.change);
      foundMetrics += 1;
    }

    if (text.includes("interacciones")) {
      const interactionPair = metricoolPairAfter(lines, "Interacciones") || firstPair;
      if (interactionPair) {
        const channel = isTikTok ? tiktok : instagram;
        channel.interactions = interactionPair.value;
        changes.interactions.push(interactionPair.change);
        foundMetrics += 1;
      }
    }

    if (text.includes("engagement") && firstPair) {
      const channel = isTikTok ? tiktok : instagram;
      channel.engagement = firstPair.value;
    }
  }

  const instagram = metricoolChannel(report, "Instagram");
  const tiktok = metricoolChannel(report, "TikTok");
  const totalFollowers = (instagram.followers || 0) + (tiktok.followers || 0);
  const totalReach = (instagram.reach || 0) + (tiktok.reach || 0);
  const totalInteractions = (instagram.interactions || 0) + (tiktok.interactions || 0);
  const totalPosts = (instagram.posts || 0) + (tiktok.posts || 0);

  instagram.status = metricoolAverage(changes.impressions) < -10 ? "En caída" : "Estable";
  tiktok.status = metricoolAverage(changes.interactions) > 10 ? "Crece" : "Estable";
  report.summary = [
    ["Seguidores", totalFollowers, "IG + TikTok", metricoolAverage(changes.followers)],
    ["Impresiones", totalReach, "Visualizaciones/impr. del PDF", metricoolAverage(changes.impressions)],
    ["Interacciones", totalInteractions, "Reacciones, likes y respuestas", metricoolAverage(changes.interactions)],
    ["Publicaciones", totalPosts, "Piezas publicadas", metricoolAverage(changes.posts)]
  ];

  return { foundMetrics, report };
}

function loadMetricoolPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (metricoolPdfJsPromise) return metricoolPdfJsPromise;

  metricoolPdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
    script.integrity = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e";
    script.crossOrigin = "anonymous";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("No se pudo cargar pdf.js para leer el PDF."));
    document.head.appendChild(script);
  });

  return metricoolPdfJsPromise;
}

async function extractMetricoolPdfPages(file) {
  const pdfjs = await loadMetricoolPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const pages = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const text = await page.getTextContent();
    pages.push(
      text.items
        .map((item) => String(item.str || "").trim())
        .filter(Boolean)
    );
  }

  return pages;
}

async function handleMetricoolPdfUpload(file) {
  if (!file || (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf"))) {
    metricoolUploadNotice = {
      detail: "Selecciona un archivo PDF exportado desde Metricool.",
      status: "Error",
      title: "Archivo no válido"
    };
    metricoolModule();
    return;
  }

  metricoolUploadNotice = {
    detail: `Leyendo ${file.name}. El procesamiento puede tardar unos segundos.`,
    status: "Procesando",
    title: "Procesando PDF"
  };
  metricoolModule();

  try {
    const pages = await extractMetricoolPdfPages(file);
    const { foundMetrics, report } = buildMetricoolReportFromPdf(pages, file.name);
    if (!foundMetrics) throw new Error("No encontré KPIs reconocibles en el PDF.");

    saveMetricoolReport(report, file.name);
    metricoolUploadNotice = {
      detail: `${foundMetrics} bloques de KPI actualizados desde ${file.name}.`,
      status: "Cargado",
      title: "Reporte cargado"
    };
  } catch (error) {
    metricoolUploadNotice = {
      detail: error instanceof Error ? error.message : "No se pudo procesar el PDF.",
      status: "Error",
      title: "No se pudo cargar el reporte"
    };
  }

  metricoolModule();
}
