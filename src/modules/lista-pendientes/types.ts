export type PendingStatus = "pendiente" | "en_proceso";

export type CompletedPendingAction = "completada" | "eliminada";

export interface PendingResponsibleOption {
  email?: string;
  nombre: string;
  orden: number;
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
}

export interface PendingPresenceUser {
  userId: string;
  name: string;
  email?: string;
  editingTaskId: string | null;
  editingTaskTitle: string | null;
  onlineAt: string;
}
