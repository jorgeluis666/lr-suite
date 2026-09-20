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

const PUBLICADOS = PROYECTOS.filter((proyecto) => proyecto.dashboardUrl).length;

function agrupar(proyectos: ClienteProyecto[]): ClienteGrupo[] {
  const grupos = new Map<string, ClienteGrupo>();

  proyectos.forEach((proyecto) => {
    // El trabajo interno se parte por categoría: un bloque de 16 filas no cabe
    // en una columna y obligaría a hacer scroll.
    const titulo =
      proyecto.tipo === "interno"
        ? `${proyecto.cliente} · ${CATEGORIA_LABEL[proyecto.categoria]}`
        : proyecto.cliente;

    const grupo = grupos.get(titulo);
    if (grupo) {
      grupo.proyectos.push(proyecto);
      return;
    }
    grupos.set(titulo, { cliente: titulo, tipo: proyecto.tipo, proyectos: [proyecto] });
  });

  return Array.from(grupos.values()).sort((a, b) => {
    // Los clientes van primero, el trabajo interno cierra la lista.
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

function nombreCorto(proyecto: ClienteProyecto) {
  // El cliente ya encabeza el grupo, no hace falta repetirlo en cada fila.
  const prefijo = `${proyecto.cliente} · `;
  return proyecto.nombre.startsWith(prefijo)
    ? proyecto.nombre.slice(prefijo.length)
    : proyecto.nombre;
}

function ProyectoRow({ proyecto }: { proyecto: ClienteProyecto }) {
  const titulo = `${CATEGORIA_LABEL[proyecto.categoria]} · ${proyecto.descripcion}`;

  return (
    <div className="mb-1 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 transition hover:border-red-200 hover:bg-red-50/60">
      <span
        title={proyecto.dashboardUrl ? "Dashboard publicado" : "Sin dashboard publicado"}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          proyecto.dashboardUrl ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />

      {proyecto.dashboardUrl ? (
        <a
          href={proyecto.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={titulo}
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#0f172a] transition hover:text-red-700"
        >
          {nombreCorto(proyecto)}
        </a>
      ) : (
        <span
          title={`Sin dashboard publicado · ${titulo}`}
          className="min-w-0 flex-1 truncate text-[12.5px] text-gray-400"
        >
          {nombreCorto(proyecto)}
        </span>
      )}

      <a
        href={proyecto.repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={proyecto.repo}
        className="shrink-0 rounded border border-gray-200 px-1.5 py-px text-[10px] font-bold text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
      >
        Repo
      </a>
    </div>
  );
}

export function ClientesModule() {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const grupos = useMemo(() => {
    const visibles = PROYECTOS.filter(
      (proyecto) =>
        (filtro === "todos" || proyecto.tipo === filtro) && coincide(proyecto, busqueda)
    );
    return agrupar(visibles);
  }, [busqueda, filtro]);

  const visibles = grupos.reduce((total, grupo) => total + grupo.proyectos.length, 0);
  const resumen = `${PUBLICADOS} dashboards activos · ${PROYECTOS.length - PUBLICADOS} sin publicar`;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <div className="mr-auto">
          <p className="text-lg font-bold text-[#0f172a]">Clientes</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {visibles === PROYECTOS.length
              ? `${PROYECTOS.length} proyectos · ${resumen}`
              : `${visibles} de ${PROYECTOS.length} proyectos · ${resumen}`}
          </p>
        </div>

        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar cliente o repositorio"
          className="w-56 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
        />

        {FILTROS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFiltro(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filtro === value
                ? "bg-[#111111] text-white"
                : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
      </header>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        {grupos.length === 0 ? (
          <p className="py-5 text-center text-sm text-gray-500">
            No hay proyectos que coincidan con la búsqueda.
          </p>
        ) : (
          <div style={{ columns: "270px", columnGap: "14px" }}>
            {grupos.map((grupo) => (
              <div key={grupo.cliente} className="mb-3 break-inside-avoid">
                <p className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  {grupo.cliente}
                  <span className="text-[10px] font-semibold normal-case tracking-normal text-gray-400">
                    {grupo.proyectos.length}
                  </span>
                </p>
                {grupo.proyectos.map((proyecto) => (
                  <ProyectoRow key={proyecto.repo} proyecto={proyecto} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
