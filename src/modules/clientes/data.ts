import type { ClienteProyecto, ClienteProyectoCategoria } from "./types";

const OWNER = "jorgeluis666";

const GITHUB_USER_PAGES = `https://${OWNER}.github.io`;

function repoUrl(repo: string) {
  return `https://github.com/${OWNER}/${repo}`;
}

function pagesUrl(repo: string) {
  return `${GITHUB_USER_PAGES}/${repo}/`;
}

type ProyectoSeed = Omit<
  ClienteProyecto,
  "repoUrl" | "dashboardUrl" | "driveUrl" | "envivoUrl"
> & {
  /** `false` cuando el repositorio todavía no tiene GitHub Pages publicado. */
  publicado?: boolean;
  /** Carpeta de Drive de la marca. Vacío mientras no se cargue. */
  drive?: string;
  /** URL en vivo de Lima Retail. Vacío mientras no se cargue. */
  envivo?: string;
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
    drive: "",
    envivo: "",
  },
  {
    repo: "objetivos-Aquarius",
    nombre: "Aquarius · Dashboard 2026",
    cliente: "Aquarius",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Panel de objetivos e inversión publicitaria.",
    drive: "",
    envivo: "",
  },
  {
    repo: "objetivos-ventas-casiopia",
    nombre: "Casiopia · Dashboard de ventas 2026",
    cliente: "Casiopia",
    tipo: "cliente",
    categoria: "ventas",
    descripcion: "Avance de ventas contra objetivo mensual.",
    drive: "",
    envivo: "",
  },
  {
    repo: "objetivos-Excambiare",
    nombre: "Excambiare · Objetivos",
    cliente: "Excambiare",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Objetivos del cliente. Pendiente de publicar en GitHub Pages.",
    publicado: false,
    drive: "",
    envivo: "",
  },
  {
    repo: "objetivos-Rekluta",
    nombre: "Rekluta · Gasto publicitario 2026",
    cliente: "Rekluta",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año.",
    drive: "",
    envivo: "",
  },
  {
    repo: "objetivo-ventas-RB",
    nombre: "Royal Baby · Dashboard de ventas 2026",
    cliente: "Royal Baby",
    tipo: "cliente",
    categoria: "ventas",
    descripcion: "Avance de ventas contra objetivo mensual.",
    drive: "",
    envivo: "",
  },
  {
    repo: "objetivos-TP",
    nombre: "Terminal Pesquero · Gasto publicitario 2026",
    cliente: "Terminal Pesquero",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año.",
    drive: "",
    envivo: "",
  },
  {
    repo: "objetivos-Tierra-Films",
    nombre: "Tierra Films · Dashboard 2026",
    cliente: "Tierra Films",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Panel de objetivos e inversión publicitaria.",
    drive: "",
    envivo: "",
  },
];

export const PROYECTOS: ClienteProyecto[] = SEEDS.map(
  ({ publicado = true, drive = "", envivo = "", ...seed }) => ({
    ...seed,
    repoUrl: repoUrl(seed.repo),
    dashboardUrl: publicado ? pagesUrl(seed.repo) : null,
    driveUrl: drive || null,
    envivoUrl: envivo || null,
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
