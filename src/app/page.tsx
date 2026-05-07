"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Registro {
  id: string;
  fecha: Date;
  empresa: string;
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

type Periodo = "dia" | "semana" | "mes" | "ano" | "personalizado";

interface Filtros {
  periodo: Periodo;
  fechaInicio: string;
  fechaFin: string;
  empresa: string;
  canal: string;
  tipoResultado: string;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatMoney(value: number) {
  return `S/ ${value.toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getRoasColor(roas: number) {
  if (roas >= 3) return "text-green-600";
  if (roas >= 1) return "text-yellow-600";
  return "text-red-700";
}

function getPeriodoKey(registro: Registro, periodo: Periodo) {
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

export default function Home() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [mostrarFecha, setMostrarFecha] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [form, setForm] = useState({
    fecha: "",
    empresa: "",
    gasto: "",
    resultados: "",
    ventas: "",
    ticketPromedio: "",
    canal: "",
    campana: "",
    tipoResultado: "",
    notas: "",
  });

  const [filtros, setFiltros] = useState<Filtros>({
    periodo: "mes",
    fechaInicio: "",
    fechaFin: "",
    empresa: "",
    canal: "",
    tipoResultado: "",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("registros");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Array<Registro & { fecha: string }>;
      setRegistros(
        parsed.map((registro) => ({
          ...registro,
          fecha: new Date(registro.fecha),
        }))
      );
    } catch (error) {
      console.error("Error loading registros from localStorage:", error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("registros", JSON.stringify(registros));
  }, [registros]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fechaString =
      mostrarFecha && form.fecha ? form.fecha : new Date().toISOString().split("T")[0];

    const fecha = new Date(`${fechaString}T00:00:00`);
    const gasto = Number(form.gasto) || 0;
    const resultados = Number(form.resultados) || 0;
    const ventas = Number(form.ventas) || 0;
    const ticketPromedio = Number(form.ticketPromedio) || 0;

    const facturacionEstimada = ventas * ticketPromedio;
    const costoPorResultado = resultados > 0 ? gasto / resultados : 0;
    const roas = gasto > 0 ? facturacionEstimada / gasto : 0;
    const ratioVenta = resultados > 0 ? ventas / resultados : 0;

    const nuevoRegistro: Registro = {
      id: Date.now().toString(),
      fecha,
      empresa: form.empresa.trim(),
      tipoResultado: form.tipoResultado.trim() || "Resultado",
      gasto,
      resultados,
      ventas,
      ticketPromedio,
      canal: form.canal.trim() || undefined,
      campana: form.campana.trim() || undefined,
      notas: form.notas.trim() || undefined,
      dia: fecha.getDate(),
      semana: getWeekNumber(fecha),
      mes: fecha.getMonth() + 1,
      ano: fecha.getFullYear(),
      costoPorResultado,
      facturacionEstimada,
      roas,
      ratioVenta,
    };

    setRegistros((prev) => [nuevoRegistro, ...prev]);

    setForm({
      fecha: "",
      empresa: "",
      gasto: "",
      resultados: "",
      ventas: "",
      ticketPromedio: "",
      canal: "",
      campana: "",
      tipoResultado: "",
      notas: "",
    });

    setMostrarFecha(false);
  }

  const registrosFiltrados = useMemo(() => {
    return registros.filter((registro) => {
      if (
        filtros.empresa &&
        !registro.empresa.toLowerCase().includes(filtros.empresa.toLowerCase())
      ) {
        return false;
      }

      if (
        filtros.canal &&
        !registro.canal?.toLowerCase().includes(filtros.canal.toLowerCase())
      ) {
        return false;
      }

      if (
        filtros.tipoResultado &&
        !registro.tipoResultado.toLowerCase().includes(filtros.tipoResultado.toLowerCase())
      ) {
        return false;
      }

      if (filtros.fechaInicio) {
        const inicio = new Date(`${filtros.fechaInicio}T00:00:00`);
        if (registro.fecha < inicio) return false;
      }

      if (filtros.fechaFin) {
        const fin = new Date(`${filtros.fechaFin}T23:59:59`);
        if (registro.fecha > fin) return false;
      }

      return true;
    });
  }, [registros, filtros]);

  const dashboard = useMemo(() => {
    const totalGasto = registrosFiltrados.reduce((sum, r) => sum + r.gasto, 0);
    const totalResultados = registrosFiltrados.reduce((sum, r) => sum + r.resultados, 0);
    const totalVentas = registrosFiltrados.reduce((sum, r) => sum + r.ventas, 0);
    const totalFacturacion = registrosFiltrados.reduce(
      (sum, r) => sum + r.facturacionEstimada,
      0
    );

    return {
      totalGasto,
      totalResultados,
      totalVentas,
      totalFacturacion,
      roas: totalGasto > 0 ? totalFacturacion / totalGasto : 0,
      costoPorResultado: totalResultados > 0 ? totalGasto / totalResultados : 0,
      ratioVenta: totalResultados > 0 ? totalVentas / totalResultados : 0,
    };
  }, [registrosFiltrados]);

  const resumen = useMemo(() => {
    const agrupado: Record<
      string,
      {
        gasto: number;
        resultados: number;
        ventas: number;
        facturacion: number;
      }
    > = {};

    registrosFiltrados.forEach((registro) => {
      const key = getPeriodoKey(
        registro,
        filtros.periodo === "personalizado" ? "dia" : filtros.periodo
      );

      if (!agrupado[key]) {
        agrupado[key] = {
          gasto: 0,
          resultados: 0,
          ventas: 0,
          facturacion: 0,
        };
      }

      agrupado[key].gasto += registro.gasto;
      agrupado[key].resultados += registro.resultados;
      agrupado[key].ventas += registro.ventas;
      agrupado[key].facturacion += registro.facturacionEstimada;
    });

    return Object.entries(agrupado)
      .map(([periodo, data]) => ({
        periodo,
        ...data,
        roas: data.gasto > 0 ? data.facturacion / data.gasto : 0,
        costoPorResultado: data.resultados > 0 ? data.gasto / data.resultados : 0,
        ratioVenta: data.resultados > 0 ? data.ventas / data.resultados : 0,
      }))
      .sort((a, b) => b.periodo.localeCompare(a.periodo));
  }, [registrosFiltrados, filtros.periodo]);

  const chartData = useMemo(
    () =>
      resumen
        .slice()
        .reverse()
        .map((item) => ({
          periodo: item.periodo,
          roas: Number(item.roas.toFixed(2)),
          gasto: item.gasto,
          facturacion: item.facturacion,
          resultados: item.resultados,
          ventas: item.ventas,
        })),
    [resumen]
  );

  return (
    <div className="min-h-screen bg-[#f4f4f5] text-[#111111]">
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-72 bg-[#111111] text-white transition-transform duration-300 lg:static lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="border-b border-white/10 p-6">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-500">
              Lima Retail
            </p>
            <h1 className="mt-3 text-2xl font-bold">ROAS Control</h1>
            <p className="mt-2 text-sm text-gray-400">
              Control simple de gasto, resultados y rentabilidad.
            </p>
          </div>

          <nav className="space-y-1 p-4 text-sm">
            {["Registro", "Filtros", "Dashboard", "Resumen", "Registros"].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                className="block rounded-2xl px-4 py-3 text-gray-300 transition hover:bg-white/10 hover:text-white"
              >
                {item}
              </a>
            ))}
          </nav>
        </aside>

        <div className="flex-1">
          <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 px-6 py-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                  Dashboard SaaS
                </p>
                <h2 className="text-2xl font-bold text-gray-950">
                  Control de Rentabilidad Publicitaria
                </h2>
              </div>

              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold lg:hidden"
              >
                Menú
              </button>
            </div>
          </header>

          <main className="mx-auto max-w-7xl space-y-8 p-6">
            <section
              id="registro"
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                  Registrar acción
                </p>
                <h3 className="mt-2 text-2xl font-bold text-gray-950">
                  Ingresa solo lo esencial
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  La fecha, semana, mes, facturación, costo por resultado y ROAS se calculan
                  automáticamente.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <input
                  required
                  placeholder="Empresa"
                  value={form.empresa}
                  onChange={(e) => setForm({ ...form, empresa: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  required
                  type="number"
                  step="0.01"
                  placeholder="Gasto"
                  value={form.gasto}
                  onChange={(e) => setForm({ ...form, gasto: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  required
                  type="number"
                  step="1"
                  placeholder="Resultados"
                  value={form.resultados}
                  onChange={(e) => setForm({ ...form, resultados: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  required
                  type="number"
                  step="1"
                  placeholder="Ventas"
                  value={form.ventas}
                  onChange={(e) => setForm({ ...form, ventas: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  required
                  type="number"
                  step="0.01"
                  placeholder="Ticket promedio"
                  value={form.ticketPromedio}
                  onChange={(e) => setForm({ ...form, ticketPromedio: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  placeholder="Canal opcional"
                  value={form.canal}
                  onChange={(e) => setForm({ ...form, canal: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  placeholder="Campaña opcional"
                  value={form.campana}
                  onChange={(e) => setForm({ ...form, campana: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  placeholder="Tipo de resultado opcional"
                  value={form.tipoResultado}
                  onChange={(e) => setForm({ ...form, tipoResultado: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <div className="flex items-center gap-3 rounded-2xl border border-gray-300 px-4 py-3">
                  <input
                    id="mostrarFecha"
                    type="checkbox"
                    checked={mostrarFecha}
                    onChange={(e) => setMostrarFecha(e.target.checked)}
                  />
                  <label htmlFor="mostrarFecha" className="text-sm text-gray-700">
                    Cambiar fecha
                  </label>
                </div>

                {mostrarFecha && (
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                    className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  />
                )}

                <textarea
                  placeholder="Nota opcional"
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  className="min-h-24 rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 lg:col-span-3"
                />

                <button className="rounded-2xl bg-red-700 px-6 py-4 font-bold text-white shadow-lg shadow-red-100 transition hover:bg-red-800 lg:col-span-3">
                  Registrar acción
                </button>
              </form>
            </section>

            <section
              id="filtros"
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                  Filtros
                </p>
                <h3 className="mt-2 text-2xl font-bold text-gray-950">
                  Analiza por día, semana, mes o año
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <select
                  value={filtros.periodo}
                  onChange={(e) =>
                    setFiltros({ ...filtros, periodo: e.target.value as Periodo })
                  }
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                >
                  <option value="dia">Día</option>
                  <option value="semana">Semana</option>
                  <option value="mes">Mes</option>
                  <option value="ano">Año</option>
                  <option value="personalizado">Personalizado</option>
                </select>

                <input
                  placeholder="Empresa"
                  value={filtros.empresa}
                  onChange={(e) => setFiltros({ ...filtros, empresa: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  placeholder="Canal"
                  value={filtros.canal}
                  onChange={(e) => setFiltros({ ...filtros, canal: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <input
                  placeholder="Tipo de resultado"
                  value={filtros.tipoResultado}
                  onChange={(e) =>
                    setFiltros({ ...filtros, tipoResultado: e.target.value })
                  }
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />

                <button
                  type="button"
                  onClick={() =>
                    setFiltros({
                      periodo: "mes",
                      fechaInicio: "",
                      fechaFin: "",
                      empresa: "",
                      canal: "",
                      tipoResultado: "",
                    })
                  }
                  className="rounded-2xl border border-gray-300 px-4 py-3 font-bold transition hover:bg-gray-100"
                >
                  Limpiar
                </button>
              </div>

              {filtros.periodo === "personalizado" && (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <input
                    type="date"
                    value={filtros.fechaInicio}
                    onChange={(e) =>
                      setFiltros({ ...filtros, fechaInicio: e.target.value })
                    }
                    className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  />

                  <input
                    type="date"
                    value={filtros.fechaFin}
                    onChange={(e) =>
                      setFiltros({ ...filtros, fechaFin: e.target.value })
                    }
                    className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  />
                </div>
              )}
            </section>

            <section id="dashboard" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Gasto total", formatMoney(dashboard.totalGasto), "text-red-700"],
                ["Resultados", dashboard.totalResultados.toString(), "text-gray-950"],
                ["Ventas", dashboard.totalVentas.toString(), "text-gray-950"],
                ["Facturación", formatMoney(dashboard.totalFacturacion), "text-green-600"],
                ["ROAS", dashboard.roas.toFixed(2), getRoasColor(dashboard.roas)],
                ["Costo resultado", formatMoney(dashboard.costoPorResultado), "text-gray-950"],
                ["Ratio venta", formatPercent(dashboard.ratioVenta), "text-gray-950"],
                ["Registros", registrosFiltrados.length.toString(), "text-gray-950"],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
                >
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-500">
                    {label}
                  </p>
                  <p className={`mt-4 text-3xl font-black ${color}`}>{value}</p>
                </div>
              ))}
            </section>

            <section
              id="graficos"
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                  Gráficos
                </p>
                <h3 className="mt-2 text-2xl font-bold text-gray-950">
                  Evolución de ROAS, gasto y resultados
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Visualiza el desempeño acumulado con líneas y barras de alto contraste.
                </p>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-3xl border border-gray-200 bg-[#0f172a] p-4 text-white shadow-sm">
                  <p className="mb-4 text-sm uppercase tracking-[0.3em] text-red-400">
                    ROAS por período
                  </p>
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                        <XAxis dataKey="periodo" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                        <YAxis tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#111827", borderColor: "#374151" }}
                          labelStyle={{ color: "#f8fafc" }}
                          formatter={(value) =>
                            value == null ? "" : `${Number(value).toFixed(2)}`
                          }
                        />
                        <Legend wrapperStyle={{ color: "#e2e8f0" }} />
                        <Line type="monotone" dataKey="roas" stroke="#f43f5e" strokeWidth={3} dot={{ r: 4, fill: "#fb7185" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-[#111827] p-4 text-white shadow-sm">
                  <p className="mb-4 text-sm uppercase tracking-[0.3em] text-red-400">
                    Gasto vs Facturación
                  </p>
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                        <XAxis dataKey="periodo" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                        <YAxis tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#111827", borderColor: "#374151" }}
                          formatter={(value) =>
                            value == null ? "" : formatMoney(Number(value))
                          }
                        />
                        <Legend wrapperStyle={{ color: "#e2e8f0" }} />
                        <Bar dataKey="gasto" fill="#ef4444" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="facturacion" fill="#22c55e" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-[#111827] p-4 text-white shadow-sm xl:col-span-2">
                  <p className="mb-4 text-sm uppercase tracking-[0.3em] text-red-400">
                    Resultados y Ventas por período
                  </p>
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorResultados" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f97316" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#f97316" stopOpacity={0.1} />
                          </linearGradient>
                          <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                        <XAxis dataKey="periodo" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                        <YAxis tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: "#111827", borderColor: "#374151" }} />
                        <Legend wrapperStyle={{ color: "#e2e8f0" }} />
                        <Area type="monotone" dataKey="resultados" stroke="#f97316" fillOpacity={1} fill="url(#colorResultados)" />
                        <Area type="monotone" dataKey="ventas" stroke="#38bdf8" fillOpacity={1} fill="url(#colorVentas)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>

            <section
              id="resumen"
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                  Resumen
                </p>
                <h3 className="mt-2 text-2xl font-bold text-gray-950">
                  Resumen por {filtros.periodo}
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead className="bg-[#111111] text-white">
                    <tr>
                      <th className="px-4 py-3">Período</th>
                      <th className="px-4 py-3">Gasto</th>
                      <th className="px-4 py-3">Resultados</th>
                      <th className="px-4 py-3">Ventas</th>
                      <th className="px-4 py-3">Facturación</th>
                      <th className="px-4 py-3">ROAS</th>
                      <th className="px-4 py-3">Costo resultado</th>
                      <th className="px-4 py-3">Ratio venta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {resumen.map((item) => (
                      <tr key={item.periodo} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold">{item.periodo}</td>
                        <td className="px-4 py-3">{formatMoney(item.gasto)}</td>
                        <td className="px-4 py-3">{item.resultados}</td>
                        <td className="px-4 py-3">{item.ventas}</td>
                        <td className="px-4 py-3">{formatMoney(item.facturacion)}</td>
                        <td className={`px-4 py-3 font-bold ${getRoasColor(item.roas)}`}>
                          {item.roas.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">{formatMoney(item.costoPorResultado)}</td>
                        <td className="px-4 py-3">{formatPercent(item.ratioVenta)}</td>
                      </tr>
                    ))}

                    {resumen.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                          Aún no hay datos registrados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              id="registros"
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                  Registros
                </p>
                <h3 className="mt-2 text-2xl font-bold text-gray-950">
                  Acciones ingresadas
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-700">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Empresa</th>
                      <th className="px-4 py-3">Canal</th>
                      <th className="px-4 py-3">Campaña</th>
                      <th className="px-4 py-3">Gasto</th>
                      <th className="px-4 py-3">Resultados</th>
                      <th className="px-4 py-3">Ventas</th>
                      <th className="px-4 py-3">Ticket</th>
                      <th className="px-4 py-3">Facturación</th>
                      <th className="px-4 py-3">ROAS</th>
                      <th className="px-4 py-3">Nota</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-200">
                    {registrosFiltrados.map((registro) => (
                      <tr key={registro.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">{registro.fecha.toLocaleDateString()}</td>
                        <td className="px-4 py-3 font-semibold">{registro.empresa}</td>
                        <td className="px-4 py-3">{registro.canal || "-"}</td>
                        <td className="px-4 py-3">{registro.campana || "-"}</td>
                        <td className="px-4 py-3">{formatMoney(registro.gasto)}</td>
                        <td className="px-4 py-3">{registro.resultados}</td>
                        <td className="px-4 py-3">{registro.ventas}</td>
                        <td className="px-4 py-3">{formatMoney(registro.ticketPromedio)}</td>
                        <td className="px-4 py-3">
                          {formatMoney(registro.facturacionEstimada)}
                        </td>
                        <td className={`px-4 py-3 font-bold ${getRoasColor(registro.roas)}`}>
                          {registro.roas.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">{registro.notas || "-"}</td>
                      </tr>
                    ))}

                    {registrosFiltrados.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-4 py-10 text-center text-gray-500">
                          Registra tu primera acción para empezar a calcular ROAS.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}