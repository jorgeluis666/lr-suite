export type PendingStatus = "pendiente" | "en_proceso" | "bloqueado";

export type PendingPriority = "Alta" | "Media" | "Baja";

export type CompletedPendingAction = "completada" | "eliminada";

export interface PendingResponsibleOption {
  email?: string;
  nombre: string;
  orden: number;
}

export interface PendingChecklistItem {
  id: string;
  texto: string;
  hecho: boolean;
}

export interface PendingTask {
  id: string;
  workspace_id: string;
  titulo: string;
  responsable: string | null;
  estado: PendingStatus;
  fecha_creacion: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  prioridad: PendingPriority | null;
  tiempo_trabajado: number | null;
  checklist: PendingChecklistItem[] | null;
  created_by: string | null;
  updated_at: string | null;
}

export interface CompletedPendingTask {
  id: string;
  workspace_id: string;
  original_task_id: string | null;
  titulo: string;
  responsable: string | null;
  fecha_creacion: string;
  fecha_finalizacion: string;
  usuario_accion_id: string | null;
  usuario_accion_nombre: string;
  accion: CompletedPendingAction;
  tiempo_trabajado?: number | null;
}

export interface PendingPresenceUser {
  userId: string;
  name: string;
  email?: string;
  editingTaskId: string | null;
  editingTaskTitle: string | null;
  onlineAt: string;
}
