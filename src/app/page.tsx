"use client";
import { supabase } from "./lib/supabase";
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

type Periodo = "dia" | "semana" | "mes" | "ano" | "personalizado";

interface Workspace {
  id: string;
  nombre: string;
  owner_id: string;
}

interface Filtros {
  periodo: Periodo;
  fechaInicio: string;
  fechaFin: string;
  empresa: string;
  canal: string;
  tipoResultado: string;
}

const initialFiltros: Filtros = {
  periodo: "mes",
  fechaInicio: "",
  fechaFin: "",
  empresa: "",
  canal: "",
  tipoResultado: "",
};

interface Miembro {
  id: string;
  workspace_id: string;
  email: string;
  rol: "admin" | "editor" | "viewer";
  estado: "activo" | "pendiente";
  invitado_por: string;
  invitado_en: string;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function translateSupabaseError(error: any): string {
  const message = String(error?.message || error || "").toLowerCase();

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
  const [isSaving, setIsSaving] = useState(false);
  const [empresas, setEmpresas] = useState<Array<{ id: string; nombre: string }>>([]);
  const [mostrandoNuevaEmpresa, setMostrandoNuevaEmpresa] = useState(false);
  const [nombreNuevaEmpresa, setNombreNuevaEmpresa] = useState("");
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [invitacionForm, setInvitacionForm] = useState({ email: "", rol: "viewer" as "admin" | "editor" | "viewer" });
  const [user, setUser] = useState<any>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceActivo, setWorkspaceActivo] = useState("");

  const [form, setForm] = useState({
    periodoTipo: "dia" as "dia" | "semana" | "mes" | "ano" | "rango",
    fecha: "",
    fechaInicio: "",
    fechaFin: "",
    empresa: "",
    empresaId: "",
    gasto: "",
    resultados: "",
    ventas: "",
    ticketPromedio: "",
    canal: "",
    campana: "",
    tipoResultado: "",
    notas: "",
  });

  const [filtros, setFiltros] = useState<Filtros>(initialFiltros);

  useEffect(() => {
    const initAuth = async () => {
      try {
        setSessionLoading(true);
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          return;
        }
        setUser(data?.user ?? null);
      } finally {
        setSessionLoading(false);
      }
    };

    initAuth();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      authListener.subscription?.unsubscribe();
    };
  }, []);

  async function acceptPendingInvitations() {
    if (!user?.email) return;

    try {
      const { data, error } = await supabase
        .from('workspace_members')
        .update({ user_id: user.id, estado: 'activo' })
        .eq('email', user.email)
        .eq('estado', 'pendiente')
        .is('user_id', null)
        .select('workspace_id');

      if (error) {
        alert(`Error al activar invitaciones: ${translateSupabaseError(error)}`);
        return;
      }

      return data || [];
    } catch (error: any) {
      alert(`Error al activar invitaciones: ${translateSupabaseError(error)}`);
      return [];
    }
  }

  useEffect(() => {
    const loadWorkspaces = async () => {
      if (!user) return;

      await acceptPendingInvitations();

      const loadByOwner = async () => {
        const { data: ownerWorkspaces, error: ownerError } = await supabase
          .from('workspaces')
          .select('id, nombre, owner_id')
          .eq('owner_id', user.id);

        if (ownerError) return null;
        return ownerWorkspaces || [];
      };

      const loadByMembership = async () => {
        const { data: memberships, error: membershipError } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user.id);

        if (membershipError) return null;

        const workspaceIds = (memberships || [])
          .map((row: any) => row.workspace_id)
          .filter(Boolean);

        if (!workspaceIds.length) {
          return [];
        }

        const { data: workspacesData, error: workspacesError } = await supabase
          .from('workspaces')
          .select('id, nombre, owner_id')
          .in('id', workspaceIds);

        if (workspacesError) return null;
        return workspacesData || [];
      };

      let workspacesData = await loadByMembership();
      if (workspacesData === null) {
        workspacesData = await loadByOwner();
      }

      if (!workspacesData || workspacesData.length === 0) {
        const { data: newWorkspace, error: workspaceError } = await supabase
          .from('workspaces')
          .insert([{ nombre: 'Mi Workspace', owner_id: user.id }])
          .select('id, nombre, owner_id')
          .single();

        if (workspaceError || !newWorkspace) {
          alert('No se pudo crear el workspace inicial. Intenta de nuevo.');
          return;
        }

        const { error: memberError } = await supabase
          .from('workspace_members')
          .insert([{ workspace_id: newWorkspace.id, user_id: user.id, email: user.email, rol: 'owner', estado: 'activo' }]);

        if (memberError) {
          alert('No se pudo crear la membresía inicial del workspace. Intenta de nuevo.');
          return;
        }

        const createdWorkspace = { id: newWorkspace.id, nombre: newWorkspace.nombre, owner_id: newWorkspace.owner_id };
        setWorkspaces([createdWorkspace]);
        setWorkspaceActivo(newWorkspace.id);
        return;
      }

      setWorkspaces(workspacesData);
      setWorkspaceActivo(workspacesData[0].id);
    };

    loadWorkspaces();
  }, [user]);

  useEffect(() => {
    const loadData = async () => {
      if (!user || !workspaceActivo) return;

      try {
        const { data, error } = await supabase
          .from('registros_roas')
          .select('*')
          .eq('workspace_id', workspaceActivo);
        if (error) throw error;

        const registros = data.map((row: any) => {
          const fecha = new Date(row.fecha);
          const dia = fecha.getDate();
          const semana = getWeekNumber(fecha);
          const mes = fecha.getMonth() + 1;
          const ano = fecha.getFullYear();
          return {
            id: row.id.toString(),
            fecha,
            fechaInicio: row.fecha_inicio ? new Date(row.fecha_inicio) : fecha,
            fechaFin: row.fecha_fin ? new Date(row.fecha_fin) : fecha,
            periodoTipo: row.periodo_tipo || 'dia',
            empresa: row.empresa,
            empresaId: row.empresa_id,
            tipoResultado: row.tipo_resultado,
            gasto: row.gasto,
            resultados: row.resultados,
            ventas: row.ventas,
            ticketPromedio: row.ticket_promedio,
            canal: row.canal,
            campana: row.campana,
            notas: row.notas,
            workspaceId: row.workspace_id,
            userId: row.user_id,
            dia,
            semana,
            mes,
            ano,
            costoPorResultado: row.costo_por_resultado,
            facturacionEstimada: row.facturacion_estimada,
            roas: row.roas,
            ratioVenta: row.ratio_venta,
          };
        });
        setRegistros(registros);
      } catch (error) {
        console.error('Error loading data from Supabase:', error);
      }
    };

    loadData();
  }, [user, workspaceActivo]);

  useEffect(() => {
    if (!user || !workspaceActivo) return;

    const loadEmpresas = async () => {
      try {
        const { data, error } = await supabase
          .from('empresas')
          .select('id, nombre')
          .eq('workspace_id', workspaceActivo);
        if (error) throw error;
        setEmpresas(data || []);
      } catch (error) {
        console.error('Error loading empresas:', error);
      }
    };
    loadEmpresas();
  }, [user, workspaceActivo]);

  useEffect(() => {
    if (!user || !workspaceActivo) return;
    loadMiembros();
  }, [user, workspaceActivo]);

  async function handleCrearWorkspace() {
    if (!user) return;

    const nombrePropuesto = window.prompt('Ingresa el nombre del nuevo workspace');
    if (!nombrePropuesto?.trim()) {
      return;
    }

    const nombre = nombrePropuesto.trim();

    try {
      const { data: newWorkspace, error: workspaceError } = await supabase
        .from('workspaces')
        .insert([{ nombre, owner_id: user.id }])
        .select('id, nombre, owner_id')
        .single();

      if (workspaceError || !newWorkspace) {
        alert('No se pudo crear el workspace. Intenta de nuevo.');
        return;
      }

      const { error: memberError } = await supabase
        .from('workspace_members')
        .insert([{ workspace_id: newWorkspace.id, user_id: user.id, email: user.email, rol: 'owner', estado: 'activo' }]);

      if (memberError) {
        alert('No se pudo registrar al usuario en el nuevo workspace. Intenta de nuevo.');
        return;
      }

      const createdWorkspace = { id: newWorkspace.id, nombre: newWorkspace.nombre, owner_id: newWorkspace.owner_id };
      setWorkspaces((prev) => [...prev, createdWorkspace]);
      setWorkspaceActivo(createdWorkspace.id);
      setRegistros([]);
      setEmpresas([]);
      setMiembros([]);
      setFiltros(initialFiltros);
    } catch (error: any) {
      alert('No se pudo crear el workspace. Intenta de nuevo.');
    }
  }

  function translateAuthError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes("email rate limit exceeded")) {
      return "Por seguridad, espera unos minutos antes de volver a intentarlo.";
    }
    if (lower.includes("for security purposes")) {
      return "Por seguridad, espera unos segundos antes de intentarlo nuevamente.";
    }
    if (lower.includes("invalid login credentials")) {
      return "El correo o la contraseña no son correctos.";
    }
    if (lower.includes("user already registered")) {
      return "Este correo ya está registrado. Prueba iniciar sesión.";
    }
    if (lower.includes("password should be at least")) {
      return "La contraseña debe tener al menos 6 caracteres.";
    }
    if (lower.includes("email not confirmed")) {
      return "Tu correo aún no ha sido confirmado.";
    }
    if (lower.includes("blocked") || lower.includes("rate limit") || lower.includes("temporarily") || lower.includes("too many requests")) {
      return "Por seguridad, espera unos minutos antes de volver a intentarlo.";
    }
    return "Ocurrió un error. Intenta de nuevo.";
  }

  async function handleAuthSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (authLoading) return;

    setAuthError("");
    setAuthMessage("");
    setAuthLoading(true);

    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });

        if (error) {
          const translated = translateAuthError(error.message || String(error));
          setAuthError(translated);
          return;
        }

        setAuthMessage("Inicio de sesión correcto. Cargando...");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
        });

        if (error) {
          const translated = translateAuthError(error.message || String(error));
          if (translated === "Este correo ya está registrado. Prueba iniciar sesión.") {
            setAuthMode("login");
            setAuthError("Este correo ya está registrado. Ingresa tu contraseña para iniciar sesión.");
          } else {
            setAuthError(translated);
          }
          return;
        }

        setAuthMessage("Cuenta creada correctamente. Iniciando sesión...");

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });

        if (signInError) {
          const translated = translateAuthError(signInError.message || String(signInError));
          setAuthError(translated);
          return;
        }
      }
    } catch (error: any) {
      const translated = translateAuthError(error?.message || String(error));
      setAuthError(translated);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setWorkspaces([]);
      setWorkspaceActivo("");
    } catch (error) {
      console.error('Error cerrando sesión:', error);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!user) {
      alert("Debes estar autenticado para registrar una acción");
      return;
    }

    let activeWorkspaceId = workspaceActivo || (workspaces.length > 0 ? workspaces[0].id : "");

    if (!activeWorkspaceId) {
      alert("No hay workspace disponible. Por favor intenta recargando la página.");
      return;
    }

    let fecha: Date;
    let fechaInicio: Date;
    let fechaFin: Date;

    if (form.periodoTipo === "dia") {
      const fechaString = form.fecha ? form.fecha : formatDateLocal(new Date());
      fecha = new Date(`${fechaString}T00:00:00`);
      fechaInicio = fecha;
      fechaFin = new Date(`${fechaString}T23:59:59`);
    } else {
      if (!form.fechaInicio || !form.fechaFin) {
        alert("Se requieren fechas de inicio y fin para este período");
        return;
      }
      fechaInicio = new Date(`${form.fechaInicio}T00:00:00`);
      fechaFin = new Date(`${form.fechaFin}T23:59:59`);
      fecha = fechaInicio;
    }

    const gasto = Number(form.gasto) || 0;
    const resultados = Number(form.resultados) || 0;
    const ventas = Number(form.ventas) || 0;
    const ticketPromedio = Number(form.ticketPromedio) || 0;

    const facturacionEstimada = ventas * ticketPromedio;
    const costoPorResultado = resultados > 0 ? gasto / resultados : 0;
    const roas = gasto > 0 ? facturacionEstimada / gasto : 0;
    const ratioVenta = resultados > 0 ? ventas / resultados : 0;

    const empresaSeleccionada = empresas.find(e => e.nombre === form.empresa);
    if (!empresaSeleccionada) {
      alert("Selecciona una empresa válida");
      return;
    }

    const registroSolapado = registros.find(
      (r) =>
        r.empresaId === empresaSeleccionada.id &&
        fechaInicio <= r.fechaFin &&
        fechaFin >= r.fechaInicio
    );

    if (registroSolapado && gasto > 0 && registroSolapado.gasto > 0) {
      const inicioExistente = registroSolapado.fechaInicio.toLocaleDateString();
      const finExistente = registroSolapado.fechaFin.toLocaleDateString();
      const continuar = window.confirm(
        `Ya existe un registro para ${empresaSeleccionada.nombre} que cubre estas fechas (del ${inicioExistente} al ${finExistente}). Si continuas, los KPIs del dashboard pueden duplicarse para ese periodo. ¿Deseas registrar de todas formas?`
      );
      if (!continuar) return;
    }

    const nuevoRegistro: Registro = {
      id: Date.now().toString(),
      fecha,
      fechaInicio,
      fechaFin,
      periodoTipo: form.periodoTipo,
      empresa: empresaSeleccionada.nombre,
      empresaId: empresaSeleccionada.id,
      workspaceId: activeWorkspaceId,
      userId: user.id,
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

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('registros_roas')
        .insert([
          {
            fecha: formatDateLocal(nuevoRegistro.fecha),
            fecha_inicio: formatDateLocal(nuevoRegistro.fechaInicio),
            fecha_fin: formatDateLocal(nuevoRegistro.fechaFin),
            periodo_tipo: nuevoRegistro.periodoTipo,
            empresa: nuevoRegistro.empresa,
            empresa_id: nuevoRegistro.empresaId,
            tipo_resultado: nuevoRegistro.tipoResultado,
            gasto: nuevoRegistro.gasto,
            resultados: nuevoRegistro.resultados,
            ventas: nuevoRegistro.ventas,
            ticket_promedio: nuevoRegistro.ticketPromedio,
            canal: nuevoRegistro.canal,
            campana: nuevoRegistro.campana,
            notas: nuevoRegistro.notas,
            facturacion_estimada: nuevoRegistro.facturacionEstimada,
            costo_por_resultado: nuevoRegistro.costoPorResultado,
            roas: nuevoRegistro.roas,
            ratio_venta: nuevoRegistro.ratioVenta,
            workspace_id: nuevoRegistro.workspaceId,
            user_id: nuevoRegistro.userId,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      // Convertir el registro devuelto al formato Registro
      const registroInsertado: Registro = {
        id: data.id.toString(),
        fecha: new Date(data.fecha),
        fechaInicio: data.fecha_inicio ? new Date(data.fecha_inicio) : new Date(data.fecha),
        fechaFin: data.fecha_fin ? new Date(data.fecha_fin) : new Date(data.fecha),
        periodoTipo: data.periodo_tipo || "dia",
        empresa: data.empresa,
        empresaId: data.empresa_id,
        tipoResultado: data.tipo_resultado,
        gasto: data.gasto,
        resultados: data.resultados,
        ventas: data.ventas,
        ticketPromedio: data.ticket_promedio,
        canal: data.canal,
        campana: data.campana,
        notas: data.notas,
        dia: new Date(data.fecha).getDate(),
        semana: getWeekNumber(new Date(data.fecha)),
        mes: new Date(data.fecha).getMonth() + 1,
        ano: new Date(data.fecha).getFullYear(),
        costoPorResultado: data.costo_por_resultado,
        facturacionEstimada: data.facturacion_estimada,
        roas: data.roas,
        ratioVenta: data.ratio_venta,
      };

      setRegistros((prev) => [registroInsertado, ...prev]);
    } catch (error) {
      console.error('Error insertando en Supabase:', error);
    } finally {
      setIsSaving(false);
    }

    setForm({
      periodoTipo: "dia",
      fecha: "",
      fechaInicio: "",
      fechaFin: "",
      empresa: "",
      empresaId: "",
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

  async function handleCrearEmpresa() {
    if (!nombreNuevaEmpresa.trim() || !workspaceActivo) {
      alert("Ingresa un nombre válido para la empresa");
      return;
    }

    try {
      const { data: nuevaEmpresa, error } = await supabase
        .from('empresas')
        .insert([{ nombre: nombreNuevaEmpresa.trim(), workspace_id: workspaceActivo }])
        .select('id, nombre')
        .single();

      if (error) throw error;

      setEmpresas((prev) => [...prev, nuevaEmpresa]);
      setForm({ ...form, empresa: nuevaEmpresa.nombre });
      setMostrandoNuevaEmpresa(false);
      setNombreNuevaEmpresa("");
      alert("Empresa creada correctamente");
    } catch (error: any) {
      alert(`Error al crear empresa: ${translateSupabaseError(error)}`);
    }
  }

  async function loadMiembros() {
    if (!workspaceActivo) return;

    try {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', workspaceActivo);
      if (error) throw error;
      setMiembros(data || []);
    } catch (error) {
      console.error('Error loading miembros:', error);
    }
  }

  async function handleInvitarMiembro(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!invitacionForm.email.trim() || !workspaceActivo || !user) {
      alert("Ingresa un email válido");
      return;
    }

    const emailNormalizado = invitacionForm.email.trim().toLowerCase();
    const yaInvitado = miembros.some(
      (m) => m.email?.trim().toLowerCase() === emailNormalizado
    );

    if (yaInvitado) {
      alert("Este email ya fue invitado a este workspace.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from('workspace_members')
        .insert([{
          workspace_id: workspaceActivo,
          email: emailNormalizado,
          rol: invitacionForm.rol,
          estado: "pendiente",
          invitado_por: user.id
        }])
        .select();

      if (error) throw error;

      setMiembros((prev) => [...prev, ...(data || [])]);
      setInvitacionForm({ email: "", rol: "viewer" });
      alert("Invitación enviada correctamente");
    } catch (error: any) {
      alert(`Error al enviar invitación: ${translateSupabaseError(error)}`);
    }
  }

  async function handleEliminarMiembro(miembroId: string, miembroEmail: string) {
    if (!workspaceActivo || !user) return;

    const confirm = window.confirm(
      "¿Seguro que deseas eliminar este miembro o invitación? Esta acción no se puede deshacer."
    );

    if (!confirm) return;

    try {
      const { error: deleteError } = await supabase
        .from('workspace_members')
        .delete()
        .eq('id', miembroId)
        .eq('workspace_id', workspaceActivo);

      if (deleteError) {
        alert('No se pudo eliminar el miembro. Intenta de nuevo.');
        return;
      }

      setMiembros((prev) => prev.filter((m) => m.id !== miembroId));
      alert('Miembro eliminado correctamente');
    } catch (error: any) {
      alert('No se pudo eliminar el miembro. Intenta de nuevo.');
    }
  }

  function formatDate(dateString: string): string {
    if (!dateString) return "-";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "Pendiente";
      return date.toLocaleDateString('es-ES');
    } catch {
      return "Pendiente";
    }
  }

  async function handleDeleteRegistro(registroId: string) {
    const confirmDelete = window.confirm(
      "¿Seguro que deseas eliminar este registro? Esta acción no se puede deshacer."
    );

    if (!confirmDelete) return;

    if (!workspaceActivo) {
      alert("No hay workspace activo para eliminar este registro.");
      return;
    }

    try {
      const { error, count } = await supabase
        .from('registros_roas')
        .delete({ count: 'exact' })
        .eq('id', registroId)
        .eq('workspace_id', workspaceActivo);

      if (error) throw error;

      if (!count || count === 0) {
        alert("No se pudo eliminar el registro. Verifica que tengas permisos.");
        return;
      }

      setRegistros((prev) => prev.filter((r) => r.id !== registroId));
      alert("Registro eliminado correctamente");
    } catch (error: any) {
      alert(`Error al eliminar: ${translateSupabaseError(error)}`);
    }
  }

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-[#f4f4f5] flex items-center justify-center px-6 text-[#111111]">
        <div className="rounded-3xl bg-white p-10 shadow-sm">
          <p className="text-sm font-semibold text-gray-700">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f4f4f5] flex items-center justify-center px-6 py-12 text-[#111111]">
        <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">Lima Retail</p>
            <h1 className="mt-3 text-3xl font-bold text-gray-950">Accede a tu Workspace</h1>
            <p className="mt-2 text-sm text-gray-600">
              Usa tu email y contraseña para iniciar sesión o crear tu cuenta.
            </p>
          </div>

          <div className="mb-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={authLoading}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
                setAuthMessage("");
              }}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold transition ${
                authMode === "login"
                  ? "bg-red-700 text-white"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-50"
              } ${authLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              disabled={authLoading}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
                setAuthMessage("");
              }}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold transition ${
                authMode === "register"
                  ? "bg-red-700 text-white"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-50"
              } ${authLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Registrarse
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="grid gap-4">
            <input
              required
              type="email"
              placeholder="Email"
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
            <input
              required
              type="password"
              placeholder="Contraseña"
              value={authForm.password}
              onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
            {authError && <p className="text-sm text-red-600">{authError}</p>}
            {!authError && authMessage && (
              <p className="text-sm text-green-600">{authMessage}</p>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold text-white transition ${
                authLoading ? "bg-red-400 cursor-not-allowed" : "bg-red-700 hover:bg-red-600"
              }`}
            >
              {authLoading ? "Procesando..." : authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
            {["Registro", "Filtros", "Dashboard", "Resumen", "Registros", "Equipo"].map((item) => (
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

              <div className="flex items-center gap-3">
                {workspaces.length > 0 ? (
                  <select
                    value={workspaceActivo}
                    onChange={(e) => setWorkspaceActivo(e.target.value)}
                    className="hidden rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-700 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 lg:inline-flex"
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.nombre}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  onClick={handleCrearWorkspace}
                  className="rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:border-red-600 hover:text-red-700"
                >
                  Nuevo workspace
                </button>
                <button
                  onClick={handleSignOut}
                  className="rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:border-red-600 hover:text-red-700"
                >
                  Cerrar sesión
                </button>
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold lg:hidden"
                >
                  Menú
                </button>
              </div>
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
                <div className="lg:col-span-3">
                  <select
                    required
                    value={form.empresa}
                    onChange={(e) => {
                      if (e.target.value === "crear_nueva") {
                        setMostrandoNuevaEmpresa(true);
                        setForm({ ...form, empresa: "" });
                      } else {
                        setForm({ ...form, empresa: e.target.value });
                        setMostrandoNuevaEmpresa(false);
                      }
                    }}
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  >
                    <option value="">Selecciona una empresa</option>
                    {empresas.map((empresa) => (
                      <option key={empresa.id} value={empresa.nombre}>
                        {empresa.nombre}
                      </option>
                    ))}
                    <option value="crear_nueva">+ Crear nueva empresa</option>
                  </select>

                  {mostrandoNuevaEmpresa && (
                    <div className="mt-4 flex gap-2">
                      <input
                        required
                        placeholder="Nombre de la nueva empresa"
                        value={nombreNuevaEmpresa}
                        onChange={(e) => setNombreNuevaEmpresa(e.target.value)}
                        className="flex-1 rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                      />
                      <button
                        type="button"
                        onClick={handleCrearEmpresa}
                        className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-600"
                      >
                        Crear
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMostrandoNuevaEmpresa(false);
                          setNombreNuevaEmpresa("");
                        }}
                        className="rounded-2xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>

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

                <div className="lg:col-span-3">
                  <select
                    value={form.periodoTipo}
                    onChange={(e) => setForm({ ...form, periodoTipo: e.target.value as any })}
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  >
                    <option value="dia">Día</option>
                    <option value="semana">Semana</option>
                    <option value="mes">Mes</option>
                    <option value="ano">Año</option>
                    <option value="rango">Rango personalizado</option>
                  </select>
                </div>

                {form.periodoTipo === "dia" && (
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                    className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  />
                )}

                {(form.periodoTipo === "semana" || form.periodoTipo === "mes" || form.periodoTipo === "ano" || form.periodoTipo === "rango") && (
                  <>
                    <input
                      type="date"
                      placeholder="Fecha inicio"
                      value={form.fechaInicio}
                      onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })}
                      className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                    />
                    <input
                      type="date"
                      placeholder="Fecha fin"
                      value={form.fechaFin}
                      onChange={(e) => setForm({ ...form, fechaFin: e.target.value })}
                      className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                    />
                  </>
                )}

                <textarea
                  placeholder="Nota opcional"
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  className="min-h-24 rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 lg:col-span-3"
                />

                <button
                  type="submit"
                  disabled={isSaving}
                  className={`rounded-2xl px-6 py-4 font-bold text-white shadow-lg shadow-red-100 transition lg:col-span-3 ${
                    isSaving ? "bg-red-400 cursor-not-allowed" : "bg-red-700 hover:bg-red-800"
                  }`}
                >
                  {isSaving ? "Guardando..." : "Registrar acción"}
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

                <select
                  value={filtros.empresa}
                  onChange={(e) => setFiltros({ ...filtros, empresa: e.target.value })}
                  className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                >
                  <option value="">Todas las empresas</option>
                  {empresas.map((empresa) => (
                    <option key={empresa.id} value={empresa.nombre}>
                      {empresa.nombre}
                    </option>
                  ))}
                </select>

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
                      <th className="px-4 py-3">Acción</th>
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
                        <td
                          className={`px-4 py-3 font-bold ${
                            registro.gasto === 0 && registro.facturacionEstimada > 0
                              ? "text-gray-400"
                              : getRoasColor(registro.roas)
                          }`}
                        >
                          {registro.gasto === 0 && registro.facturacionEstimada > 0
                            ? "—"
                            : registro.roas.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">{registro.notas || "-"}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleDeleteRegistro(registro.id)}
                            className="rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-200"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}

                    {registrosFiltrados.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-10 text-center text-gray-500">
                          Registra tu primera acción para empezar a calcular ROAS.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              id="equipo"
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                  Equipo
                </p>
                <h3 className="mt-2 text-2xl font-bold text-gray-950">
                  Gestiona los miembros de tu workspace
                </h3>
              </div>

              <div className="mb-6">
                <form onSubmit={handleInvitarMiembro} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <input
                    required
                    type="email"
                    placeholder="Email del compañero"
                    value={invitacionForm.email}
                    onChange={(e) => setInvitacionForm({ ...invitacionForm, email: e.target.value })}
                    className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  />

                  <select
                    required
                    value={invitacionForm.rol}
                    onChange={(e) => setInvitacionForm({ ...invitacionForm, rol: e.target.value as "admin" | "editor" | "viewer" })}
                    className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>

                  <button
                    type="submit"
                    className="rounded-2xl bg-red-700 px-6 py-3 font-bold text-white transition hover:bg-red-800"
                  >
                    Invitar compañero
                  </button>
                </form>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-700">
                    <tr>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Rol</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Invitado</th>
                      <th className="px-4 py-3">Acción</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-200">
                    {miembros.map((miembro) => (
                      <tr key={miembro.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold">{miembro.email}</td>
                        <td className="px-4 py-3 capitalize">{miembro.rol}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                            miembro.estado === 'activo'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {miembro.estado}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {formatDate(miembro.invitado_en)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleEliminarMiembro(miembro.id, miembro.email)}
                            className="rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-200"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}

                    {miembros.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                          No hay miembros invitados aún. Invita a tu primer compañero.
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