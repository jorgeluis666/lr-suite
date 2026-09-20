export type ClienteProyectoTipo = "cliente" | "interno";

export type ClienteProyectoCategoria =
  | "objetivos"
  | "ventas"
  | "reportes"
  | "herramientas"
  | "planificacion"
  | "tests";

export interface ClienteProyecto {
  /** Nombre del repositorio en GitHub. Sirve como id único. */
  repo: string;
  /** Nombre visible del dashboard. */
  nombre: string;
  /** Cliente al que pertenece el proyecto. */
  cliente: string;
  tipo: ClienteProyectoTipo;
  categoria: ClienteProyectoCategoria;
  descripcion: string;
  repoUrl: string;
  /** URL del dashboard publicado. `null` cuando el repo aún no tiene GitHub Pages activo. */
  dashboardUrl: string | null;
}

export interface ClienteGrupo {
  cliente: string;
  tipo: ClienteProyectoTipo;
  proyectos: ClienteProyecto[];
}
