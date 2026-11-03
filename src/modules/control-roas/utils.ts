import type { Periodo, Registro } from "./types";

export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function translateSupabaseError(error: unknown): string {
  const message = String(
    typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: unknown }).message
      : error,
  ).toLowerCase();

  if (message.includes("row-level security")) {
    return "No tienes permisos para realizar esta acción.";
  }
  if (message.includes("duplicate key") || message.includes("unique constraint")) {
    return "Este registro ya existe.";
  }
  if (message.includes("foreign key")) {
    return "No se puede completar la operación porque hay datos relacionados.";
  }
  if (message.includes("jwt expired") || message.includes("invalid jwt")) {
    return "Tu sesión expiró. Por favor vuelve a iniciar sesión.";
  }
  return "Ocurrió un error. Intenta de nuevo.";
}

export function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const isInteger = Number.isInteger(rounded);
  return (
    "S/ " +
    rounded.toLocaleString("es-PE", {
      minimumFractionDigits: isInteger ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatMesCorto(mesKey: string): string {
  const [y, m] = mesKey.split("-");
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[Number(m) - 1]} ${y}`;
}

export function getRoasColor(roas: number) {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-700";
}

export function getPeriodoKey(registro: Registro, periodo: Periodo) {
  if (periodo === "dia") {
    return `${registro.ano}-${String(registro.mes).padStart(2, "0")}-${String(registro.dia).padStart(2, "0")}`;
  }

  if (periodo === "semana") {
    return `${registro.ano} - Semana ${registro.semana}`;
  }

  if (periodo === "mes") {
    return `${registro.ano}-${String(registro.mes).padStart(2, "0")}`;
  }

  return `${registro.ano}`;
}

