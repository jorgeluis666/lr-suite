"use client";

import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/utils/supabase/client";
import { connectedUsersToShow, initialPendingTasks } from "../data";
import type {
  CompletedPendingAction,
  CompletedPendingTask,
  PendingChecklistItem,
  PendingPresenceUser,
  PendingPriority,
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
  Pick<
    PendingTask,
    | "checklist"
    | "estado"
    | "fecha_fin"
    | "fecha_inicio"
    | "prioridad"
    | "responsable"
    | "tiempo_trabajado"
    | "titulo"
  >
>;

type CompletedHistoryView = "completadas" | "eliminadas" | "todas";

const STATUS_LABELS: Record<PendingStatus, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  bloqueado: "Bloqueado"
};

const STATUS_PILL_CLASSES: Record<PendingStatus, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  en_proceso: "bg-blue-100 text-blue-700",
  bloqueado: "bg-gray-800 text-white"
};

const PRIORITY_OPTIONS: PendingPriority[] = ["Alta", "Media", "Baja"];

const PRIORITY_PILL_CLASSES: Record<PendingPriority, string> = {
  Alta: "bg-red-100 text-red-700",
  Media: "bg-yellow-100 text-yellow-700",
  Baja: "bg-green-100 text-green-700"
};

export function ListaPendientesModule({ user, workspaceId, responsables = [] }: ListaPendientesModuleProps) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const saveTimersRef = useRef<Record<string, number>>({});
  const pendingPatchesRef = useRef<Record<string, PendingTaskPatch>>({});
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
  const [newTaskPriority, setNewTaskPriority] = useState<PendingPriority>("Media");
  const [filterOwner, setFilterOwner] = useState("Todos");
  const [filterStatus, setFilterStatus] = useState<"Todos" | PendingStatus>("Todos");
  const [filterPriority, setFilterPriority] = useState<"Todas" | PendingPriority>("Todas");
  const [historyMonth, setHistoryMonth] = useState(() => monthKeyOf(new Date().toISOString()));
  const [activeTimers, setActiveTimers] = useState<Record<string, number>>({});
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [completedHistoryView, setCompletedHistoryView] =
    useState<CompletedHistoryView>("completadas");
  const [historyCollapsed, setHistoryCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("lista-pendientes-historial-minimizado") === "1";
  });
  const [expandedChecklists, setExpandedChecklists] = useState<Record<string, boolean>>({});
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (!Object.keys(activeTimers).length) return undefined;
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeTimers]);

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

    if ((activeCount ?? 0) > 0 || (completedCount ?? 0) > 0) return;

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
  }, [user, workspaceId]);

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

      setTasks(
        ((activeRows ?? []) as PendingTask[]).map((task) => ({
          ...task,
          checklist: Array.isArray(task.checklist) ? task.checklist : [],
          prioridad: task.prioridad ?? "Media",
          tiempo_trabajado:
            typeof task.tiempo_trabajado === "number" ? task.tiempo_trabajado : 0
        }))
      );
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

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      const owner = task.responsable?.trim() || "Sin responsable";
      const ownerMatch = filterOwner === "Todos" || owner === filterOwner;
      const statusMatch = filterStatus === "Todos" || task.estado === filterStatus;
      const priorityMatch =
        filterPriority === "Todas" || (task.prioridad ?? "Media") === filterPriority;
      return ownerMatch && statusMatch && priorityMatch;
    });
  }, [filterOwner, filterPriority, filterStatus, tasks]);

  const completedInMonth = useMemo(() => {
    return completedTasks.filter((task) => {
      const monthMatch = monthKeyOf(task.fecha_finalizacion) === historyMonth;
      const ownerMatch =
        filterOwner === "Todos" || (task.responsable?.trim() || "Sin responsable") === filterOwner;
      return monthMatch && ownerMatch;
    });
  }, [completedTasks, filterOwner, historyMonth]);

  const completedHistoryCounts = useMemo(() => {
    return completedInMonth.reduce(
      (acc, task) => {
        if (task.accion === "eliminada") acc.eliminadas += 1;
        else acc.completadas += 1;
        acc.todas += 1;
        return acc;
      },
      { completadas: 0, eliminadas: 0, todas: 0 }
    );
  }, [completedInMonth]);

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
      return completedInMonth.filter((task) => task.accion === "eliminada");
    }
    if (completedHistoryView === "todas") return completedInMonth;
    return completedInMonth.filter((task) => task.accion !== "eliminada");
  }, [completedHistoryView, completedInMonth]);

  const monthOptions = useMemo(() => {
    const keys = new Set<string>([monthKeyOf(new Date().toISOString()), historyMonth]);
    completedTasks.forEach((task) => keys.add(monthKeyOf(task.fecha_finalizacion)));
    return Array.from(keys)
      .sort()
      .reverse()
      .map((key) => ({ key, label: formatMonthLabel(key) }));
  }, [completedTasks, historyMonth]);

  const metrics = useMemo(() => {
    const now = new Date();
    return [
      {
        label: "Pendientes abiertos",
        value: visibleTasks.length,
        description: "Tareas visibles todavía activas"
      },
      {
        label: "Vencidos",
        value: tasks.filter(
          (task) => task.fecha_fin != null && new Date(task.fecha_fin) < now
        ).length,
        description: "Pendientes con fecha límite pasada"
      },
      {
        label: "Completados",
        value: completedHistoryCounts.completadas,
        description: "Historial filtrado de tareas cerradas"
      },
      {
        label: "Bloqueados",
        value: tasks.filter((task) => task.estado === "bloqueado").length,
        description: "Requieren destrabe operativo"
      }
    ];
  }, [completedHistoryCounts, tasks, visibleTasks]);

  const taskGroups = useMemo(() => {
    const byResponsible = visibleTasks.reduce<Record<string, PendingTask[]>>((acc, task) => {
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
  }, [responsibleOptions, visibleTasks]);

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
    pendingPatchesRef.current[taskId] = { ...pendingPatchesRef.current[taskId], ...patch };
    window.clearTimeout(saveTimersRef.current[taskId]);
    saveTimersRef.current[taskId] = window.setTimeout(() => {
      const merged = pendingPatchesRef.current[taskId];
      delete pendingPatchesRef.current[taskId];
      if (merged) saveTaskPatch(taskId, merged);
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

  function taskSeconds(task: PendingTask) {
    const base = task.tiempo_trabajado ?? 0;
    const startedAt = activeTimers[task.id];
    if (!startedAt) return base;
    return base + Math.max(0, Math.floor((timerNow - startedAt) / 1000));
  }

  function stopTimerLocally(taskId: string) {
    setActiveTimers((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  function toggleTimer(task: PendingTask) {
    const startedAt = activeTimers[task.id];

    if (startedAt) {
      const total =
        (task.tiempo_trabajado ?? 0) +
        Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      stopTimerLocally(task.id);
      updateTaskLocal(task.id, { tiempo_trabajado: total });
      saveTaskPatch(task.id, { tiempo_trabajado: total });
      return;
    }

    setTimerNow(Date.now());
    setActiveTimers((current) => ({ ...current, [task.id]: Date.now() }));
    if (task.estado === "pendiente") {
      scheduleTaskSave(task.id, { estado: "en_proceso" });
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

    const payload = {
      created_by: user.id,
      estado: "pendiente" as PendingStatus,
      fecha_creacion: new Date().toISOString(),
      fecha_fin: toDatabaseDateTime(newTaskDueDate),
      fecha_inicio: toDatabaseDateTime(newTaskStartDate),
      prioridad: newTaskPriority,
      responsable: newTaskOwner.trim() || responsibleNames[0] || null,
      titulo: newTaskTitle.trim(),
      workspace_id: workspaceId
    };

    let { error } = await supabase.from("lista_pendientes").insert([payload]);

    if (error && /prioridad/i.test(getErrorMessage(error))) {
      const { prioridad: _omitted, ...basePayload } = payload;
      void _omitted;
      ({ error } = await supabase.from("lista_pendientes").insert([basePayload]));
    }

    if (error) {
      setErrorMessage(`No se pudo crear el pendiente: ${getErrorMessage(error)}`);
    } else {
      setNewTaskTitle("");
      setNewTaskStartDate("");
      setNewTaskDueDate("");
      setNewTaskPriority("Media");
    }

    setSaving(false);
  }

  async function moveTaskToCompleted(task: PendingTask, action: CompletedPendingAction) {
    if (!workspaceId || !user) return;

    setSaving(true);
    setErrorMessage("");

    const startedAt = activeTimers[task.id];
    const finalSeconds =
      (task.tiempo_trabajado ?? 0) +
      (startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0);
    if (startedAt) stopTimerLocally(task.id);

    setTasks((currentTasks) => currentTasks.filter((current) => current.id !== task.id));

    const completedAt = new Date().toISOString();
    const payload = {
      accion: action,
      fecha_creacion: task.fecha_creacion,
      fecha_finalizacion: completedAt,
      original_task_id: task.id,
      responsable: task.responsable,
      tiempo_trabajado: finalSeconds,
      titulo: task.titulo,
      usuario_accion_id: user.id,
      usuario_accion_nombre: displayName,
      workspace_id: workspaceId
    };

    let { error: insertError } = await supabase
      .from("lista_pendientes_completadas")
      .insert([payload]);

    if (insertError && /tiempo_trabajado/i.test(getErrorMessage(insertError))) {
      const { tiempo_trabajado: _omitted, ...basePayload } = payload;
      void _omitted;
      ({ error: insertError } = await supabase
        .from("lista_pendientes_completadas")
        .insert([basePayload]));
    }

    if (insertError) {
      setErrorMessage(`No se pudo consolidar el pendiente: ${getErrorMessage(insertError)}`);
      setSaving(false);
      loadPendingData();
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

  function toggleHistoryCollapsed() {
    setHistoryCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem("lista-pendientes-historial-minimizado", next ? "1" : "0");
      return next;
    });
  }

  function toggleChecklistExpanded(taskId: string) {
    setExpandedChecklists((current) => ({ ...current, [taskId]: !current[taskId] }));
  }

  function saveChecklist(taskId: string, items: PendingChecklistItem[]) {
    scheduleTaskSave(taskId, { checklist: items });
  }

  function addChecklistItem(task: PendingTask) {
    const texto = (checklistDrafts[task.id] ?? "").trim();
    if (!texto) return;

    const items = [
      ...(task.checklist ?? []),
      { hecho: false, id: crypto.randomUUID(), texto }
    ];
    setChecklistDrafts((drafts) => ({ ...drafts, [task.id]: "" }));
    setExpandedChecklists((current) => ({ ...current, [task.id]: true }));
    saveChecklist(task.id, items);
  }

  function toggleChecklistItem(task: PendingTask, itemId: string) {
    const items = (task.checklist ?? []).map((item) =>
      item.id === itemId ? { ...item, hecho: !item.hecho } : item
    );
    saveChecklist(task.id, items);
  }

  function removeChecklistItem(task: PendingTask, itemId: string) {
    const items = (task.checklist ?? []).filter((item) => item.id !== itemId);
    saveChecklist(task.id, items);
  }

  if (!workspaceId) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-2xl font-bold text-gray-950">Panel de Pendientes</h3>
        <p className="mt-2 text-sm text-gray-600">Selecciona o crea un workspace para ver pendientes.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {/* Encabezado del panel */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">
              <span aria-hidden="true">💲</span> Operaciones
            </span>
            <h3 className="mt-3 text-3xl font-bold text-gray-950">Panel de Pendientes</h3>
            <p className="mt-2 max-w-3xl text-sm text-gray-600">
              Seguimiento colaborativo editable por responsable, fecha de inicio, fecha fin y
              tiempo dedicado.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-800">
            <span aria-hidden="true">📅</span>
            <select
              value={historyMonth}
              onChange={(event) => setHistoryMonth(event.target.value)}
              className="cursor-pointer bg-transparent outline-none"
            >
              {monthOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 grid gap-3 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
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
                      : "Sin conexión activa"}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    {metric.label}
                  </p>
                  <p className="text-2xl font-bold leading-none text-gray-950">{metric.value}</p>
                </div>
                <p className="mt-2 text-xs text-gray-400">{metric.description}</p>
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

      {/* Alta de pendientes */}
      <form
        onSubmit={handleCreateTask}
        className="grid gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_180px_150px_150px_130px_auto] lg:items-end"
      >
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Pendiente
          </span>
          <input
            value={newTaskTitle}
            onChange={(event) => setNewTaskTitle(event.target.value)}
            placeholder="Nueva tarea pendiente"
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Responsable
          </span>
          <select
            value={newTaskOwner}
            onChange={(event) => setNewTaskOwner(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          >
            {responsibleNames.map((responsable) => (
              <option key={responsable} value={responsable}>
                {responsable}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Inicio
          </span>
          <input
            type="date"
            value={newTaskStartDate}
            onChange={(event) => setNewTaskStartDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Fin
          </span>
          <input
            type="date"
            value={newTaskDueDate}
            onChange={(event) => setNewTaskDueDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Prioridad
          </span>
          <select
            value={newTaskPriority}
            onChange={(event) => setNewTaskPriority(event.target.value as PendingPriority)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          >
            {PRIORITY_OPTIONS.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-red-700 px-5 py-2.5 font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-400"
        >
          Agregar
        </button>
      </form>

      {/* Tablero de pendientes */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="text-xl font-bold text-gray-950">Tablero de pendientes</h4>
            <p className="mt-0.5 text-sm text-gray-500">
              {visibleTasks.length} tareas visibles
              {loading ? " · Sincronizando..." : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700">
              Responsable
              <select
                value={filterOwner}
                onChange={(event) => setFilterOwner(event.target.value)}
                className="cursor-pointer bg-transparent font-bold outline-none"
              >
                {["Todos", ...responsibleNames].map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700">
              Estado
              <select
                value={filterStatus}
                onChange={(event) =>
                  setFilterStatus(event.target.value as "Todos" | PendingStatus)
                }
                className="cursor-pointer bg-transparent font-bold outline-none"
              >
                <option value="Todos">Todos</option>
                {(Object.keys(STATUS_LABELS) as PendingStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700">
              Prioridad
              <select
                value={filterPriority}
                onChange={(event) =>
                  setFilterPriority(event.target.value as "Todas" | PendingPriority)
                }
                className="cursor-pointer bg-transparent font-bold outline-none"
              >
                <option value="Todas">Todas</option>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {taskGroups.map((group) => (
          <div key={group.name}>
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-400">
                Pendientes de {group.name}
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {group.tasks.map((task) => {
                const editors = editingByTask[task.id] ?? [];
                const isOverdue =
                  task.fecha_fin != null && new Date(task.fecha_fin) < new Date();
                const checklistItems = task.checklist ?? [];
                const checklistDone = checklistItems.filter((item) => item.hecho).length;
                const checklistExpanded = Boolean(expandedChecklists[task.id]);
                const timerActive = Boolean(activeTimers[task.id]);
                const priority = (task.prioridad ?? "Media") as PendingPriority;
                return (
                  <article
                    key={task.id}
                    className="px-6 py-3 transition-colors hover:bg-gray-50/70"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="shrink-0 select-none text-base leading-none text-gray-300">
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
                        className="min-w-[220px] flex-1 resize-none overflow-hidden bg-transparent text-sm font-bold leading-snug text-gray-950 outline-none placeholder:text-gray-400"
                      />

                      <label className="flex shrink-0 items-center gap-1 text-xs text-gray-400">
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
                          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-700 outline-none hover:bg-gray-100 focus:bg-gray-100"
                        />
                      </label>
                      <label className="flex shrink-0 items-center gap-1 text-xs text-gray-400">
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
                          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-700 outline-none hover:bg-gray-100 focus:bg-gray-100"
                        />
                      </label>

                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 ${
                          timerActive
                            ? "border-green-300 bg-green-50"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <span className="text-xs font-bold tabular-nums text-gray-800">
                          {formatTimer(taskSeconds(task))}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleTimer(task)}
                          className={`text-xs font-bold transition ${
                            timerActive
                              ? "text-amber-600 hover:text-amber-700"
                              : "text-gray-600 hover:text-gray-900"
                          }`}
                        >
                          {timerActive ? "Pausar" : "Iniciar"}
                        </button>
                      </span>

                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => moveTaskToCompleted(task, "completada")}
                        className="shrink-0 rounded-lg border border-green-200 bg-green-50 px-3 py-1 text-xs font-bold text-green-700 transition hover:bg-green-100 disabled:opacity-40"
                      >
                        Terminar
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
                        className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
                      >
                        Borrar
                      </button>

                      <select
                        value={task.estado}
                        onFocus={() => updatePresence(task)}
                        onBlur={() => updatePresence(null)}
                        onChange={(e) =>
                          scheduleTaskSave(task.id, {
                            estado: e.target.value as PendingStatus,
                          })
                        }
                        className={`shrink-0 cursor-pointer rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold outline-none ${STATUS_PILL_CLASSES[task.estado] ?? STATUS_PILL_CLASSES.pendiente}`}
                      >
                        {(Object.keys(STATUS_LABELS) as PendingStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                      <select
                        value={priority}
                        onFocus={() => updatePresence(task)}
                        onBlur={() => updatePresence(null)}
                        onChange={(e) =>
                          scheduleTaskSave(task.id, {
                            prioridad: e.target.value as PendingPriority,
                          })
                        }
                        className={`shrink-0 cursor-pointer rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold outline-none ${PRIORITY_PILL_CLASSES[priority]}`}
                      >
                        {PRIORITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      {isOverdue && (
                        <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
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
                        className="shrink-0 cursor-pointer rounded-full border-0 bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 outline-none hover:bg-gray-200"
                      >
                        <option value="">Sin asignar</option>
                        {responsibleOptions.map((r) => (
                          <option key={r.email ?? r.nombre} value={r.nombre}>
                            {r.nombre}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Fila 2: checklist + edición en vivo */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pl-6">
                      <button
                        type="button"
                        onClick={() => toggleChecklistExpanded(task.id)}
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition ${
                          checklistItems.length
                            ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        }`}
                      >
                        <span
                          className={`text-[10px] transition-transform ${
                            checklistExpanded ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        Checklist
                        {checklistItems.length ? ` ${checklistDone}/${checklistItems.length}` : ""}
                      </button>
                      {editors.length ? (
                        <span className="text-xs font-semibold text-blue-600">
                          {editors.map((e) => e.name).join(", ")} editando
                        </span>
                      ) : null}
                    </div>

                    {/* Fila 3: checklist interno */}
                    {checklistExpanded ? (
                      <div className="mt-2 space-y-1 rounded-lg bg-gray-50 px-3 py-2 ml-6">
                        {checklistItems.map((item) => (
                          <div key={item.id} className="group flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.hecho}
                              onChange={() => toggleChecklistItem(task, item.id)}
                              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-green-600"
                            />
                            <span
                              className={`min-w-0 flex-1 text-xs ${
                                item.hecho ? "text-gray-400 line-through" : "text-gray-700"
                              }`}
                            >
                              {item.texto}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeChecklistItem(task, item.id)}
                              className="shrink-0 text-xs text-gray-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                              aria-label="Eliminar ítem del checklist"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            value={checklistDrafts[task.id] ?? ""}
                            onChange={(event) =>
                              setChecklistDrafts((drafts) => ({
                                ...drafts,
                                [task.id]: event.target.value
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addChecklistItem(task);
                              }
                            }}
                            placeholder="Agregar ítem al checklist"
                            className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs outline-none focus:border-red-600"
                          />
                          <button
                            type="button"
                            onClick={() => addChecklistItem(task)}
                            className="shrink-0 rounded bg-gray-200 px-2.5 py-1 text-xs font-bold text-gray-700 transition hover:bg-gray-300"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        ))}

        {!visibleTasks.length && !loading ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            Sin pendientes visibles. Los completados o eliminados quedan en el historial.
          </div>
        ) : null}
      </section>

      {/* Historial consolidado */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className={`flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between ${historyCollapsed ? "" : "mb-5"}`}>
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
            <button
              type="button"
              onClick={toggleHistoryCollapsed}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              {historyCollapsed ? "▸ Mostrar" : "▾ Minimizar"}
            </button>
            {historyCollapsed
              ? null
              : completedHistoryOptions.map((option) => (
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
            {historyCollapsed ? null : (
              <button
                type="button"
                disabled={!completedTasks.length}
                onClick={() => downloadCompletedTasksCsv(completedTasks)}
                className="rounded-lg bg-red-700 px-5 py-2 text-sm font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                Descargar tabla
              </button>
            )}
          </div>
        </div>
        <div className={`overflow-x-auto ${historyCollapsed ? "hidden" : ""}`}>
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="px-4 py-3">Pendiente</th>
                <th className="px-4 py-3">Responsable</th>
                <th className="px-4 py-3">Creación</th>
                <th className="px-4 py-3">Finalización</th>
                <th className="px-4 py-3">Tiempo</th>
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
                  <td className="px-4 py-3 tabular-nums">
                    {formatTimer(task.tiempo_trabajado ?? 0)}
                  </td>
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
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    Aún no hay tareas completadas o eliminadas para este mes.
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
    "Tiempo",
    "Usuario",
    "Acción"
  ];
  const rows = tasks.map((task) => [
    task.titulo,
    task.responsable || "Sin asignar",
    formatLocalDate(task.fecha_creacion),
    formatLocalDate(task.fecha_finalizacion),
    formatTimer(task.tiempo_trabajado ?? 0),
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

function formatTimer(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function monthKeyOf(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: "America/Lima",
    year: "numeric"
  }).format(new Date(value));
}

function formatMonthLabel(key: string) {
  const label = new Intl.DateTimeFormat("es-PE", {
    month: "long",
    year: "numeric"
  })
    .format(new Date(`${key}-01T12:00:00`))
    .replace(" de ", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
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
