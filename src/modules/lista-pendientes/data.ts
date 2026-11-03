import type { PendingTask } from "./types";

export const connectedUsersToShow = ["Jorge Luis", "Diego"];

type InitialPendingTask = Pick<
  PendingTask,
  "titulo" | "responsable" | "estado" | "fecha_inicio" | "fecha_fin"
>;

const jorgeLuisPendingTasks: InitialPendingTask[] = [
  {
    titulo: "Revisar info de Pérdidas y Ganancias.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-15T09:00:00-05:00",
    fecha_fin: "2026-06-15T11:00:00-05:00"
  },
  {
    titulo: "Invertir en Google Ads Search.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-15T11:30:00-05:00",
    fecha_fin: "2026-06-15T13:30:00-05:00"
  },
  {
    titulo: "Optimizar Landing Pages más importantes.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-17T14:00:00-05:00",
    fecha_fin: "2026-06-17T16:00:00-05:00"
  },
  {
    titulo: "Auditoría Manychat, analizar nuevo etiquetado.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-16T14:00:00-05:00",
    fecha_fin: "2026-06-16T16:00:00-05:00"
  },
  {
    titulo: "Implementar Webhooks Manychat + LR Suite.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-16T09:00:00-05:00",
    fecha_fin: "2026-06-16T12:00:00-05:00"
  },
  {
    titulo: "Diseñar plan de contenidos Reels para LR y AA.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-18T11:00:00-05:00",
    fecha_fin: "2026-06-18T13:00:00-05:00"
  },
  {
    titulo: "Continuar producción de videos para LR y AA.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-19T09:00:00-05:00",
    fecha_fin: "2026-06-19T13:00:00-05:00"
  },
  {
    titulo: "Continuar con la generación de contenidos para el blog.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-19T14:30:00-05:00",
    fecha_fin: "2026-06-19T17:00:00-05:00"
  },
  {
    titulo: "Coordinar auditoría de RB y Casiopia (tercerizar).",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-18T09:00:00-05:00",
    fecha_fin: "2026-06-18T10:30:00-05:00"
  },
  {
    titulo: "Hacer revisión general de todas las marcas.",
    responsable: "Jorge Luis",
    estado: "pendiente",
    fecha_inicio: "2026-06-17T09:00:00-05:00",
    fecha_fin: "2026-06-17T12:00:00-05:00"
  }
];

export const initialPendingTasks: Array<
  Pick<PendingTask, "titulo" | "responsable" | "estado" | "fecha_inicio" | "fecha_fin">
> = [
  ...jorgeLuisPendingTasks,
  {
    titulo: "Llanos Import: actualización de conjuntos y anuncios completos con las piezas enviadas.",
    responsable: "Diego",
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
