import type { PendingTask } from "./types";

export const connectedUsersToShow = ["Jorge Luis", "Diego"];

export const initialPendingTasks: Array<
  Pick<PendingTask, "titulo" | "responsable" | "estado" | "fecha_inicio" | "fecha_fin">
> = [
  {
    titulo: "Actualización de cuentas y contenidos de los muros para todas las marcas.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: null,
    fecha_fin: null
  },
  {
    titulo: "Llanos Import: actualización de conjuntos y anuncios completos con las piezas enviadas.",
    responsable: "Diego",
    estado: "pendiente",
    fecha_inicio: null,
    fecha_fin: null
  },
  {
    titulo: "Creación de contenido para LinkedIn.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: null,
    fecha_fin: null
  },
  {
    titulo: "Agregar contactos a LinkedIn.",
    responsable: "Diego",
    estado: "pendiente",
    fecha_inicio: null,
    fecha_fin: null
  }
];
