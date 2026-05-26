export interface Registro {
  id: string;
  fecha: Date;
  fechaInicio: Date;
  fechaFin: Date;
  periodoTipo: "dia" | "semana" | "mes" | "ano" | "rango";
  empresa: string;
  empresaId?: string;
  workspaceId?: string;
  userId?: string;
  tipoResultado: string;
  gasto: number;
  resultados: number;
  ventas: number;
  ticketPromedio: number;
  canal?: string;
  campana?: string;
  notas?: string;
  dia: number;
  semana: number;
  mes: number;
  ano: number;
  costoPorResultado: number;
  facturacionEstimada: number;
  roas: number;
  ratioVenta: number;
}

export interface Costo {
  id: string;
  workspaceId: string;
  empresaId: string | null;
  periodoTipo: "dia" | "semana" | "mes";
  fechaInicio: string;
  fechaFin: string;
  inversionMeta: number;
  inversionGoogle: number;
  costoIas: number;
  costoManychat: number;
  costoDiseno: number;
  otrosVariables: number;
  otrosFijos: number;
  leadsCotizaciones: number;
  leadsGenerados: number;
  ventasCerradas: number;
  ingresoGenerado: number;
}

export type Periodo = "dia" | "semana" | "mes" | "ano" | "personalizado";

export interface Workspace {
  id: string;
  nombre: string;
  owner_id: string;
}

export interface Filtros {
  periodo: Periodo;
  fechaInicio: string;
  fechaFin: string;
  empresa: string;
  canal: string;
  tipoResultado: string;
}

export const initialFiltros: Filtros = {
  periodo: "mes",
  fechaInicio: "",
  fechaFin: "",
  empresa: "",
  canal: "",
  tipoResultado: "",
};

export type MiembroRol = "superadmin" | "owner" | "admin" | "editor" | "viewer";

export interface Miembro {
  id: string;
  workspace_id: string;
  email: string;
  rol: MiembroRol;
  estado: "activo" | "pendiente";
  invitado_por: string;
  invitado_en: string;
}

export interface WorkspaceMembershipRow {
  workspace_id: string | null;
}

export interface RegistroRoasRow {
  id: string | number;
  fecha: string;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  periodo_tipo?: "dia" | "semana" | "mes" | "ano" | "rango" | null;
  empresa: string;
  empresa_id?: string;
  tipo_resultado: string;
  gasto: number;
  resultados: number;
  ventas: number;
  ticket_promedio: number;
  canal?: string;
  campana?: string;
  notas?: string;
  workspace_id?: string;
  user_id?: string;
  costo_por_resultado: number;
  facturacion_estimada: number;
  roas: number;
  ratio_venta: number;
}

export interface CostoRow {
  id: string;
  workspace_id: string;
  empresa_id: string | null;
  periodo_tipo: "dia" | "semana" | "mes";
  fecha_inicio: string;
  fecha_fin: string;
  inversion_meta: number;
  inversion_google: number;
  costo_ias: number;
  costo_manychat: number;
  costo_diseno: number;
  otros_variables: number;
  otros_fijos: number;
  leads_cotizaciones: number;
  leads_generados: number;
  ventas_cerradas: number;
  ingreso_generado: number;
}
