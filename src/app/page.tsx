"use client";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ListaPendientesModule } from "@/modules/lista-pendientes/components/lista-pendientes-module";
import type { PendingResponsibleOption } from "@/modules/lista-pendientes/types";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  initialFiltros,
  type Costo,
  type CostoRow,
  type Filtros,
  type Miembro,
  type RegistroRoasRow,
  type Registro,
  type Workspace,
  type WorkspaceMembershipRow,
} from "@/modules/control-roas/types";
import {
  formatDateLocal,
  formatMesCorto,
  formatMoney,
  getRoasColor,
  getWeekNumber,
  translateSupabaseError,
} from "@/modules/control-roas/utils";

const SUPERADMIN_EMAILS = new Set(["jorgeluis@limaretail.com", "diego@limaretail.com"]);

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

function isSuperadminEmail(email?: string | null) {
  return SUPERADMIN_EMAILS.has(normalizeEmail(email));
}

function getMemberDisplayName(email?: string | null) {
  const normalized = normalizeEmail(email);
  if (normalized.includes("diego")) return "Diego";
  if (normalized.includes("jorgeluis") || normalized.includes("jorge")) return "Jorge Luis";
  return email?.split("@")[0] || "Usuario";
}

function getDefaultMemberOrder(email?: string | null) {
  const normalized = normalizeEmail(email);
  if (normalized.includes("diego")) return 1;
  if (normalized.includes("jorgeluis") || normalized.includes("jorge")) return 2;
  return 99;
}

function getMemberOrder(miembro: Pick<Miembro, "email" | "orden">) {
  return miembro.orden ?? getDefaultMemberOrder(miembro.email);
}

export default function Home() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [mostrarFecha, setMostrarFecha] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [empresas, setEmpresas] = useState<Array<{ id: string; nombre: string }>>([]);
  const [empresaCostoSeleccionada, setEmpresaCostoSeleccionada] = useState("");
  const [formCosto, setFormCosto] = useState({
    inversionMeta: "",
    inversionGoogle: "",
    costoIas: "",
    costoManychat: "",
    costoDiseno: "",
    otrosVariables: "",
    otrosFijos: "",
    leadsCotizaciones: "",
    leadsGenerados: "",
    ventasCerradas: "",
    ingresoGenerado: "",
  });
  const [isSavingCosto, setIsSavingCosto] = useState(false);
  const [costos, setCostos] = useState<Costo[]>([]);
  const [periodoCosto, setPeriodoCosto] = useState<"dia" | "semana" | "mes">("mes");
  const [fechaInicioCosto, setFechaInicioCosto] = useState(() => {
    const now = new Date();
    return formatDateLocal(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [fechaFinCosto, setFechaFinCosto] = useState(() => {
    const now = new Date();
    return formatDateLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  });
  const [mostrandoNuevaEmpresaCosto, setMostrandoNuevaEmpresaCosto] = useState(false);
  const [nombreNuevaEmpresaCosto, setNombreNuevaEmpresaCosto] = useState("");
  const [mostrandoNuevaEmpresa, setMostrandoNuevaEmpresa] = useState(false);
  const [nombreNuevaEmpresa, setNombreNuevaEmpresa] = useState("");
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [invitacionForm, setInvitacionForm] = useState({ email: "", rol: "viewer" as Miembro["rol"] });
  const [seccionActiva, setSeccionActiva] = useState("dashboard");
  const [user, setUser] = useState<User | null>(null);
  const isSuperadmin = isSuperadminEmail(user?.email);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceActivo, setWorkspaceActivo] = useState("");
  const responsablesPendientes = useMemo<PendingResponsibleOption[]>(
    () =>
      miembros
        .filter((miembro) => miembro.email)
        .map((miembro) => ({
          email: miembro.email,
          nombre: getMemberDisplayName(miembro.email),
          orden: getMemberOrder(miembro)
        }))
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)),
    [miembros]
  );

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
    } catch (error: unknown) {
      alert(`Error al activar invitaciones: ${translateSupabaseError(error)}`);
      return [];
    }
  }

  async function syncSuperadminMemberships() {
    if (!user || !isSuperadmin) return;

    try {
      const { error } = await supabase
        .from('workspace_members')
        .update({ rol: 'superadmin', estado: 'activo' })
        .in('email', Array.from(SUPERADMIN_EMAILS));

      if (error) {
        console.warn('No se pudieron sincronizar los permisos superadmin:', error);
      }
    } catch (error) {
      console.warn('No se pudieron sincronizar los permisos superadmin:', error);
    }
  }

  useEffect(() => {
    const loadWorkspaces = async () => {
      if (!user) return;

      await acceptPendingInvitations();
      await syncSuperadminMemberships();

      const loadAllWorkspaces = async () => {
        const { data: allWorkspaces, error: allWorkspacesError } = await supabase
          .from('workspaces')
          .select('id, nombre, owner_id')
          .order('nombre', { ascending: true });

        if (allWorkspacesError) return null;
        return allWorkspaces || [];
      };

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
          .map((row: WorkspaceMembershipRow) => row.workspace_id)
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

      let workspacesData = isSuperadmin ? await loadAllWorkspaces() : await loadByMembership();
      if (workspacesData === null && isSuperadmin) {
        workspacesData = await loadByMembership();
      }
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
          .insert([{ workspace_id: newWorkspace.id, user_id: user.id, email: user.email, rol: isSuperadmin ? 'superadmin' : 'owner', estado: 'activo' }]);

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
  }, [user, isSuperadmin]);

  useEffect(() => {
    const loadData = async () => {
      if (!user || !workspaceActivo) return;

      try {
        const { data, error } = await supabase
          .from('registros_roas')
          .select('*')
          .eq('workspace_id', workspaceActivo);
        if (error) throw error;

        const registros = data.map((row: RegistroRoasRow) => {
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

    const loadCostos = async () => {
      try {
        const { data, error } = await supabase
          .from('costos')
          .select('*')
          .eq('workspace_id', workspaceActivo);
        if (error) throw error;
        const costos: Costo[] = (data || []).map((row: CostoRow) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          empresaId: row.empresa_id,
          periodoTipo: row.periodo_tipo,
          fechaInicio: row.fecha_inicio,
          fechaFin: row.fecha_fin,
          inversionMeta: Number(row.inversion_meta) || 0,
          inversionGoogle: Number(row.inversion_google) || 0,
          costoIas: Number(row.costo_ias) || 0,
          costoManychat: Number(row.costo_manychat) || 0,
          costoDiseno: Number(row.costo_diseno) || 0,
          otrosVariables: Number(row.otros_variables) || 0,
          otrosFijos: Number(row.otros_fijos) || 0,
          leadsCotizaciones: Number(row.leads_cotizaciones) || 0,
          leadsGenerados: Number(row.leads_generados) || 0,
          ventasCerradas: Number(row.ventas_cerradas) || 0,
          ingresoGenerado: Number(row.ingreso_generado) || 0,
        }));
        setCostos(costos);
      } catch (error) {
        console.error('Error loading costos:', error);
      }
    };
    loadCostos();
  }, [user, workspaceActivo]);

  useEffect(() => {
    if (!user || !workspaceActivo) return;
    loadMiembros();
  }, [user, workspaceActivo, isSuperadmin]);

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
        .insert([{ workspace_id: newWorkspace.id, user_id: user.id, email: user.email, rol: isSuperadmin ? 'superadmin' : 'owner', estado: 'activo' }]);

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
    } catch {
      alert('No se pudo crear el workspace. Intenta de nuevo.');
    }
  }

  async function handleGuardarCosto(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!empresaCostoSeleccionada) {
      alert("Selecciona una empresa");
      return;
    }

    if (!workspaceActivo) {
      alert("No hay workspace activo");
      return;
    }

    setIsSavingCosto(true);

    try {
      const payload = {
        workspace_id: workspaceActivo,
        empresa_id: empresaCostoSeleccionada,
        periodo_tipo: periodoCosto,
        fecha_inicio: fechaInicioCosto,
        fecha_fin: fechaFinCosto,
        inversion_meta: Number(formCosto.inversionMeta) || 0,
        inversion_google: Number(formCosto.inversionGoogle) || 0,
        costo_ias: Number(formCosto.costoIas) || 0,
        costo_manychat: Number(formCosto.costoManychat) || 0,
        costo_diseno: Number(formCosto.costoDiseno) || 0,
        otros_variables: Number(formCosto.otrosVariables) || 0,
        otros_fijos: Number(formCosto.otrosFijos) || 0,
        leads_cotizaciones: Number(formCosto.leadsCotizaciones) || 0,
        leads_generados: Number(formCosto.leadsGenerados) || 0,
        ventas_cerradas: Number(formCosto.ventasCerradas) || 0,
        ingreso_generado: Number(formCosto.ingresoGenerado) || 0,
      };

      const { data, error } = await supabase
        .from('costos')
        .upsert(payload, { onConflict: 'workspace_id,empresa_id,periodo_tipo,fecha_inicio,fecha_fin' })
        .select()
        .single();

      if (error) {
        alert(translateSupabaseError(error));
        return;
      }

      if (data) {
        const nuevo: Costo = {
          id: data.id,
          workspaceId: data.workspace_id,
          empresaId: data.empresa_id,
          periodoTipo: data.periodo_tipo,
          fechaInicio: data.fecha_inicio,
          fechaFin: data.fecha_fin,
          inversionMeta: Number(data.inversion_meta) || 0,
          inversionGoogle: Number(data.inversion_google) || 0,
          costoIas: Number(data.costo_ias) || 0,
          costoManychat: Number(data.costo_manychat) || 0,
          costoDiseno: Number(data.costo_diseno) || 0,
          otrosVariables: Number(data.otros_variables) || 0,
          otrosFijos: Number(data.otros_fijos) || 0,
          leadsCotizaciones: Number(data.leads_cotizaciones) || 0,
          leadsGenerados: Number(data.leads_generados) || 0,
          ventasCerradas: Number(data.ventas_cerradas) || 0,
          ingresoGenerado: Number(data.ingreso_generado) || 0,
        };

        setCostos((prev) => {
          const idx = prev.findIndex(
            (c) =>
              c.workspaceId === nuevo.workspaceId &&
              c.empresaId === nuevo.empresaId &&
              c.periodoTipo === nuevo.periodoTipo &&
              c.fechaInicio === nuevo.fechaInicio &&
              c.fechaFin === nuevo.fechaFin,
          );
          if (idx >= 0) {
            const copia = [...prev];
            copia[idx] = nuevo;
            return copia;
          }
          return [...prev, nuevo];
        });
      }

      setFormCosto({
        inversionMeta: "",
        inversionGoogle: "",
        costoIas: "",
        costoManychat: "",
        costoDiseno: "",
        otrosVariables: "",
        otrosFijos: "",
        leadsCotizaciones: "",
        leadsGenerados: "",
        ventasCerradas: "",
        ingresoGenerado: "",
      });

      alert("Costos guardados correctamente");
    } catch (error: unknown) {
      alert(translateSupabaseError(error));
    } finally {
      setIsSavingCosto(false);
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
    } catch (error: unknown) {
      const translated = translateAuthError(error instanceof Error ? error.message : String(error));
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

    const activeWorkspaceId = workspaceActivo || (workspaces.length > 0 ? workspaces[0].id : "");

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
    const sumaInversionPublicidad = costos.reduce(
      (sum, c) => sum + c.inversionMeta + c.inversionGoogle,
      0
    );
    const totalGasto = costos.reduce(
      (sum, c) =>
        sum +
        c.inversionMeta +
        c.inversionGoogle +
        c.costoIas +
        c.costoManychat +
        c.costoDiseno +
        c.otrosVariables +
        c.otrosFijos,
      0
    );
    const totalFacturacion = costos.reduce((sum, c) => sum + c.ingresoGenerado, 0);
    const totalLeadsGenerados = costos.reduce((sum, c) => sum + c.leadsGenerados, 0);
    const totalVentasCerradas = costos.reduce((sum, c) => sum + c.ventasCerradas, 0);
    const totalLeadsCotizaciones = costos.reduce((sum, c) => sum + c.leadsCotizaciones, 0);

    return {
      totalGasto,
      totalFacturacion,
      totalLeadsGenerados,
      roas: sumaInversionPublicidad > 0 ? totalFacturacion / sumaInversionPublicidad : null,
      roi: totalGasto > 0 ? ((totalFacturacion - totalGasto) / totalGasto) * 100 : null,
      costoPorLead: totalLeadsGenerados > 0 ? sumaInversionPublicidad / totalLeadsGenerados : null,
      costoPorVenta: totalVentasCerradas > 0 ? sumaInversionPublicidad / totalVentasCerradas : null,
      costoPorCotizacion: totalLeadsCotizaciones > 0 ? sumaInversionPublicidad / totalLeadsCotizaciones : null,
      registros: costos.length,
    };
  }, [costos]);

  function getEmpresaNombre(empresaId: string | null): string {
    if (!empresaId) return "-";
    return empresas.find((e) => e.id === empresaId)?.nombre ?? "-";
  }

  const costosOrdenados = useMemo(
    () => [...costos].sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio)),
    [costos],
  );

  const evolucionMensual = useMemo(() => {
    const map = new Map<string, { gastoTotal: number; facturacion: number; inversionPub: number }>();
    for (const c of costos) {
      const mesKey = c.fechaInicio.slice(0, 7);
      const prev = map.get(mesKey) ?? { gastoTotal: 0, facturacion: 0, inversionPub: 0 };
      prev.gastoTotal +=
        c.inversionMeta +
        c.inversionGoogle +
        c.costoIas +
        c.costoManychat +
        c.costoDiseno +
        c.otrosVariables +
        c.otrosFijos;
      prev.facturacion += c.ingresoGenerado;
      prev.inversionPub += c.inversionMeta + c.inversionGoogle;
      map.set(mesKey, prev);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mesKey, agg]) => ({
        mes: formatMesCorto(mesKey),
        gastoTotal: agg.gastoTotal,
        facturacion: agg.facturacion,
        roas: agg.inversionPub > 0 ? Number((agg.facturacion / agg.inversionPub).toFixed(2)) : null,
        roi: agg.gastoTotal > 0 ? Number((((agg.facturacion - agg.gastoTotal) / agg.gastoTotal) * 100).toFixed(1)) : null,
      }));
  }, [costos]);

  const resumenConsolidado = useMemo(() => {
    type Agg = {
      leadsGenerados: number; leadsCotizaciones: number; ventasCerradas: number; ingreso: number;
      invMeta: number; invGoogle: number; costoDiseno: number; otrosVariables: number;
      costoIas: number; costoManychat: number; otrosFijos: number;
    };
    const empty = (): Agg => ({
      leadsGenerados: 0, leadsCotizaciones: 0, ventasCerradas: 0, ingreso: 0,
      invMeta: 0, invGoogle: 0, costoDiseno: 0, otrosVariables: 0,
      costoIas: 0, costoManychat: 0, otrosFijos: 0,
    });
    const map = new Map<string, Agg>();
    for (const c of costos) {
      const mesKey = c.fechaInicio.slice(0, 7);
      const prev = map.get(mesKey) ?? empty();
      prev.leadsGenerados += c.leadsGenerados;
      prev.leadsCotizaciones += c.leadsCotizaciones;
      prev.ventasCerradas += c.ventasCerradas;
      prev.ingreso += c.ingresoGenerado;
      prev.invMeta += c.inversionMeta;
      prev.invGoogle += c.inversionGoogle;
      prev.costoDiseno += c.costoDiseno;
      prev.otrosVariables += c.otrosVariables;
      prev.costoIas += c.costoIas;
      prev.costoManychat += c.costoManychat;
      prev.otrosFijos += c.otrosFijos;
      map.set(mesKey, prev);
    }
    const total = empty();
    for (const agg of map.values()) {
      total.leadsGenerados += agg.leadsGenerados;
      total.leadsCotizaciones += agg.leadsCotizaciones;
      total.ventasCerradas += agg.ventasCerradas;
      total.ingreso += agg.ingreso;
      total.invMeta += agg.invMeta;
      total.invGoogle += agg.invGoogle;
      total.costoDiseno += agg.costoDiseno;
      total.otrosVariables += agg.otrosVariables;
      total.costoIas += agg.costoIas;
      total.costoManychat += agg.costoManychat;
      total.otrosFijos += agg.otrosFijos;
    }
    const meses = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mesKey, agg]) => ({ mesKey, label: formatMesCorto(mesKey), agg }));
    return { meses, total };
  }, [costos]);

  type ResumenAgg = {
    leadsGenerados: number; leadsCotizaciones: number; ventasCerradas: number; ingreso: number;
    invMeta: number; invGoogle: number; costoDiseno: number; otrosVariables: number;
    costoIas: number; costoManychat: number; otrosFijos: number;
  };
  function getValorResumen(agg: ResumenAgg, key: string): string {
    const metaGoogle = agg.invMeta + agg.invGoogle;
    const gastoTotal = metaGoogle + agg.costoDiseno + agg.otrosVariables + agg.costoIas + agg.costoManychat + agg.otrosFijos;
    switch (key) {
      case "leadsGenerados":    return agg.leadsGenerados.toString();
      case "leadsCotizaciones": return agg.leadsCotizaciones.toString();
      case "ventasCerradas":    return agg.ventasCerradas.toString();
      case "ingreso":           return formatMoney(agg.ingreso);
      case "invMeta":           return formatMoney(agg.invMeta);
      case "invGoogle":         return formatMoney(agg.invGoogle);
      case "costoDiseno":       return formatMoney(agg.costoDiseno);
      case "otrosVariables":    return formatMoney(agg.otrosVariables);
      case "costoIas":          return formatMoney(agg.costoIas);
      case "costoManychat":     return formatMoney(agg.costoManychat);
      case "otrosFijos":        return formatMoney(agg.otrosFijos);
      case "cacPorLead":  return agg.leadsGenerados > 0 ? formatMoney(metaGoogle / agg.leadsGenerados) : "-";
      case "cacPorVenta": return agg.ventasCerradas > 0 ? formatMoney(metaGoogle / agg.ventasCerradas) : "-";
      case "roasPub":     return metaGoogle > 0 ? (agg.ingreso / metaGoogle).toFixed(2) : "-";
      case "roiTotal":    return gastoTotal > 0 ? `${(((agg.ingreso - gastoTotal) / gastoTotal) * 100).toFixed(1)}%` : "-";
      default: return "";
    }
  }

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
    } catch (error: unknown) {
      alert(`Error al crear empresa: ${translateSupabaseError(error)}`);
    }
  }

  async function handleCrearEmpresaCosto() {
    if (!nombreNuevaEmpresaCosto.trim() || !workspaceActivo) {
      alert("Ingresa un nombre válido para la empresa");
      return;
    }

    try {
      const { data: nuevaEmpresa, error } = await supabase
        .from('empresas')
        .insert([{ nombre: nombreNuevaEmpresaCosto.trim(), workspace_id: workspaceActivo }])
        .select('id, nombre')
        .single();

      if (error) throw error;

      setEmpresas((prev) => [...prev, nuevaEmpresa]);
      setEmpresaCostoSeleccionada(nuevaEmpresa.id);
      setMostrandoNuevaEmpresaCosto(false);
      setNombreNuevaEmpresaCosto("");
    } catch (error: unknown) {
      alert(translateSupabaseError(error));
    }
  }

  async function handleEliminarCosto(costoId: string) {
    if (!window.confirm("¿Eliminar este registro? Esta accion no se puede deshacer.")) return;
    try {
      const { error } = await supabase.from('costos').delete().eq('id', costoId);
      if (error) throw error;
      setCostos((prev) => prev.filter((c) => c.id !== costoId));
    } catch (error: unknown) {
      alert(translateSupabaseError(error));
    }
  }

  async function loadMiembros() {
    if (!workspaceActivo) return;

    try {
      const query = supabase
        .from('workspace_members')
        .select('*')
        .order('email', { ascending: true });
      const { data, error } = await (isSuperadmin ? query : query.eq('workspace_id', workspaceActivo));
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
      (m) => m.workspace_id === workspaceActivo && m.email?.trim().toLowerCase() === emailNormalizado
    );

    if (yaInvitado) {
      alert("Este email ya fue invitado a este workspace.");
      return;
    }

    const rolInvitado = isSuperadminEmail(emailNormalizado) ? "superadmin" : invitacionForm.rol;

    try {
      const { data, error } = await supabase
        .from('workspace_members')
        .insert([{
          workspace_id: workspaceActivo,
          email: emailNormalizado,
          rol: rolInvitado,
          estado: "pendiente",
          invitado_por: user.id
        }])
        .select();

      if (error) throw error;

      setMiembros((prev) => [...prev, ...(data || [])]);
      setInvitacionForm({ email: "", rol: "viewer" });
      alert("Invitación enviada correctamente");
    } catch (error: unknown) {
      alert(`Error al enviar invitación: ${translateSupabaseError(error)}`);
    }
  }

  async function handleActualizarOrdenMiembro(miembro: Miembro, orden: number) {
    const nextOrden = Number.isFinite(orden) && orden > 0 ? Math.trunc(orden) : null;
    setMiembros((prev) =>
      prev.map((item) => (item.id === miembro.id ? { ...item, orden: nextOrden } : item))
    );

    try {
      const targetWorkspaceId = isSuperadmin ? miembro.workspace_id : workspaceActivo;
      const { error } = await supabase
        .from('workspace_members')
        .update({ orden: nextOrden })
        .eq('id', miembro.id)
        .eq('workspace_id', targetWorkspaceId);

      if (error) throw error;
    } catch (error: unknown) {
      alert(`No se pudo actualizar el orden: ${translateSupabaseError(error)}`);
      loadMiembros();
    }
  }

  async function handleEliminarMiembro(miembroId: string, miembroEmail: string, miembroWorkspaceId: string) {
    if (!workspaceActivo || !user) return;

    const confirm = window.confirm(
      "¿Seguro que deseas eliminar este miembro o invitación? Esta acción no se puede deshacer."
    );

    if (!confirm) return;

    try {
      const targetWorkspaceId = isSuperadmin ? miembroWorkspaceId : workspaceActivo;
      const { error: deleteError } = await supabase
        .from('workspace_members')
        .delete()
        .eq('id', miembroId)
        .eq('workspace_id', targetWorkspaceId);

      if (deleteError) {
        alert('No se pudo eliminar el miembro. Intenta de nuevo.');
        return;
      }

      setMiembros((prev) => prev.filter((m) => m.id !== miembroId));
      alert('Miembro eliminado correctamente');
    } catch {
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
    } catch (error: unknown) {
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

  const seccionFinanciero = (
    <section
      id="registro"
      className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
          Registrar accion
        </p>
        <h3 className="mt-2 text-2xl font-bold text-gray-950">
          Ingresa solo lo esencial
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          Registra resultados y costos por dia, semana o mes. CAC, ROAS y ROI se calculan automaticamente.
        </p>
      </div>

      <form
        onSubmit={handleGuardarCosto}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        <div className="lg:col-span-3">
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Empresa
          </label>
          <select
            required
            value={empresaCostoSeleccionada}
            onChange={(e) => {
              const valor = e.target.value;
              if (valor === "__crear_nueva__") {
                setMostrandoNuevaEmpresaCosto(true);
                setEmpresaCostoSeleccionada("");
              } else {
                setEmpresaCostoSeleccionada(valor);
              }
            }}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          >
            <option value="">Selecciona una empresa</option>
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>
                {empresa.nombre}
              </option>
            ))}
            <option value="__crear_nueva__">+ Crear nueva empresa</option>
          </select>
          {mostrandoNuevaEmpresaCosto && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={nombreNuevaEmpresaCosto}
                onChange={(e) => setNombreNuevaEmpresaCosto(e.target.value)}
                placeholder="Nombre de la nueva empresa"
                className="flex-1 rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
              />
              <button
                type="button"
                onClick={handleCrearEmpresaCosto}
                className="rounded-2xl bg-red-700 px-4 py-3 font-bold text-white transition hover:bg-red-800"
              >
                Crear
              </button>
              <button
                type="button"
                onClick={() => {
                  setMostrandoNuevaEmpresaCosto(false);
                  setNombreNuevaEmpresaCosto("");
                }}
                className="rounded-2xl bg-gray-200 px-4 py-3 font-bold text-gray-700 transition hover:bg-gray-300"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Periodo
          </label>
          <select
            value={periodoCosto}
            onChange={(e) => {
              const nuevoPeriodo = e.target.value as "dia" | "semana" | "mes";
              setPeriodoCosto(nuevoPeriodo);
              if (nuevoPeriodo === "mes") {
                const now = new Date();
                setFechaInicioCosto(formatDateLocal(new Date(now.getFullYear(), now.getMonth(), 1)));
                setFechaFinCosto(formatDateLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
              }
            }}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          >
            <option value="dia">Dia</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </select>
        </div>

        {periodoCosto === "dia" && (
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
              Fecha
            </label>
            <input
              type="date"
              value={fechaInicioCosto}
              onChange={(e) => {
                setFechaInicioCosto(e.target.value);
                setFechaFinCosto(e.target.value);
              }}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
          </div>
        )}

        {periodoCosto === "semana" && (
          <>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
                Fecha inicio
              </label>
              <input
                type="date"
                value={fechaInicioCosto}
                onChange={(e) => setFechaInicioCosto(e.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
                Fecha fin
              </label>
              <input
                type="date"
                value={fechaFinCosto}
                onChange={(e) => setFechaFinCosto(e.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
              />
            </div>
          </>
        )}

        {periodoCosto === "mes" && (() => {
          const [anioStr, mesStr] = fechaInicioCosto.split("-");
          const anioActual = Number(anioStr) || new Date().getFullYear();
          const mesActual = Number(mesStr) || 1;
          return (
            <>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
                  Año
                </label>
                <select
                  value={anioActual}
                  onChange={(e) => {
                    const nuevoAnio = Number(e.target.value);
                    setFechaInicioCosto(formatDateLocal(new Date(nuevoAnio, mesActual - 1, 1)));
                    setFechaFinCosto(formatDateLocal(new Date(nuevoAnio, mesActual, 0)));
                  }}
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                >
                  {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
                  Mes
                </label>
                <select
                  value={mesActual}
                  onChange={(e) => {
                    const nuevoMes = Number(e.target.value);
                    setFechaInicioCosto(formatDateLocal(new Date(anioActual, nuevoMes - 1, 1)));
                    setFechaFinCosto(formatDateLocal(new Date(anioActual, nuevoMes, 0)));
                  }}
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                >
                  {[
                    [1, "Enero"], [2, "Febrero"], [3, "Marzo"], [4, "Abril"],
                    [5, "Mayo"], [6, "Junio"], [7, "Julio"], [8, "Agosto"],
                    [9, "Septiembre"], [10, "Octubre"], [11, "Noviembre"], [12, "Diciembre"],
                  ].map(([num, nombre]) => (
                    <option key={num as number} value={num as number}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </div>
            </>
          );
        })()}

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Leads generados
          </label>
          <input
            type="number"
            step="1"
            min="0"
            value={formCosto.leadsGenerados}
            onChange={(e) => setFormCosto({ ...formCosto, leadsGenerados: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Ventas cerradas
          </label>
          <input
            type="number"
            step="1"
            min="0"
            value={formCosto.ventasCerradas}
            onChange={(e) => setFormCosto({ ...formCosto, ventasCerradas: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Ingreso generado (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.ingresoGenerado}
            onChange={(e) => setFormCosto({ ...formCosto, ingresoGenerado: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Inversion Meta Ads (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.inversionMeta}
            onChange={(e) => setFormCosto({ ...formCosto, inversionMeta: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Inversion Google Ads (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.inversionGoogle}
            onChange={(e) => setFormCosto({ ...formCosto, inversionGoogle: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            IAs - Claude, GPT, etc. (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.costoIas}
            onChange={(e) => setFormCosto({ ...formCosto, costoIas: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            ManyChat (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.costoManychat}
            onChange={(e) => setFormCosto({ ...formCosto, costoManychat: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Diseño (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.costoDiseno}
            onChange={(e) => setFormCosto({ ...formCosto, costoDiseno: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Otros costos variables (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.otrosVariables}
            onChange={(e) => setFormCosto({ ...formCosto, otrosVariables: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Otros costos fijos (S/.)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formCosto.otrosFijos}
            onChange={(e) => setFormCosto({ ...formCosto, otrosFijos: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
            Leads cotizaciones
          </label>
          <input
            type="number"
            step="1"
            min="0"
            value={formCosto.leadsCotizaciones}
            onChange={(e) => setFormCosto({ ...formCosto, leadsCotizaciones: e.target.value })}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </div>

        <button
          type="submit"
          disabled={isSavingCosto}
          className={`rounded-2xl px-6 py-4 font-bold text-white shadow-lg shadow-red-100 transition lg:col-span-3 ${
            isSavingCosto ? "bg-red-400 cursor-not-allowed" : "bg-red-700 hover:bg-red-800"
          }`}
        >
          {isSavingCosto ? "Guardando..." : "Guardar registro"}
        </button>
      </form>
    </section>
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
            {["Registro", "Dashboard", "Pendientes", "Resumen", "Registros", "Equipo"].map((item) => {
              const id = item.toLowerCase();
              const activa = seccionActiva === id;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSeccionActiva(id)}
                  className={`block w-full rounded-2xl px-4 py-3 text-left transition ${
                    activa
                      ? "bg-red-700 font-bold text-white"
                      : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 max-w-[1280px] mx-auto w-full">
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

          <main className="mx-auto max-w-[1200px] space-y-8 p-6">
            {seccionActiva === "registro" && seccionFinanciero}

            {seccionActiva === "dashboard" && (
              <>
                <section id="dashboard" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Gasto total", formatMoney(dashboard.totalGasto), "text-red-700"],
                    ["Facturación", formatMoney(dashboard.totalFacturacion), "text-green-600"],
                    ["ROAS", dashboard.roas === null ? "-" : dashboard.roas.toFixed(2), dashboard.roas === null ? "text-gray-400" : getRoasColor(dashboard.roas)],
                    ["ROI", dashboard.roi === null ? "-" : `${dashboard.roi.toFixed(1)}%`, dashboard.roi === null ? "text-gray-400" : dashboard.roi >= 0 ? "text-green-600" : "text-red-700"],
                    ["Costo por lead", dashboard.costoPorLead === null ? "-" : formatMoney(dashboard.costoPorLead), dashboard.costoPorLead === null ? "text-gray-400" : "text-gray-950"],
                    ["Costo por venta", dashboard.costoPorVenta === null ? "-" : formatMoney(dashboard.costoPorVenta), dashboard.costoPorVenta === null ? "text-gray-400" : "text-gray-950"],
                    ["Costo por cotización", dashboard.costoPorCotizacion === null ? "-" : formatMoney(dashboard.costoPorCotizacion), dashboard.costoPorCotizacion === null ? "text-gray-400" : "text-gray-950"],
                    ["Total leads", dashboard.totalLeadsGenerados.toString(), "text-gray-950"],
                    ["Registros", dashboard.registros.toString(), "text-gray-950"],
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
                      Evolución mensual
                    </h3>
                    <p className="mt-2 text-sm text-gray-600">
                      ROAS, ROI, gastos y facturación agrupados por mes.
                    </p>
                  </div>

                  {evolucionMensual.length === 0 ? (
                    <p className="py-10 text-center text-gray-500">
                      Aun no hay datos para graficar
                    </p>
                  ) : (
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="rounded-3xl border border-gray-200 bg-[#0f172a] p-4 text-white shadow-sm">
                        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-red-400">
                          Evolución de ROAS y ROI
                        </p>
                        <div className="h-[320px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={evolucionMensual} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
                              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                              <XAxis dataKey="mes" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                              <YAxis tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                              <Tooltip
                                contentStyle={{ backgroundColor: "#111827", borderColor: "#374151" }}
                                labelStyle={{ color: "#f8fafc" }}
                                formatter={(value, name) =>
                                  value == null ? "-" : name === "ROI (%)" ? `${Number(value).toFixed(1)}%` : Number(value).toFixed(2)
                                }
                              />
                              <Legend wrapperStyle={{ color: "#e2e8f0" }} />
                              <Line type="monotone" dataKey="roas" name="ROAS" stroke="#16a34a" strokeWidth={3} dot={{ r: 4, fill: "#22c55e" }} />
                              <Line type="monotone" dataKey="roi" name="ROI (%)" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: "#3b82f6" }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-gray-200 bg-[#0f172a] p-4 text-white shadow-sm">
                        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-red-400">
                          Evolución de Gastos y Facturación
                        </p>
                        <div className="h-[320px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={evolucionMensual} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
                              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                              <XAxis dataKey="mes" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                              <YAxis
                                tick={{ fill: "#cbd5e1", fontSize: 12 }}
                                tickFormatter={(v) => `S/ ${Number(v).toLocaleString()}`}
                              />
                              <Tooltip
                                contentStyle={{ backgroundColor: "#111827", borderColor: "#374151" }}
                                labelStyle={{ color: "#f8fafc" }}
                                formatter={(value) => (value == null ? "-" : formatMoney(Number(value)))}
                              />
                              <Legend wrapperStyle={{ color: "#e2e8f0" }} />
                              <Line type="monotone" dataKey="gastoTotal" name="Gasto total" stroke="#dc2626" strokeWidth={3} dot={{ r: 4, fill: "#ef4444" }} />
                              <Line type="monotone" dataKey="facturacion" name="Facturación" stroke="#16a34a" strokeWidth={3} dot={{ r: 4, fill: "#22c55e" }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}

            {seccionActiva === "pendientes" && (
              <ListaPendientesModule
                user={user}
                workspaceId={workspaceActivo}
                responsables={responsablesPendientes}
              />
            )}

            {seccionActiva === "resumen" && (
              <section
                id="resumen"
                className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-6">
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                    Resumen
                  </p>
                  <h3 className="mt-2 text-2xl font-bold text-gray-950">
                    Resumen consolidado por mes
                  </h3>
                </div>

                {resumenConsolidado.meses.length === 0 ? (
                  <p className="py-10 text-center text-gray-500">
                    Aun no hay datos para mostrar
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 text-gray-700">
                        <tr>
                          <th className="sticky left-0 z-10 bg-gray-100 px-4 py-3 text-left">Concepto</th>
                          {resumenConsolidado.meses.map((m) => (
                            <th key={m.mesKey} className="px-4 py-3 text-right">{m.label}</th>
                          ))}
                          <th className="px-4 py-3 text-right font-bold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { titulo: "INGRESOS", bg: "bg-blue-50", filas: [
                            { key: "leadsGenerados",    label: "Leads generados" },
                            { key: "leadsCotizaciones", label: "Leads cotizaciones" },
                            { key: "ventasCerradas",    label: "Ventas cerradas" },
                            { key: "ingreso",           label: "Ingreso" },
                          ]},
                          { titulo: "COSTOS VARIABLES", bg: "bg-orange-50", filas: [
                            { key: "invMeta",        label: "Inversion Meta" },
                            { key: "invGoogle",      label: "Inversion Google" },
                            { key: "costoDiseno",    label: "Diseño/Freelance" },
                            { key: "otrosVariables", label: "Otros variables" },
                          ]},
                          { titulo: "COSTOS FIJOS", bg: "bg-yellow-50", filas: [
                            { key: "costoIas",      label: "IAs" },
                            { key: "costoManychat", label: "ManyChat" },
                            { key: "otrosFijos",    label: "Otros fijos" },
                          ]},
                          { titulo: "RESULTADO", bg: "bg-green-50", filas: [
                            { key: "cacPorLead",  label: "CAC por lead" },
                            { key: "cacPorVenta", label: "CAC por venta" },
                            { key: "roasPub",     label: "ROAS publicidad" },
                            { key: "roiTotal",    label: "ROI total" },
                          ]},
                        ].flatMap((grupo) => [
                          <tr key={`g-${grupo.titulo}`} className={grupo.bg}>
                            <td
                              colSpan={resumenConsolidado.meses.length + 2}
                              className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-700"
                            >
                              {grupo.titulo}
                            </td>
                          </tr>,
                          ...grupo.filas.map((fila) => (
                            <tr key={`${grupo.titulo}-${fila.key}`} className="group border-b border-gray-100 hover:bg-gray-50">
                              <td className="sticky left-0 z-10 bg-white px-4 py-3 font-medium group-hover:bg-gray-50">
                                {fila.label}
                              </td>
                              {resumenConsolidado.meses.map((m) => (
                                <td key={m.mesKey} className="px-4 py-3 text-right">
                                  {getValorResumen(m.agg, fila.key)}
                                </td>
                              ))}
                              <td className="px-4 py-3 text-right font-bold">
                                {getValorResumen(resumenConsolidado.total, fila.key)}
                              </td>
                            </tr>
                          )),
                        ])}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {seccionActiva === "registros" && (
              <section
                id="registros"
                className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-6">
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
                    Registros
                  </p>
                  <h3 className="mt-2 text-2xl font-bold text-gray-950">
                    Registros ingresados
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-left text-sm">
                    <thead className="bg-gray-100 text-gray-700">
                      <tr>
                        <th className="px-4 py-3">Periodo</th>
                        <th className="px-4 py-3">Fechas</th>
                        <th className="px-4 py-3">Empresa</th>
                        <th className="px-4 py-3">Leads</th>
                        <th className="px-4 py-3">Ventas</th>
                        <th className="px-4 py-3">Ingreso</th>
                        <th className="px-4 py-3">Gasto total</th>
                        <th className="px-4 py-3">Acción</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-200">
                      {costosOrdenados.map((costo) => {
                        const badgeClass =
                          costo.periodoTipo === "dia"
                            ? "bg-blue-100 text-blue-700"
                            : costo.periodoTipo === "semana"
                            ? "bg-green-100 text-green-700"
                            : "bg-orange-100 text-orange-700";
                        const fechaIni = costo.fechaInicio.split("-").reverse().join("/");
                        const fechaFinFmt = costo.fechaFin.split("-").reverse().join("/");
                        const gastoTotal =
                          costo.inversionMeta +
                          costo.inversionGoogle +
                          costo.costoIas +
                          costo.costoManychat +
                          costo.costoDiseno +
                          costo.otrosVariables +
                          costo.otrosFijos;
                        return (
                          <tr key={costo.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${badgeClass}`}>
                                {costo.periodoTipo}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {costo.periodoTipo === "dia" ? fechaIni : `${fechaIni} - ${fechaFinFmt}`}
                            </td>
                            <td className="px-4 py-3 font-semibold">{getEmpresaNombre(costo.empresaId)}</td>
                            <td className="px-4 py-3">{costo.leadsGenerados}</td>
                            <td className="px-4 py-3">{costo.ventasCerradas}</td>
                            <td className="px-4 py-3">{formatMoney(costo.ingresoGenerado)}</td>
                            <td className="px-4 py-3">{formatMoney(gastoTotal)}</td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => handleEliminarCosto(costo.id)}
                                className="rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-200"
                              >
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {costosOrdenados.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                            Aun no hay registros. Agrega uno desde el formulario arriba.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {seccionActiva === "equipo" && (
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
                  <form onSubmit={handleInvitarMiembro} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                      onChange={(e) => setInvitacionForm({ ...invitacionForm, rol: e.target.value as Miembro["rol"] })}
                      className="rounded-2xl border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                    >
                      <option value="superadmin">Superadmin</option>
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
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="bg-gray-100 text-gray-700">
                      <tr>
                        <th className="px-4 py-3">Email</th>
                        {isSuperadmin && <th className="px-4 py-3">Workspace</th>}
                        <th className="px-4 py-3">Orden</th>
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
                          {isSuperadmin && (
                            <td className="px-4 py-3 text-gray-600">
                              {workspaces.find((workspace) => workspace.id === miembro.workspace_id)?.nombre || miembro.workspace_id}
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={1}
                              value={getMemberOrder(miembro)}
                              onChange={(event) =>
                                handleActualizarOrdenMiembro(miembro, Number(event.target.value))
                              }
                              className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                              aria-label={`Orden de ${miembro.email}`}
                            />
                          </td>
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
                              onClick={() => handleEliminarMiembro(miembro.id, miembro.email, miembro.workspace_id)}
                              className="rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-200"
                            >
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      ))}

                      {miembros.length === 0 && (
                        <tr>
                          <td colSpan={isSuperadmin ? 7 : 6} className="px-4 py-10 text-center text-gray-500">
                            No hay miembros invitados aún. Invita a tu primer compañero.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
