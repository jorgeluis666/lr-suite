export type ClienteProyectoTipo = "cliente" | "interno";

export type ClienteProyectoCategoria =
  | "objetivos"
  | "ventas"
  | "reportes"
  | "herramientas"
  | "planificacion"
  | "archivos"
  | "tests";

export interface ClienteProyecto {
  /** Repositorio en GitHub. `null` cuando la marca todavía no tiene dashboard. */
  repo: string | null;
  /** Id único: el repositorio cuando lo tiene, si no una clave propia de la marca. */
  clave: string;
  /** Nombre visible del dashboard. */
  nombre: string;
  /** Cliente al que pertenece el proyecto. */
  cliente: string;
  tipo: ClienteProyectoTipo;
  categoria: ClienteProyectoCategoria;
  descripcion: string;
  /** URL del repositorio. `null` cuando la marca no tiene repositorio. */
  repoUrl: string | null;
  /** URL del dashboard publicado. `null` cuando el repo aún no tiene GitHub Pages activo. */
  dashboardUrl: string | null;
  /** Carpeta de Drive de la marca. `null` mientras no se cargue. */
  driveUrl: string | null;
  /** URL en vivo de Lima Retail. `null` mientras no se cargue. */
  envivoUrl: string | null;
}

export interface ClienteGrupo {
  cliente: string;
  tipo: ClienteProyectoTipo;
  proyectos: ClienteProyecto[];
}
