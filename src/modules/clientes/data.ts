import type { ClienteProyecto, ClienteProyectoCategoria } from "./types";

const OWNER = "jorgeluis666";

const GITHUB_USER_PAGES = `https://${OWNER}.github.io`;

function repoUrl(repo: string) {
  return `https://github.com/${OWNER}/${repo}`;
}

function pagesUrl(repo: string) {
  return `${GITHUB_USER_PAGES}/${repo}/`;
}

type ProyectoSeed = Omit<ClienteProyecto, "repoUrl" | "dashboardUrl"> & {
  /** `false` cuando el repositorio todavía no tiene GitHub Pages publicado. */
  publicado?: boolean;
};

const SEEDS: ProyectoSeed[] = [
  // ── Clientes ────────────────────────────────────────────────
  {
    repo: "objetivos-Amador",
    nombre: "Amador · Gasto publicitario 2026",
    cliente: "Amador",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año.",
  },
  {
    repo: "objetivos-Aquarius",
    nombre: "Aquarius · Dashboard 2026",
    cliente: "Aquarius",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Panel de objetivos e inversión publicitaria.",
  },
  {
    repo: "objetivos-ventas-casiopia",
    nombre: "Casiopia · Dashboard de ventas 2026",
    cliente: "Casiopia",
    tipo: "cliente",
    categoria: "ventas",
    descripcion: "Avance de ventas contra objetivo mensual.",
  },
  {
    repo: "objetivos-Excambiare",
    nombre: "Excambiare · Objetivos",
    cliente: "Excambiare",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Objetivos del cliente. Pendiente de publicar en GitHub Pages.",
    publicado: false,
  },
  {
    repo: "Gantt-Web-Mhuza",
    nombre: "Mhuza · Gantt proyecto web",
    cliente: "Mhuza",
    tipo: "cliente",
    categoria: "planificacion",
    descripcion: "Cronograma del proyecto web del cliente.",
  },
  {
    repo: "objetivos-Rekluta",
    nombre: "Rekluta · Gasto publicitario 2026",
    cliente: "Rekluta",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año.",
  },
  {
    repo: "objetivo-ventas-RB",
    nombre: "Royal Baby · Dashboard de ventas 2026",
    cliente: "Royal Baby",
    tipo: "cliente",
    categoria: "ventas",
    descripcion: "Avance de ventas contra objetivo mensual.",
  },
  {
    repo: "objetivos-TP",
    nombre: "Terminal Pesquero · Gasto publicitario 2026",
    cliente: "Terminal Pesquero",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año.",
  },
  {
    repo: "objetivos-Tierra-Films",
    nombre: "Tierra Films · Dashboard 2026",
    cliente: "Tierra Films",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Panel de objetivos e inversión publicitaria.",
  },

  // ── Lima Retail (interno) ───────────────────────────────────
  {
    repo: "lr-suite",
    nombre: "LR Suite",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "herramientas",
    descripcion: "Versión estática de la suite operativa.",
  },
  {
    repo: "LR-Pendientes-Check-List",
    nombre: "LR Pendientes · Check List",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "planificacion",
    descripcion: "Checklist operativo de pendientes del equipo.",
  },
  {
    repo: "LR-Pendientes",
    nombre: "LR Pendientes",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "planificacion",
    descripcion: "Control de pendientes. Pendiente de publicar en GitHub Pages.",
    publicado: false,
  },
  {
    repo: "Pendientes-gantt",
    nombre: "Pendientes · Gantt diario",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "planificacion",
    descripcion: "Gantt diario de pendientes alimentado por CSV.",
  },
  {
    repo: "gsc-dashboard",
    nombre: "Content SEO Booster",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "reportes",
    descripcion: "Análisis de Google Search Console para priorizar contenido.",
  },
  {
    repo: "metricool-report",
    nombre: "Metricool Report",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "reportes",
    descripcion: "Reporte trimestral de redes sociales desde Metricool.",
  },
  {
    repo: "Analisis-productos-WooCommerce",
    nombre: "WooCommerce Sales Analyzer",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "reportes",
    descripcion: "Análisis de ventas y productos exportados de WooCommerce.",
  },
  {
    repo: "google-ads-codex",
    nombre: "Ads Performance Manager",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "reportes",
    descripcion: "Gestión de performance de campañas Google Ads.",
  },
  {
    repo: "google-ads-claude",
    nombre: "Google Ads · Claude",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "reportes",
    descripcion: "Versión alterna del análisis de Google Ads. Pendiente de publicar.",
    publicado: false,
  },
  {
    repo: "calculadora-inversion-whatsapp",
    nombre: "Calculadora de inversión · WhatsApp",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "herramientas",
    descripcion: "Simulador de inversión para campañas con destino WhatsApp.",
  },
  {
    repo: "calculadora-inversion-google-ads",
    nombre: "Calculadora de inversión · Google Ads",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "herramientas",
    descripcion: "Simulador de inversión para Google Ads. Pendiente de publicar.",
    publicado: false,
  },
  {
    repo: "codex004",
    nombre: "Planificador de crecimiento de contenido",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "planificacion",
    descripcion: "Plan de crecimiento de contenido por canal.",
  },
  {
    repo: "bitcoin-sp500",
    nombre: "Simulador de inversión a 10 años",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "herramientas",
    descripcion: "Comparativa de rendimiento Bitcoin vs S&P 500.",
  },
  {
    repo: "control-empresa-digital",
    nombre: "Test de control digital",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "tests",
    descripcion: "Diagnóstico del nivel de digitalización de una empresa.",
  },
  {
    repo: "test-estado-automatizacion",
    nombre: "Checklist de automatización",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "tests",
    descripcion: "Diagnóstico del estado de automatización de procesos.",
  },
  {
    repo: "test-curso-meta-ads",
    nombre: "Test Ads Academy",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "tests",
    descripcion: "Test de encaje del curso de Meta Ads con el negocio.",
  },
];

export const PROYECTOS: ClienteProyecto[] = SEEDS.map(
  ({ publicado = true, ...seed }) => ({
    ...seed,
    repoUrl: repoUrl(seed.repo),
    dashboardUrl: publicado ? pagesUrl(seed.repo) : null,
  })
);

export const CATEGORIA_LABEL: Record<ClienteProyectoCategoria, string> = {
  objetivos: "Objetivos",
  ventas: "Ventas",
  reportes: "Reportes",
  herramientas: "Herramientas",
  planificacion: "Planificación",
  tests: "Tests",
};
