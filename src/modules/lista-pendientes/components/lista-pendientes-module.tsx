"use client";

import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/utils/supabase/client";
import {
  connectedUsersToShow,
  initialPendingTasks,
  jorgeLuisPendingTasks,
  legacyJorgeLuisPendingTitles
} from "../data";
import type {
  CompletedPendingAction,
  CompletedPendingTask,
  PendingPresenceUser,
  PendingResponsibleOption,
  PendingStatus,
  PendingTask
} from "../types";

type ListaPendientesModuleProps = {
  user: User | null;
  workspaceId: string;
  responsables?: PendingResponsibleOption[];
};

type PendingTaskPatch = Partial<
  Pick<PendingTask, "estado" | "fecha_fin" | "fecha_inicio" | "responsable" | "titulo">
>;

type CompletedHistoryView = "completadas" | "eliminadas" | "todas";

export function ListaPendientesModule({ user, workspaceId, responsables = [] }: ListaPendientesModuleProps) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const saveTimersRef = useRef<Record<string, number>>({});
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<CompletedPendingTask[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PendingPresenceUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskOwner, setNewTaskOwner] = useState("");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [completedHistoryView, setCompletedHistoryView] =
    useState<CompletedHistoryView>("completadas");

  const displayName = useMemo(() => getUserDisplayName(user), [user]);
  const responsibleOptions = useMemo(() => {
    const normalized = responsables
      .map((responsable, index) => ({
        ...responsable,
        nombre: responsable.nombre.trim(),
        orden: Number.isFinite(responsable.orden) ? responsable.orden : index + 1
      }))
      .filter((responsable) => responsable.nombre);
    const unique = new Map<string, PendingResponsibleOption>();

    normalized.forEach((responsable) => {
      const key = normalizeText(responsable.nombre);
      const current = unique.get(key);
      if (!current || responsable.orden < current.orden) {
        unique.set(key, responsable);
      }
    });

    const sorted = Array.from(unique.values()).sort(
      (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)
    );
    return sorted.length ? sorted : [{ nombre: displayName, orden: 1 }];
  }, [displayName, responsables]);

  const responsibleNames = useMemo(
    () => responsibleOptions.map((responsable) => responsable.nombre),
    [responsibleOptions]
  );

  useEffect(() => {
    if (!responsibleNames.includes(newTaskOwner)) {
      setNewTaskOwner(responsibleNames[0] ?? "");
    }
  }, [newTaskOwner, responsibleNames]);

  const migrateJorgeLuisTasks = useCallback(async () => {
    if (!workspaceId || !user) return;

    const { data, error } = await supabase
      .from("lista_pendientes")
      .select("id,titulo,fecha_inicio,fecha_fin")
      .eq("workspace_id", workspaceId)
      .eq("responsable", "Jorge Luis")
      .order("fecha_creacion", { ascending: true });

    if (error) throw error;

    const currentTasks = data ?? [];
    const hasLegacyTasks = currentTasks.some((task) =>
      legacyJorgeLuisPendingTitles.includes(task.titulo)
    );
    const currentByTitle = new Map(currentTasks.map((task) => [task.titulo, task]));
    const schedulesMatch = (current: string | null, desired: string | null) => {
      if (!current || !desired) return current === desired;
      return new Date(current).getTime() === new Date(desired).getTime();
    };
    const needsSchedule = jorgeLuisPendingTasks.some((desired) => {
      const current = currentByTitle.get(desired.titulo);
      return Boolean(
        current &&
          (!schedulesMatch(current.fecha_inicio, desired.fecha_inicio) ||
            !schedulesMatch(current.fecha_fin, desired.fecha_fin))
      );
    });

    const now = new Date().toISOString();

    if (needsSchedule) {
      for (const desired of jorgeLuisPendingTasks) {
        const current = currentByTitle.get(desired.titulo);
        if (!current) continue;

        const { error: updateError } = await supabase
          .from("lista_pendientes")
          .update({
            fecha_fin: desired.fecha_fin,
            fecha_inicio: desired.fecha_inicio,
            updated_at: now
          })
          .eq("id", current.id)
          .eq("workspace_id", workspaceId);

        if (updateError) throw updateError;
      }
      return;
    }

    if (!hasLegacyTasks) return;

    const sharedLength = Math.min(currentTasks.length, jorgeLuisPendingTasks.length);

    for (let index = 0; index < sharedLength; index += 1) {
      const { error: updateError } = await supabase
        .from("lista_pendientes")
        .update({
          ...jorgeLuisPendingTasks[index],
          updated_at: now
        })
        .eq("id", currentTasks[index].id)
        .eq("workspace_id", workspaceId);

      if (updateError) throw updateError;
    }

    if (currentTasks.length < jorgeLuisPendingTasks.length) {
      const { error: insertError } = await supabase.from("lista_pendientes").insert(
        jorgeLuisPendingTasks.slice(currentTasks.length).map((task) => ({
          ...task,
          created_by: user.id,
          fecha_creacion: now,
          workspace_id: workspaceId
        }))
      );

      if (insertError) throw insertError;
    }

    if (currentTasks.length > jorgeLuisPendingTasks.length) {
      const extraIds = currentTasks.slice(jorgeLuisPendingTasks.length).map((task) => task.id);
      const { error: deleteError } = await supabase
        .from("lista_pendientes")
        .delete()
        .in("id", extraIds)
        .eq("workspace_id", workspaceId);

      if (deleteError) throw deleteError;
    }
  }, [user, workspaceId]);

  const ensureInitialTasks = useCallback(async () => {
    if (!workspaceId || !user) return;

    const { count: activeCount, error: activeError } = await supabase
      .from("lista_pendientes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (activeError) throw activeError;

    const { count: completedCount, error: completedError } = await supabase
      .from("lista_pendientes_completadas")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (completedError) throw completedError;

    if ((activeCount ?? 0) > 0 || (completedCount ?? 0) > 0) {
      await migrateJorgeLuisTasks();
      return;
    }

    const today = new Date().toISOString();
    const { error } = await supabase.from("lista_pendientes").insert(
      initialPendingTasks.map((task) => ({
        ...task,
        created_by: user.id,
        fecha_creacion: today,
        workspace_id: workspaceId
      }))
    );

    if (error) throw error;
  }, [migrateJorgeLuisTasks, user, workspaceId]);

  const loadPendingData = useCallback(async () => {
    if (!workspaceId || !user) return;

    setLoading(true);
    setErrorMessage("");

    try {
      await ensureInitialTasks();

      const [{ data: activeRows, error: activeError }, { data: completedRows, error: completedError }] =
        await Promise.all([
          supabase
            .from("lista_pendientes")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("fecha_creacion", { ascending: true }),
          supabase
            .from("lista_pendientes_completadas")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("fecha_finalizacion", { ascending: false })
        ]);

      if (activeError) throw activeError;
      if (completedError) throw completedError;

      setTasks((activeRows ?? []) as PendingTask[]);
      setCompletedTasks((completedRows ?? []) as CompletedPendingTask[]);
    } catch (error) {
      setErrorMessage(
        `No se pudo cargar Lista de Pendientes. Revisa el schema en src/modules/lista-pendientes/BBDD/schema.sql. Detalle: ${getErrorMessage(error)}`
      );
    } finally {
      setLoading(false);
    }
  }, [ensureInitialTasks, user, workspaceId]);

  useEffect(() => {
    loadPendingData();
  }, [loadPendingData]);

  useEffect(() => {
    if (!workspaceId || !user) return undefined;

    const channel = supabase.channel(`lista-pendientes-${workspaceId}`, {
      config: {
        presence: {
          key: user.id
        }
      }
    });
    channelRef.current = channel;

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `workspace_id=eq.${workspaceId}`,
          schema: "public",
          table: "lista_pendientes"
        },
        () => loadPendingData()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `workspace_id=eq.${workspaceId}`,
          schema: "public",
          table: "lista_pendientes_completadas"
        },
        () => loadPendingData()
      )
      .on("presence", { event: "sync" }, () => {
        setPresenceUsers(readPresenceUsers(channel));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track(buildPresencePayload(user, displayName, null));
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [displayName, loadPendingData, user, workspaceId]);

  const editingByTask = useMemo(() => {
    return presenceUsers.reduce<Record<string, PendingPresenceUser[]>>((acc, presenceUser) => {
      if (!presenceUser.editingTaskId) return acc;
      acc[presenceUser.editingTaskId] = [
        ...(acc[presenceUser.editingTaskId] ?? []),
        presenceUser
      ];
      return acc;
    }, {});
  }, [presenceUsers]);

  const connectedStatus = useMemo(() => {
    return connectedUsersToShow.map((name) => ({
      name,
      presence: presenceUsers.find((presenceUser) => matchesKnownUser(presenceUser, name))
    }));
  }, [presenceUsers]);

  const completedHistoryCounts = useMemo(() => {
    return completedTasks.reduce(
      (acc, task) => {
        if (task.accion === "eliminada") acc.eliminadas += 1;
        else acc.completadas += 1;
        acc.todas += 1;
        return acc;
      },
      { completadas: 0, eliminadas: 0, todas: 0 }
    );
  }, [completedTasks]);

  const completedHistoryOptions = useMemo(
    () => [
      { count: completedHistoryCounts.completadas, id: "completadas" as const, label: "Completadas" },
      { count: completedHistoryCounts.eliminadas, id: "eliminadas" as const, label: "Eliminadas" },
      { count: completedHistoryCounts.todas, id: "todas" as const, label: "Todas" }
    ],
    [completedHistoryCounts]
  );

  const visibleCompletedTasks = useMemo(() => {
    if (completedHistoryView === "eliminadas") {
      return completedTasks.filter((task) => task.accion === "eliminada");
    }
    if (completedHistoryView === "todas") return completedTasks;
    return completedTasks.filter((task) => task.accion !== "eliminada");
  }, [completedHistoryView, completedTasks]);

  const taskGroups = useMemo(() => {
    const byResponsible = tasks.reduce<Record<string, PendingTask[]>>((acc, task) => {
      const responsible = task.responsable?.trim() || "Sin responsable";
      acc[responsible] = [...(acc[responsible] ?? []), task];
      return acc;
    }, {});
    const orderedGroups = responsibleOptions.map((responsable) => ({
      name: responsable.nombre,
      tasks: byResponsible[responsable.nombre] ?? []
    }));
    const orderedNames = new Set(responsibleOptions.map((responsable) => responsable.nombre));
    const extraGroups = Object.entries(byResponsible)
      .filter(([name]) => !orderedNames.has(name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, groupTasks]) => ({ name, tasks: groupTasks }));

    return [...orderedGroups, ...extraGroups].filter((group) => group.tasks.length);
  }, [responsibleOptions, tasks]);

  const completedHistoryTitle =
    completedHistoryView === "eliminadas"
      ? "Tareas eliminadas"
      : completedHistoryView === "todas"
        ? "Historial de tareas"
        : "Tareas completadas";

  function updatePresence(task: PendingTask | null) {
    if (!user || !channelRef.current) return;
    channelRef.current.track(buildPresencePayload(user, displayName, task));
  }

  function updateTaskLocal(taskId: string, patch: PendingTaskPatch) {
    setTasks((currentTasks) =>
      currentTasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
    );
  }

  function scheduleTaskSave(taskId: string, patch: PendingTaskPatch) {
    updateTaskLocal(taskId, patch);
    window.clearTimeout(saveTimersRef.current[taskId]);
    saveTimersRef.current[taskId] = window.setTimeout(() => {
      saveTaskPatch(taskId, patch);
    }, 350);
  }

  async function saveTaskPatch(taskId: string, patch: PendingTaskPatch) {
    if (!workspaceId) return;

    const { error } = await supabase
      .from("lista_pendientes")
      .update({
        ...patch,
        updated_at: new Date().toISOString()
      })
      .eq("id", taskId)
      .eq("workspace_id", workspaceId);

    if (error) {
      setErrorMessage(`No se pudo actualizar el pendiente: ${getErrorMessage(error)}`);
      loadPendingData();
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !user || saving) return;
    if (!newTaskTitle.trim()) {
      setErrorMessage("Escribe el nombre del pendiente.");
      return;
    }

    setSaving(true);
    setErrorMessage("");

    const { error } = await supabase.from("lista_pendientes").insert([
      {
        created_by: user.id,
        estado: "pendiente" as PendingStatus,
        fecha_creacion: new Date().toISOString(),
        fecha_fin: toDatabaseDateTime(newTaskDueDate),
        fecha_inicio: toDatabaseDateTime(newTaskStartDate),
        responsable: newTaskOwner.trim() || responsibleNames[0] || null,
        titulo: newTaskTitle.trim(),
        workspace_id: workspaceId
      }
    ]);

    if (error) {
      setErrorMessage(`No se pudo crear el pendiente: ${getErrorMessage(error)}`);
    } else {
      setNewTaskTitle("");
      setNewTaskStartDate("");
      setNewTaskDueDate("");
    }

    setSaving(false);
  }

  async function moveTaskToCompleted(task: PendingTask, action: CompletedPendingAction) {
    if (!workspaceId || !user) return;

    setSaving(true);
    setErrorMessage("");

    const completedAt = new Date().toISOString();
    const { error: insertError } = await supabase.from("lista_pendientes_completadas").insert([
      {
        accion: action,
        fecha_creacion: task.fecha_creacion,
        fecha_finalizacion: completedAt,
        original_task_id: task.id,
        responsable: task.responsable,
        titulo: task.titulo,
        usuario_accion_id: user.id,
        usuario_accion_nombre: displayName,
        workspace_id: workspaceId
      }
    ]);

    if (insertError) {
      setErrorMessage(`No se pudo consolidar el pendiente: ${getErrorMessage(insertError)}`);
      setSaving(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("lista_pendientes")
      .delete()
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);

    if (deleteError) {
      setErrorMessage(`Se consolidó, pero no se pudo retirar de la lista: ${getErrorMessage(deleteError)}`);
    }

    setSaving(false);
    loadPendingData();
  }

  if (!workspaceId) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-2xl font-bold text-gray-950">Lista de Pendientes</h3>
        <p className="mt-2 text-sm text-gray-600">Selecciona o crea un workspace para ver pendientes.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
              Operaciones
            </p>
            <h3 className="mt-2 text-2xl font-bold text-gray-950">Lista de Pendientes</h3>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Pendientes colaborativos con edición en tiempo real, presencia de usuarios e historial consolidado.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {connectedStatus.map(({ name, presence }) => (
              <div
                key={name}
                className={`rounded-lg border px-4 py-3 text-sm ${
                  presence
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-gray-200 bg-gray-50 text-gray-500"
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      presence ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  {name}
                </div>
                <p className="mt-1 text-xs">
                  {presence?.editingTaskTitle
                    ? `Editando: ${presence.editingTaskTitle}`
                    : presence
                      ? "Conectado"
                      : "Desconectado"}
                </p>
              </div>
            ))}
          </div>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errorMessage}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleCreateTask}
        className="grid gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_190px_150px_150px_auto]"
      >
        <input
          value={newTaskTitle}
          onChange={(event) => setNewTaskTitle(event.target.value)}
          placeholder="Nuevo pendiente"
          className="rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
        />
        <select
          value={newTaskOwner}
          onChange={(event) => setNewTaskOwner(event.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
        >
          {responsibleNames.map((responsable) => (
            <option key={responsable} value={responsable}>
              {responsable}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={newTaskStartDate}
          onChange={(event) => setNewTaskStartDate(event.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          aria-label="Fecha de inicio"
        />
        <input
          type="datetime-local"
          value={newTaskDueDate}
          onChange={(event) => setNewTaskDueDate(event.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          aria-label="Fecha de fin"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-red-700 px-5 py-3 font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-400"
        >
          Agregar
        </button>
      </form>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">Pendientes activos</p>
            <h4 className="mt-1 text-xl font-bold text-gray-950">{tasks.length} tareas en lista</h4>
          </div>
          {loading ? <p className="text-sm font-semibold text-gray-400">Sincronizando...</p> : null}
        </div>

        {taskGroups.map((group) => (
          <div key={group.name}>
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-400">
                {group.name}
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {group.tasks.map((task) => {
                const editors = editingByTask[task.id] ?? [];
                const isOverdue =
                  task.fecha_fin != null && new Date(task.fecha_fin) < new Date();
                return (
                  <article
                    key={task.id}
                    className="px-6 py-3 transition-colors hover:bg-gray-50/70"
                  >
                    {/* Fila 1: título + badges */}
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-[2px] shrink-0 select-none text-base leading-none text-gray-300">
                        ⠿
                      </span>
                      <textarea
                        value={task.titulo}
                        rows={1}
                        onFocus={() => updatePresence(task)}
                        onBlur={() => updatePresence(null)}
                        onChange={(e) =>
                          scheduleTaskSave(task.id, { titulo: e.target.value })
                        }
                        className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-sm font-bold leading-snug text-gray-950 outline-none placeholder:text-gray-400"
                      />
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        <select
                          value={task.estado}
                          onFocus={() => updatePresence(task)}
                          onBlur={() => updatePresence(null)}
                          onChange={(e) =>
                            scheduleTaskSave(task.id, {
                              estado: e.target.value as PendingStatus,
                            })
                          }
                          className={`cursor-pointer rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold outline-none ${
                            task.estado === "en_proceso"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          <option value="pendiente">Pendiente</option>
                          <option value="en_proceso">En proceso</option>
                        </select>
                        {isOverdue && (
                          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                            Vencido
                          </span>
                        )}
                        <select
                          value={task.responsable ?? ""}
                          onFocus={() => updatePresence(task)}
                          onBlur={() => updatePresence(null)}
                          onChange={(e) =>
                            scheduleTaskSave(task.id, {
                              responsable: e.target.value || null,
                            })
                          }
                          className="cursor-pointer rounded-full border-0 bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 outline-none hover:bg-gray-200"
                        >
                          <option value="">Sin asignar</option>
                          {responsibleOptions.map((r) => (
                            <option key={r.email ?? r.nombre} value={r.nombre}>
                              {r.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Fila 2: fechas + acciones */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-6">
                      {editors.length ? (
                        <span className="text-xs font-semibold text-blue-600">
                          {editors.map((e) => e.name).join(", ")} editando
                        </span>
                      ) : null}
                      <label className="flex items-center gap-1 text-xs text-gray-400">
                        Inicio
                        <input
                          type="date"
                          value={toDateTimeLocalValue(task.fecha_inicio).slice(0, 10)}
                          onFocus={() => updatePresence(task)}
                          onBlur={() => updatePresence(null)}
                          onChange={(e) =>
                            scheduleTaskSave(task.id, {
                              fecha_inicio: toDatabaseDateTime(e.target.value),
                            })
                          }
                          className="rounded bg-transparent px-1 py-0.5 text-xs text-gray-700 outline-none hover:bg-gray-100 focus:bg-gray-100"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-gray-400">
                        Fin
                        <input
                          type="date"
                          value={toDateTimeLocalValue(task.fecha_fin).slice(0, 10)}
                          onFocus={() => updatePresence(task)}
                          onBlur={() => updatePresence(null)}
                          onChange={(e) =>
                            scheduleTaskSave(task.id, {
                              fecha_fin: toDatabaseDateTime(e.target.value),
                            })
                          }
                          className="rounded bg-transparent px-1 py-0.5 text-xs text-gray-700 outline-none hover:bg-gray-100 focus:bg-gray-100"
                        />
                      </label>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => moveTaskToCompleted(task, "completada")}
                          className="rounded-lg border border-green-200 bg-green-50 px-3 py-1 text-xs font-bold text-green-700 transition hover:bg-green-100 disabled:opacity-40"
                        >
                          Completar
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            if (
                              window.confirm(
                                "¿Mover este pendiente al historial como eliminado?"
                              )
                            ) {
                              moveTaskToCompleted(task, "eliminada");
                            }
                          }}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
                        >
                          Borrar
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}

        {!tasks.length && !loading ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            No hay pendientes activos. Los completados o eliminados quedan en el historial.
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
              {completedHistoryTitle}
            </p>
            <h4 className="mt-2 text-xl font-bold text-gray-950">Historial consolidado</h4>
            <p className="mt-1 text-sm text-gray-500">
              {visibleCompletedTasks.length} tareas visibles · {completedTasks.length} en historial total
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {completedHistoryOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCompletedHistoryView(option.id)}
                className={`rounded-lg border px-4 py-2 text-sm font-bold transition ${
                  completedHistoryView === option.id
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-gray-200 bg-white text-gray-700 hover:border-red-200 hover:bg-red-50"
                }`}
              >
                {option.label} ({option.count})
              </button>
            ))}
            <button
              type="button"
              disabled={!completedTasks.length}
              onClick={() => downloadCompletedTasksCsv(completedTasks)}
              className="rounded-lg bg-red-700 px-5 py-2 text-sm font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300"
            >
              Descargar tabla
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="px-4 py-3">Pendiente</th>
                <th className="px-4 py-3">Responsable</th>
                <th className="px-4 py-3">Creación</th>
                <th className="px-4 py-3">Finalización</th>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {visibleCompletedTasks.map((task) => (
                <tr key={task.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-950">{task.titulo}</td>
                  <td className="px-4 py-3">{task.responsable || "-"}</td>
                  <td className="px-4 py-3">{formatLocalDate(task.fecha_creacion)}</td>
                  <td className="px-4 py-3">{formatLocalDate(task.fecha_finalizacion)}</td>
                  <td className="px-4 py-3">{task.usuario_accion_nombre}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                        task.accion === "completada"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {task.accion}
                    </span>
                  </td>
                </tr>
              ))}

              {!visibleCompletedTasks.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    Aún no hay tareas completadas o eliminadas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function downloadCompletedTasksCsv(tasks: CompletedPendingTask[]) {
  if (!tasks.length) return;

  const headers = [
    "Pendiente",
    "Responsable",
    "Fecha de creación",
    "Fecha de finalización",
    "Usuario",
    "Acción"
  ];
  const rows = tasks.map((task) => [
    task.titulo,
    task.responsable || "Sin asignar",
    formatLocalDate(task.fecha_creacion),
    formatLocalDate(task.fecha_finalizacion),
    task.usuario_accion_nombre || "Usuario",
    task.accion === "completada" ? "Completada" : "Eliminada"
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tareas-completadas-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

function buildPresencePayload(
  user: User,
  displayName: string,
  task: PendingTask | null
): PendingPresenceUser {
  return {
    editingTaskId: task?.id ?? null,
    editingTaskTitle: task?.titulo ?? null,
    email: user.email,
    name: displayName,
    onlineAt: new Date().toISOString(),
    userId: user.id
  };
}

function readPresenceUsers(channel: RealtimeChannel) {
  const state = channel.presenceState() as Record<string, PendingPresenceUser[]>;
  const byUser = new Map<string, PendingPresenceUser>();

  Object.values(state)
    .flat()
    .forEach((presenceUser) => {
      byUser.set(presenceUser.userId, presenceUser);
    });

  return Array.from(byUser.values());
}

function getUserDisplayName(user: User | null) {
  const metadata = user?.user_metadata ?? {};
  const rawName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : user?.email?.split("@")[0];
  const normalized = (rawName ?? "Usuario").toLowerCase();

  if (normalized.includes("jorge")) return "Jorge Luis";
  if (normalized.includes("diego")) return "Diego";
  return rawName ?? "Usuario";
}

function matchesKnownUser(presenceUser: PendingPresenceUser, knownName: string) {
  const name = normalizeText(presenceUser.name);
  const email = normalizeText(presenceUser.email ?? "");
  const firstName = normalizeText(knownName).split(" ")[0];
  return name.includes(firstName) || email.includes(firstName);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toDatabaseDateTime(value: string) {
  if (!value) return null;
  if (value.length === 10) return `${value}T00:00:00-05:00`;
  return `${value}:00-05:00`;
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Lima",
    year: "numeric"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}
