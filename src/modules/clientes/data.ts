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
    repo: "bitcoin-sp500",
    nombre: "Simulador de inversión a 10 años",
    cliente: "Lima Retail",
    tipo: "interno",
    categoria: "herramientas",
    descripcion: "Comparativa de rendimiento Bitcoin vs S&P 500.",
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
