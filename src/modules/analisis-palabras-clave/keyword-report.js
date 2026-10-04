// Análisis de Palabras Clave: lector del "Informe de palabras clave de búsqueda" de Google Ads.
//
// Un solo archivo para el navegador y para Node, así ambos interpretan los informes igual:
//   - index.html lo carga con <script src> y lo usa como window.LRKeywordReport.
//   - sync-keywords.mjs lo importa con require().
// No depende del DOM ni de Node. Ver README.md de esta carpeta.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LRKeywordReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Sube cuando cambie la forma del modelo: las cachés guardadas con otra versión se descartan.
  // 2: cada mes trae "account" (fila "Total: Cuenta"), que usa Pérdidas y Ganancias.
  const SCHEMA_VERSION = 2;

  const CONFIG = {
    // Campañas que no deben aparecer en ninguna parte (sincronización diaria, botón Actualizar y
    // pantalla). "Website traffic-Search-15" es la campaña de "booking" creada en el hackeo de la cuenta.
    excludeCampaigns: ["Website traffic-Search-15"]
  };

  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  // Encabezado normalizado -> campo. Se mapea por nombre, nunca por posición.
  const COLUMNS = {
    state: ["estado de palabras clave", "estado de la palabra clave"],
    keyword: ["palabra clave"],
    matchType: ["tipo de concordancia", "concordancia"],
    campaign: ["campana"],
    adGroup: ["grupo de anuncios"],
    status: ["estado"],
    reasons: ["motivos del estado"],
    currency: ["codigo de moneda", "moneda"],
    impressions: ["impr.", "impresiones"],
    clicks: ["clics"],
    cost: ["costo"],
    conversions: ["conversiones"],
    impressionShare: ["porcentaje de impr. de busqueda", "% impr. de busqueda", "cuota de impresiones de busqueda"],
    topShare: ["% impr. parte sup. busqueda", "% impr. parte superior de la busqueda"],
    lostRank: ["% impr. perdidas de la busqueda (ranking)", "% impr. perdidas de la busqueda (clasificacion)"],
    qualityScore: ["nivel de calidad"],
    expectedCtr: ["ctr prev.", "ctr esperado"],
    landingPage: ["exp. en pagina de destino", "experiencia en la pagina de destino"],
    adRelevance: ["relevancia del anuncio"]
  };
  const SHARE_FIELDS = ["impressionShare", "topShare", "lostRank", "expectedCtr", "landingPage", "adRelevance"];

  // Minúsculas, sin tildes y con los espacios colapsados (incluido el espacio duro U+00A0).
  function normalize(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[\s ]+/g, " ")
      .trim();
  }

  // Lector de CSV que respeta comillas ("1,244", saltos de línea y comillas dobles escapadas).
  function parseCsv(text) {
    const source = String(text || "").replace(/^﻿/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && source[index + 1] === "\n") index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  const round2 = (value) => Math.round(value * 100) / 100;
  const clean = (value) => String(value == null ? "" : value).replace(/[\s ]+/g, " ").trim();

  // Impresiones y clics. Al convertir el CSV en hoja, Sheets lee "1,290" como 1,29 y lo exporta así
  // (también "1,200" -> "1,2"): un último grupo de 1 o 2 dígitos se completa con ceros a la derecha.
  function parseCount(value) {
    let text = clean(value).replace(/\s/g, "");
    if (!text || text === "--") return 0;
    if (text.includes(",")) {
      const groups = text.split(",");
      const last = groups[groups.length - 1];
      if (/^\d{1,2}$/.test(last)) groups[groups.length - 1] = last.padEnd(3, "0");
      text = groups.join("");
    }
    const number = Number(text.replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  // Costos y conversiones. Sheets puede convertir un costo en fecha ("01.04", "1/04", "01.04.2026" o
  // "2026-04-01" para 1.04): se lee día.mes como número. "01.04" ya es un número válido.
  function parseAmount(value) {
    const text = clean(value).replace(/\s/g, "");
    if (!text || text === "--") return 0;
    const iso = text.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/);
    const slash = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
    const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.\d{2,4}$/);
    const dayMonth = iso ? [iso[2], iso[1]] : (slash || dotted || []).slice(1);
    if (dayMonth.length === 2) return Number(`${Number(dayMonth[0])}.${dayMonth[1].padStart(2, "0")}`);
    const number = Number(text.replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? round2(number) : 0;
  }

  // Cuotas de impresiones y componentes del nivel de calidad: texto tal cual ("< 10%", "> 90%",
  // "Superior al promedio"); "--" o vacío -> null.
  function parseText(value) {
    const text = clean(value);
    return !text || text === "--" ? null : text;
  }

  function parseQuality(value) {
    const number = Number(clean(value));
    return clean(value) && Number.isFinite(number) ? number : null;
  }

  const pad2 = (value) => String(value).padStart(2, "0");

  function monthNumber(name) {
    const normalized = normalize(name).replace(/^setiembre$/, "septiembre");
    return MONTHS.indexOf(normalized) + 1;
  }

  function monthLabel(id) {
    const name = MONTHS[Number(id.slice(5, 7)) - 1] || "";
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${id.slice(0, 4)}`;
  }

  // "1 de septiembre de 2026 - 30 de septiembre de 2026" -> mes 2026-09 y su periodo.
  function periodFromText(text) {
    const match = normalize(text).match(
      /(\d{1,2}) de ([a-z]+) de (\d{4})\s*[-–]\s*(\d{1,2}) de ([a-z]+) de (\d{4})/
    );
    if (!match) return null;
    const startMonth = monthNumber(match[2]);
    const endMonth = monthNumber(match[5]);
    if (!startMonth || !endMonth) return null;
    return {
      id: `${match[3]}-${pad2(startMonth)}`,
      period: {
        start: `${match[3]}-${pad2(startMonth)}-${pad2(match[1])}`,
        end: `${match[6]}-${pad2(endMonth)}-${pad2(match[4])}`
      }
    };
  }

  // Respaldo cuando el informe no trae la fila del rango: "Lima Retail Google Ads Setiembre 2026".
  function periodFromName(name) {
    const normalized = normalize(name);
    const year = normalized.match(/\b(20\d{2})\b/);
    const month = normalized.split(/[^a-z]+/).map(monthNumber).find(Boolean);
    if (!year || !month) return null;
    const lastDay = new Date(Date.UTC(Number(year[1]), month, 0)).getUTCDate();
    return {
      id: `${year[1]}-${pad2(month)}`,
      period: { start: `${year[1]}-${pad2(month)}-01`, end: `${year[1]}-${pad2(month)}-${pad2(lastDay)}` }
    };
  }

  function isExcluded(campaign, exclude) {
    const name = normalize(campaign);
    return (exclude || []).some((item) => normalize(item) === name);
  }

  // Interpreta un informe. file: { id, name, modifiedTime } de Drive. options.excludeCampaigns
  // reemplaza a CONFIG.excludeCampaigns. Devuelve { month, check } o lanza un Error con el motivo.
  function parseReport(text, file = {}, options = {}) {
    const exclude = options.excludeCampaigns || CONFIG.excludeCampaigns;
    const rows = parseCsv(text);
    const headerIndex = rows
      .slice(0, 12)
      .findIndex((row) => {
        const cells = row.map(normalize);
        return cells.includes("palabra clave") && cells.includes("campana");
      });
    if (headerIndex < 0) {
      throw new Error("no es un informe de palabras clave (no se encontró la fila de encabezados con Palabra clave y Campaña)");
    }

    const headers = rows[headerIndex].map(normalize);
    const columns = {};
    Object.entries(COLUMNS).forEach(([field, names]) => {
      const index = headers.findIndex((header) => names.includes(header));
      if (index >= 0) columns[field] = index;
    });
    const missing = ["keyword", "campaign", "impressions", "clicks", "cost", "conversions"].filter(
      (field) => columns[field] === undefined
    );
    if (missing.length) throw new Error(`faltan columnas en el informe: ${missing.join(", ")}`);
    const cell = (row, field) => (columns[field] === undefined ? "" : row[columns[field]]);

    const found =
      rows
        .slice(0, headerIndex)
        .flat()
        .map(periodFromText)
        .find(Boolean) || periodFromName(file.name);
    if (!found) throw new Error("no se pudo saber el mes: falta la fila del rango de fechas y el nombre no lo indica");

    const keywords = [];
    const sums = { rows: 0, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    const excluded = { campaigns: [], rows: 0, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    const currencies = new Set();
    const totalRows = [];

    rows.slice(headerIndex + 1).forEach((row) => {
      const first = normalize(row[0]);
      if (first.startsWith("total")) {
        totalRows.push(row);
        return;
      }
      const keyword = clean(cell(row, "keyword"));
      const campaign = clean(cell(row, "campaign"));
      if (!keyword || !campaign) return;

      const record = {
        keyword,
        matchType: clean(cell(row, "matchType")),
        campaign,
        adGroup: clean(cell(row, "adGroup")),
        state: clean(cell(row, "state")),
        status: clean(cell(row, "status")),
        reasons: clean(cell(row, "reasons")),
        impressions: parseCount(cell(row, "impressions")),
        clicks: parseCount(cell(row, "clicks")),
        cost: parseAmount(cell(row, "cost")),
        conversions: parseAmount(cell(row, "conversions"))
      };
      // Columnas que no todas las exportaciones traen: solo se guardan si el informe las tiene.
      if (columns.qualityScore !== undefined) record.qualityScore = parseQuality(cell(row, "qualityScore"));
      SHARE_FIELDS.forEach((field) => {
        if (columns[field] !== undefined) record[field] = parseText(cell(row, field));
      });
      const currency = clean(cell(row, "currency"));
      if (currency && currency !== "--") currencies.add(currency);

      sums.rows += 1;
      sums.impressions += record.impressions;
      sums.clicks += record.clicks;
      sums.cost += record.cost;
      sums.conversions += record.conversions;

      if (isExcluded(campaign, exclude)) {
        if (!excluded.campaigns.includes(campaign)) excluded.campaigns.push(campaign);
        excluded.rows += 1;
        excluded.impressions += record.impressions;
        excluded.clicks += record.clicks;
        excluded.cost += record.cost;
        excluded.conversions += record.conversions;
        return;
      }
      keywords.push(record);
    });

    // Fila de totales del informe: "Total: Palabras clave filtradas" o, en otras exportaciones,
    // "Total: Palabras clave". Sirve para comprobar que la lectura no perdió ni dañó filas.
    const totalLabel = (row) => normalize(row[0]);
    const totalRow =
      totalRows.find((row) => totalLabel(row) === "total: palabras clave filtradas") ||
      totalRows.find((row) => totalLabel(row) === "total: palabras clave") ||
      totalRows.find((row) => totalLabel(row) === "total: cuenta");
    totalRows.forEach((row) => {
      const currency = clean(cell(row, "currency"));
      if (!currencies.size && currency && currency !== "--") currencies.add(currency);
    });

    sums.cost = round2(sums.cost);
    sums.conversions = round2(sums.conversions);
    ["cost", "conversions"].forEach((field) => {
      excluded[field] = round2(excluded[field]);
    });

    let check = { label: null, ok: null, rows: sums.rows, sums, totals: null, diff: null };
    if (totalRow) {
      const totals = {
        impressions: parseCount(cell(totalRow, "impressions")),
        clicks: parseCount(cell(totalRow, "clicks")),
        cost: parseAmount(cell(totalRow, "cost")),
        conversions: parseAmount(cell(totalRow, "conversions"))
      };
      const diff = {
        impressions: sums.impressions - totals.impressions,
        clicks: sums.clicks - totals.clicks,
        cost: round2(sums.cost - totals.cost),
        conversions: round2(sums.conversions - totals.conversions)
      };
      check = {
        label: clean(totalRow[0]),
        // Impresiones, clics y conversiones deben cuadrar exacto; el costo, hasta unos céntimos por
        // el redondeo de cada fila.
        ok: diff.impressions === 0 && diff.clicks === 0 && diff.conversions === 0 && Math.abs(diff.cost) <= 0.05,
        rows: sums.rows,
        sums,
        totals,
        diff
      };
    }

    // Fila "Total: Cuenta": todo lo que gastó la cuenta en el mes, también en campañas sin palabras
    // clave (Máximo rendimiento, Display) y en las excluidas, porque se pagaron igual. Pérdidas y
    // Ganancias la usa como inversión mensual en Google Ads. null si el informe no la trae.
    const accountRow = totalRows.find((row) => totalLabel(row) === "total: cuenta");
    const account = accountRow
      ? {
          impressions: parseCount(cell(accountRow, "impressions")),
          clicks: parseCount(cell(accountRow, "clicks")),
          cost: parseAmount(cell(accountRow, "cost")),
          conversions: parseAmount(cell(accountRow, "conversions"))
        }
      : null;

    return {
      month: {
        id: found.id,
        label: monthLabel(found.id),
        sourceFile: file.name || "",
        driveFileId: file.id || "",
        modifiedTime: file.modifiedTime || "",
        period: found.period,
        currency: currencies.size ? [...currencies][0] : "USD",
        check: { label: check.label, ok: check.ok, totals: check.totals, diff: check.diff },
        account,
        excluded,
        keywords
      },
      check
    };
  }

  // Une los meses en el modelo normalizado. Si dos archivos traen el mismo mes, gana el modificado más
  // recientemente (o el último de la lista).
  function buildModel(months, drive = {}) {
    const byId = new Map();
    const duplicates = [];
    months.forEach((month) => {
      const current = byId.get(month.id);
      if (current) {
        duplicates.push(month.id);
        if (String(month.modifiedTime || "") < String(current.modifiedTime || "")) return;
      }
      byId.set(month.id, month);
    });
    const sorted = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    const withActivity = sorted.filter((month) => month.keywords.some((keyword) => keyword.impressions > 0));
    return {
      schemaVersion: SCHEMA_VERSION,
      defaultMonth: (withActivity[withActivity.length - 1] || sorted[sorted.length - 1] || {}).id || null,
      months: sorted,
      duplicates: [...new Set(duplicates)],
      drive: {
        folderId: drive.folderId || "",
        discovery: drive.discovery || "",
        lastSync: drive.lastSync || "",
        files: (drive.files || []).map((file) => ({
          id: file.id,
          name: file.name || "",
          mimeType: file.mimeType || "",
          modifiedTime: file.modifiedTime || ""
        }))
      }
    };
  }

  // Quita las campañas excluidas de un modelo ya armado (por ejemplo, una caché vieja del navegador).
  function applyExclusions(model, exclude = CONFIG.excludeCampaigns) {
    if (!model || !Array.isArray(model.months)) return model;
    return {
      ...model,
      months: model.months.map((month) => ({
        ...month,
        keywords: month.keywords.filter((keyword) => !isExcluded(keyword.campaign, exclude))
      }))
    };
  }

  // Identidad de una palabra clave para seguirla mes a mes: campaña + texto + concordancia. El texto
  // se normaliza y pierde las comillas o corchetes de la notación de concordancia.
  function keywordKey(keyword) {
    const text = normalize(keyword.keyword).replace(/^[["]+|[\]"]+$/g, "");
    return `${normalize(keyword.campaign)}|${text}|${normalize(keyword.matchType)}`;
  }

  // Listado de la vista pública de la carpeta (https://drive.google.com/embeddedfolderview?id=...).
  function parseFolderHtml(html) {
    const decode = (value) =>
      String(value || "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim();
    return String(html || "")
      .split('class="flip-entry"')
      .slice(1)
      .map((chunk) => {
        const id = (chunk.match(/id="entry-([A-Za-z0-9_-]+)"/) || [])[1];
        const type = (chunk.match(/\/type\/([^"]+)"/) || [])[1] || "";
        const href = (chunk.match(/href="([^"]+)"/) || [])[1] || "";
        return {
          id,
          name: decode((chunk.match(/flip-entry-title">([^<]*)</) || [])[1]),
          mimeType: type || (href.includes("/spreadsheets/") ? "application/vnd.google-apps.spreadsheet" : ""),
          modifiedTime: decode((chunk.match(/flip-entry-last-modified"><div>([^<]*)</) || [])[1])
        };
      })
      .filter((file) => file.id);
  }

  const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

  function isReportFile(file) {
    return file.mimeType === SHEET_MIME || /csv/.test(file.mimeType || "") || /\.csv$/i.test(file.name || "");
  }

  // URL del CSV de un archivo de la carpeta. La exportación de Sheets responde con CORS abierto.
  function exportUrl(file) {
    return file.mimeType === SHEET_MIME
      ? `https://docs.google.com/spreadsheets/d/${file.id}/export?format=csv`
      : `https://drive.google.com/uc?export=download&id=${file.id}`;
  }

  return {
    SCHEMA_VERSION,
    CONFIG,
    SHEET_MIME,
    normalize,
    parseCsv,
    parseCount,
    parseAmount,
    parseText,
    periodFromText,
    periodFromName,
    monthLabel,
    isExcluded,
    parseReport,
    buildModel,
    applyExclusions,
    keywordKey,
    parseFolderHtml,
    isReportFile,
    exportUrl
  };
});
