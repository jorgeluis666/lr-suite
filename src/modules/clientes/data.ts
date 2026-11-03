import type { ClienteProyecto, ClienteProyectoCategoria } from "./types";

const OWNER = "jorgeluis666";

const GITHUB_USER_PAGES = `https://${OWNER}.github.io`;

function repoUrl(repo: string) {
  return `https://github.com/${OWNER}/${repo}`;
}

function pagesUrl(repo: string) {
  return `${GITHUB_USER_PAGES}/${repo}/`;
}

const DOMINIO = "limaretail.com";

function marcaSlug(cliente: string) {
  return cliente
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function envivoUrl(cliente: string, envivo: boolean | string) {
  // Una URL propia manda sobre el subdominio derivado de la marca.
  if (typeof envivo === "string") return envivo || null;
  return envivo ? `https://${marcaSlug(cliente)}.${DOMINIO}/` : null;
}

type ProyectoSeed = Omit<
  ClienteProyecto,
  "repo" | "clave" | "repoUrl" | "dashboardUrl" | "driveUrl" | "envivoUrl"
> & {
  /** Repositorio en GitHub. Se omite en una marca que todavía no tiene dashboard. */
  repo?: string;
  /** Id de la marca cuando no hay repositorio. Con repositorio, el repo es el id. */
  clave?: string;
  /** `false` cuando el repositorio todavía no tiene GitHub Pages publicado. */
  publicado?: boolean;
  /**
   * Subdominio `<marca>.limaretail.com`. `true` lo arma solo, `false` lo deja
   * pendiente y una cadena reemplaza el subdominio por esa URL.
   */
  envivo?: boolean | string;
};

const SEEDS: ProyectoSeed[] = [
  // ── Clientes ────────────────────────────────────────────────
  {
    repo: "objetivos-Amador",
    nombre: "Amador · Gasto publicitario 2026",
    cliente: "Amador",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año, protegido con clave.",
    envivo: true,
  },
  {
    repo: "objetivos-Aquarius",
    nombre: "Aquarius · Dashboard 2026",
    cliente: "Aquarius",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Panel de objetivos e inversión publicitaria.",
    envivo: true,
  },
  {
    repo: "objetivos-ventas-casiopia",
    nombre: "Casiopia · Dashboard de ventas 2026",
    cliente: "Casiopia",
    tipo: "cliente",
    categoria: "ventas",
    descripcion: "Avance de ventas contra objetivo mensual.",
    envivo: true,
  },
  {
    repo: "objetivos-Excambiare",
    nombre: "Excambiare · Gasto publicitario 2026",
    cliente: "Excambiare",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Gasto publicitario en Meta Ads de Sol y Tierra, Mex Cream y Gold Fusion, protegido con clave.",
    publicado: true,
    // El subdominio es inversiones, no el que saldria del nombre del cliente.
    envivo: "https://inversiones.limaretail.com/",
  },
  {
    repo: "Hers",
    nombre: "Hers · Gasto publicitario 2026",
    cliente: "Hers",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Gasto publicitario y leads en Google Ads, protegido con clave.",
    envivo: true,
  },
  {
    // Sin repo: la marca todavía no tiene dashboard, así que la tarjeta muestra solo Drive.
    clave: "llanos-import",
    nombre: "Llanos Import · Carpeta de Drive",
    cliente: "Llanos Import",
    tipo: "cliente",
    categoria: "archivos",
    descripcion: "Carpeta de la marca en Drive. Todavía no tiene dashboard.",
    publicado: false,
  },
  {
    repo: "objetivos-Mrpaleta",
    nombre: "Mr. Paleta · Gasto publicitario 2026",
    cliente: "Mr. Paleta",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Gasto publicitario y conversaciones en Meta Ads, protegido con clave.",
    envivo: true,
  },
  {
    repo: "objetivos-Mrsushi",
    nombre: "Mr. Sushi · Gasto publicitario 2026",
    cliente: "Mr. Sushi",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Gasto publicitario y conversaciones en Meta Ads, protegido con clave.",
    envivo: true,
  },
  {
    repo: "objetivos-Rekluta",
    nombre: "Rekluta · Gasto publicitario 2026",
    cliente: "Rekluta",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año.",
    envivo: true,
  },
  {
    repo: "objetivo-ventas-RB",
    nombre: "Royal Baby · Dashboard de ventas 2026",
    cliente: "Royal Baby",
    tipo: "cliente",
    categoria: "ventas",
    descripcion: "Avance de ventas contra objetivo mensual.",
    envivo: true,
  },
  {
    repo: "SUMI",
    nombre: "SUMI · Tablero",
    cliente: "SUMI",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Tablero del cliente, protegido con clave.",
    envivo: true,
  },
  {
    repo: "objetivos-TP",
    nombre: "Terminal Pesquero · Gasto publicitario 2026",
    cliente: "Terminal Pesquero",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Seguimiento de objetivos y gasto publicitario del año.",
    envivo: true,
  },
  {
    repo: "objetivos-TLM",
    nombre: "The Little Market · Gasto publicitario 2026",
    cliente: "The Little Market",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Gasto publicitario en Meta Ads, compras online y ROAS del año.",
    envivo: "https://tlm.limaretail.com/",
  },
  {
    repo: "objetivos-Tierra-Films",
    nombre: "Tierra Films · Dashboard 2026",
    cliente: "Tierra Films",
    tipo: "cliente",
    categoria: "objetivos",
    descripcion: "Panel de objetivos e inversión publicitaria.",
    envivo: true,
  },
];

export const PROYECTOS: ClienteProyecto[] = SEEDS.map(
  ({ publicado = true, envivo = false, repo = null, clave = "", ...seed }) => ({
    ...seed,
    repo,
    // Sin repositorio, Repo, Pages y En vivo no existen y la tarjeta queda solo con Drive.
    clave: repo || clave,
    repoUrl: repo ? repoUrl(repo) : null,
    dashboardUrl: repo && publicado ? pagesUrl(repo) : null,
    // La carpeta de Drive no se guarda en el repositorio, que es público: vive en
    // Supabase (lr_suite_private_data, clave "clientes-drive") y se lee tras el login.
    driveUrl: null,
    envivoUrl: envivoUrl(seed.cliente, envivo),
  })
);

export const CATEGORIA_LABEL: Record<ClienteProyectoCategoria, string> = {
  objetivos: "Objetivos",
  ventas: "Ventas",
  reportes: "Reportes",
  herramientas: "Herramientas",
  planificacion: "Planificación",
  archivos: "Archivos",
  tests: "Tests",
};
