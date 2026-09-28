// Metricool Analysis — reporte base del módulo
// Extraído de index.html al ocultar el módulo: la suite no carga este archivo.
// Para reactivarlo, reincorporar el código al <script> principal de index.html.

const metricool = {
  meta: {
    from: "2026-01-01",
    to: "2026-04-24",
    days: 114,
    source: "PDF Metricool",
    brand: "Agencia Lima Retail",
    handle: "@agencialimaretail"
  },
  summary: [
    ["Seguidores", 774, "IG + TikTok", 1.04],
    ["Impresiones", 19190, "Alcance visible del periodo", -28.09],
    ["Interacciones", 96, "Reacciones, likes y respuestas", 88.24],
    ["Publicaciones", 228, "Piezas publicadas", -30.91]
  ],
  channels: [
    {
      name: "Instagram",
      tone: "instagram",
      status: "En caída",
      followers: 474,
      reachLabel: "9,716 impresiones",
      posts: 190,
      interactions: 5,
      engagement: 0.5,
      reach: 32.24,
      reachSuffix: "alcance/reel",
      audience: "85% Perú · 70% Lima"
    },
    {
      name: "TikTok",
      tone: "tiktok",
      status: "Crece",
      followers: 300,
      reachLabel: "10,110 visualizaciones",
      posts: 38,
      interactions: 91,
      engagement: 0.96,
      reach: 249.24,
      reachSuffix: "alcance/post",
      audience: "59% Perú · Bolivia/México secundario"
    }
  ],
  topPosts: [
    ["TikTok", "2026-04-03", "Video sin texto", 559, 3, 0.54],
    ["TikTok", "2026-04-07", "Meta Ads con el objetivo correcto", 528, 6, 1.19],
    ["TikTok", "2026-04-09", "Google Ads te está costando demasiado", 471, 2, 0.43],
    ["TikTok", "2026-02-12", "Vendes sin e-commerce ni Shopify", 143, 6, 4.88],
    ["Instagram", "2026-02-22", "Muestra tu servicio en Google Ads", 47, 1, 5.26],
    ["Instagram", "2026-04-22", "Leads y ventas antes de invertir", 19, 1, 11.11]
  ],
  recommendations: [
    ["TikTok", "Errores", "Los 3 errores más caros en Meta Ads", "Alta"],
    ["TikTok", "Comparaciones", "Meta Ads vs Google Ads para tu PyME", "Alta"],
    ["TikTok", "Inversión", "Cuánto invertir en tu primera campaña", "Alta"],
    ["Instagram", "Beneficio", "Aparece en Google cuando tus clientes te buscan", "Alta"],
    ["Instagram", "Casos", "Antes y después: landing que duplica leads", "Media"]
  ]
};

const METRICOOL_REPORT_STORAGE_KEY = "lr-suite-metricool-report-v1";
let metricoolUploadNotice = null;
let metricoolPdfJsPromise = null;
