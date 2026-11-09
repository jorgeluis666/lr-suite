export type MonthlyInput = { presupuesto: number; vendido: number; googleAds: number; metaAds: number; plataformas: number };
export const emptyMonthlyInput = (): MonthlyInput => ({ presupuesto: 0, vendido: 0, googleAds: 0, metaAds: 0, plataformas: 0 });
export function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}
export function validMonth(key: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(key); }
export function monthLabel(key: string): string {
  if (!validMonth(key)) return 'Sin fecha';
  const label = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${key}-01T12:00:00Z`)).replace(' de ', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function quoteMonths(keys: string[], now = new Date()): [string, string, string][] {
  const current = currentMonth(now);
  const [year, month] = current.split('-').map(Number);
  const horizon = new Date(Date.UTC(year, month + 1, 1)).getUTCFullYear();
  const years = keys.filter(validMonth).map(key => Number(key.slice(0, 4)));
  const first = Math.min(2026, ...years), last = Math.max(horizon, ...years);
  const result: [string, string, string][] = [];
  for (let y = first; y <= last; y++) for (let m = 1; m <= 12; m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    result.push([key, monthLabel(key).split(' ')[0].slice(0, 3), monthLabel(key)]);
  }
  return result;
}
export function restoreMonthlyInputs(saved: Record<string, Partial<MonthlyInput>>): Record<string, MonthlyInput> {
  return Object.fromEntries(Object.entries(saved).filter(([key]) => validMonth(key) || key === 'sin-fecha').map(([key, value]) => {
    const clean = emptyMonthlyInput();
    for (const field of Object.keys(clean) as (keyof MonthlyInput)[]) {
      const n = Number(value?.[field]); clean[field] = Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    return [key, clean];
  }));
}
