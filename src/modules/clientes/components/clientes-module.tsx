"use client";

import { useMemo, useState } from "react";
import { CATEGORIA_LABEL, PROYECTOS } from "../data";
import type { ClienteGrupo, ClienteProyecto, ClienteProyectoTipo } from "../types";

type Filtro = "todos" | ClienteProyectoTipo;

const FILTROS: { value: Filtro; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "cliente", label: "Clientes" },
  { value: "interno", label: "Lima Retail" },
];

function agrupar(proyectos: ClienteProyecto[]): ClienteGrupo[] {
  const grupos = new Map<string, ClienteGrupo>();

  proyectos.forEach((proyecto) => {
    const grupo = grupos.get(proyecto.cliente);
    if (grupo) {
      grupo.proyectos.push(proyecto);
      return;
    }
    grupos.set(proyecto.cliente, {
      cliente: proyecto.cliente,
      tipo: proyecto.tipo,
      proyectos: [proyecto],
    });
  });

  return Array.from(grupos.values()).sort((a, b) => {
    // Los clientes van primero, el trabajo interno al final.
    if (a.tipo !== b.tipo) return a.tipo === "cliente" ? -1 : 1;
    return a.cliente.localeCompare(b.cliente);
  });
}

function coincide(proyecto: ClienteProyecto, busqueda: string) {
  const q = busqueda.trim().toLowerCase();
  if (!q) return true;
  return [
    proyecto.nombre,
    proyecto.cliente,
    proyecto.repo,
    proyecto.descripcion,
    CATEGORIA_LABEL[proyecto.categoria],
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
      {children}
    </span>
  );
}

function ProyectoCard({ proyecto }: { proyecto: ClienteProyecto }) {
  return (
    <article className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-red-200 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-[#0f172a]">{proyecto.nombre}</h3>
        <Badge>{CATEGORIA_LABEL[proyecto.categoria]}</Badge>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-gray-500">
        {proyecto.descripcion}
      </p>

      <p className="mt-3 break-all font-mono text-[11px] text-gray-400">
        {proyecto.repo}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {proyecto.dashboardUrl ? (
          <a
            href={proyecto.dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-red-800"
          >
            Abrir dashboard
          </a>
        ) : (
          <span className="rounded-xl border border-dashed border-gray-300 px-4 py-2 text-xs font-medium text-gray-400">
            Sin dashboard publicado
          </span>
        )}

        <a
          href={proyecto.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-bold text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
        >
          Repositorio
        </a>
      </div>
    </article>
  );
}

export function ClientesModule() {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const grupos = useMemo(() => {
    const visibles = PROYECTOS.filter(
      (proyecto) =>
        (filtro === "todos" || proyecto.tipo === filtro) &&
        coincide(proyecto, busqueda)
    );
    return agrupar(visibles);
  }, [busqueda, filtro]);

  const visibles = grupos.reduce((total, g) => total + g.proyectos.length, 0);
  const sinPublicar = PROYECTOS.filter((p) => !p.dashboardUrl).length;

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-gray-200 bg-white p-6">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-600">
          Lima Retail
        </p>
        <h2 className="mt-2 text-2xl font-bold text-[#0f172a]">Clientes</h2>
        <p className="mt-2 text-sm text-gray-500">
          Accesos a todos los dashboards publicados en GitHub Pages y a sus
          repositorios.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente, dashboard o repositorio"
            className="w-full max-w-sm rounded-2xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />

          <div className="flex flex-wrap gap-2">
            {FILTROS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFiltro(value)}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                  filtro === value
                    ? "bg-[#111111] text-white"
                    : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-400">
          {visibles} de {PROYECTOS.length} proyectos
          {sinPublicar > 0 && ` · ${sinPublicar} sin dashboard publicado`}
        </p>
      </header>

      {grupos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">
          No hay proyectos que coincidan con la búsqueda.
        </p>
      ) : (
        grupos.map((grupo) => (
          <section key={grupo.cliente} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-600">
                {grupo.cliente}
              </h3>
              <span className="text-xs text-gray-400">
                {grupo.proyectos.length}{" "}
                {grupo.proyectos.length === 1 ? "proyecto" : "proyectos"}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {grupo.proyectos.map((proyecto) => (
                <ProyectoCard key={proyecto.repo} proyecto={proyecto} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
