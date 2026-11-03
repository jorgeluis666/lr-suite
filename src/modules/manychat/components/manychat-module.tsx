"use client";

import { useState } from "react";

// ── Tipos ──────────────────────────────────────────────────────
type EstadoLead = "Nuevo" | "En seguimiento" | "Cotizando" | "Cerrado" | "Perdido";

interface Lead {
  id: string;
  nombre: string;
  telefono: string;
  rubro: string;
  presupuesto: string;
  estado: EstadoLead;
  fecha: string;
  canal: string;
}

interface Mensaje {
  id: number;
  remitente: "usuario" | "bot";
  texto: string;
  hora: string;
}

// ── Mock data — leads realistas de campaña Google Ads Search ───
const LEADS_MOCK: Lead[] = [
  {
    id: "wa_001",
    nombre: "Violeta Quispe",
    telefono: "+51 987 654 321",
    rubro: "Boutique de ropa",
    presupuesto: "S/ 1,200",
    estado: "En seguimiento",
    fecha: "10/06/2026",
    canal: "WhatsApp",
  },
  {
    id: "wa_002",
    nombre: "Marco Aguilar",
    telefono: "+51 912 345 678",
    rubro: "Restaurante / Delivery",
    presupuesto: "S/ 3,500",
    estado: "Cotizando",
    fecha: "08/06/2026",
    canal: "WhatsApp",
  },
  {
    id: "wa_003",
    nombre: "Daniela Torres",
    telefono: "+51 945 123 456",
    rubro: "Clínica estética",
    presupuesto: "S/ 2,800",
    estado: "Nuevo",
    fecha: "12/06/2026",
    canal: "WhatsApp",
  },
  {
    id: "wa_004",
    nombre: "Luis Mendoza",
    telefono: "+51 978 901 234",
    rubro: "Inmobiliaria",
    presupuesto: "S/ 5,000",
    estado: "En seguimiento",
    fecha: "11/06/2026",
    canal: "WhatsApp",
  },
  {
    id: "wa_005",
    nombre: "Carmen Villanueva",
    telefono: "+51 931 567 890",
    rubro: "Tienda de calzado",
    presupuesto: "S/ 900",
    estado: "Cotizando",
    fecha: "05/06/2026",
    canal: "WhatsApp",
  },
  {
    id: "wa_006",
    nombre: "Rodrigo Palomino",
    telefono: "+51 956 234 567",
    rubro: "Academia de inglés",
    presupuesto: "S/ 1,800",
    estado: "Cerrado",
    fecha: "02/06/2026",
    canal: "WhatsApp",
  },
  {
    id: "wa_007",
    nombre: "Patricia Huamani",
    telefono: "+51 914 789 012",
    rubro: "Veterinaria",
    presupuesto: "S/ 1,400",
    estado: "Nuevo",
    fecha: "13/06/2026",
    canal: "WhatsApp",
  },
  {
    id: "wa_008",
    nombre: "Diego Castillo",
    telefono: "+51 967 345 678",
    rubro: "Consultoría de negocios",
    presupuesto: "S/ 4,200",
    estado: "Perdido",
    fecha: "04/06/2026",
    canal: "WhatsApp",
  },
];

// ── Mock conversations por lead ─────────────────────────────────
const CONVERSACIONES_MOCK: Record<string, Mensaje[]> = {
  wa_001: [
    { id: 1, remitente: "usuario", texto: "Hola buenas! Vi el anuncio de Google y quiero info sobre publicidad digital para mi tienda", hora: "09:14" },
    { id: 2, remitente: "bot",     texto: "¡Hola Violeta! Gracias por contactarnos 👋 Somos Lima Retail y ayudamos a tiendas como la tuya a crecer con Google Ads. ¿Me cuentas un poco más sobre tu negocio?", hora: "09:14" },
    { id: 3, remitente: "usuario", texto: "Tengo una boutique de ropa en Miraflores, quiero más ventas online", hora: "09:16" },
    { id: 4, remitente: "bot",     texto: "Perfecto! Para darte una propuesta personalizada, ¿cuánto tienes pensado invertir mensualmente en publicidad?", hora: "09:16" },
    { id: 5, remitente: "usuario", texto: "Por ahora unos 1200 soles al mes", hora: "09:18" },
    { id: 6, remitente: "bot",     texto: "Con S/ 1,200 podemos armar una campaña enfocada en Google Shopping y Search para llegar a personas que buscan ropa en Lima. ¿Te gustaría agendar una llamada para ver los detalles?", hora: "09:18" },
    { id: 7, remitente: "usuario", texto: "Sí me interesa! ¿Cuándo pueden llamarme?", hora: "09:20" },
    { id: 8, remitente: "bot",     texto: "Nuestro equipo te contactará hoy entre las 3pm y 5pm. ¡Gracias Violeta! 🙌", hora: "09:20" },
  ],
  wa_002: [
    { id: 1, remitente: "usuario", texto: "Buenos días, vi su anuncio en Google buscando agencia de marketing", hora: "11:02" },
    { id: 2, remitente: "bot",     texto: "¡Buenos días Marco! Soy el asistente de Lima Retail 🙌 ¿En qué tipo de negocio estás pensando hacer publicidad?", hora: "11:02" },
    { id: 3, remitente: "usuario", texto: "Tengo un restaurante y delivery de comida criolla en San Isidro", hora: "11:04" },
    { id: 4, remitente: "bot",     texto: "¡Qué bien! El sector gastronómico funciona muy bien con Google Ads, especialmente para captar pedidos en zonas específicas. ¿Cuál sería tu presupuesto mensual para publicidad?", hora: "11:04" },
    { id: 5, remitente: "usuario", texto: "Puedo arrancar con 3500 soles", hora: "11:06" },
    { id: 6, remitente: "bot",     texto: "Excelente presupuesto 💪 Con eso podemos hacer campañas en Google Maps, Search y YouTube para dominar el sector en San Isidro. ¿Te enviamos la propuesta al WhatsApp?", hora: "11:06" },
    { id: 7, remitente: "usuario", texto: "Sí, mándenme por aquí por favor", hora: "11:08" },
  ],
  wa_003: [
    { id: 1, remitente: "usuario", texto: "Hola! Encontré su página buscando agencias de Google Ads en Lima", hora: "14:33" },
    { id: 2, remitente: "bot",     texto: "¡Hola Daniela! Bienvenida 😊 Somos Lima Retail, especialistas en publicidad digital. ¿A qué se dedica tu negocio?", hora: "14:33" },
    { id: 3, remitente: "usuario", texto: "Tengo una clínica estética en Surco, hago tratamientos faciales y corporales", hora: "14:35" },
    { id: 4, remitente: "bot",     texto: "Perfecto, el sector salud y belleza tiene mucha demanda en Google. ¿Cuánto piensas invertir en publicidad mensualmente?", hora: "14:35" },
    { id: 5, remitente: "usuario", texto: "Tengo presupuesto de 2800 al mes", hora: "14:37" },
    { id: 6, remitente: "bot",     texto: "Muy bien Daniela, con ese presupuesto podemos enfocarnos en Google Search para captar personas que buscan activamente tratamientos. Voy a pasarte con un asesor ahora.", hora: "14:37" },
  ],
  wa_004: [
    { id: 1, remitente: "usuario", texto: "Buenas tardes, quiero publicidad para mis proyectos inmobiliarios", hora: "16:10" },
    { id: 2, remitente: "bot",     texto: "¡Buenas tardes Luis! Inmobiliaria es uno de los sectores donde Google Ads mejor funciona para captar leads calificados. ¿Qué tipo de proyectos manejas?", hora: "16:10" },
    { id: 3, remitente: "usuario", texto: "Vendo departamentos en Jesús María y Lince, tenemos proyectos de 80k a 150k dólares", hora: "16:12" },
    { id: 4, remitente: "bot",     texto: "Excelente segmento. Para ese ticket, Google Search con campañas bien segmentadas puede traer leads muy calificados. ¿Tienes presupuesto estimado para publicidad?", hora: "16:12" },
    { id: 5, remitente: "usuario", texto: "Podemos invertir 5000 soles mensuales para arrancar", hora: "16:14" },
    { id: 6, remitente: "bot",     texto: "Con S/ 5,000 podemos armar una estrategia completa. Te asigno un asesor especializado en inmobiliaria. ¿Puedes mañana a las 10am?", hora: "16:15" },
    { id: 7, remitente: "usuario", texto: "Sí, a las 10 está bien", hora: "16:16" },
    { id: 8, remitente: "bot",     texto: "Perfecto Luis, confirmado para mañana 10am. Te llegará un recordatorio. 📅", hora: "16:16" },
  ],
  wa_005: [
    { id: 1, remitente: "usuario", texto: "Hola, vi el anuncio y me interesa hacer publicidad para mi tienda", hora: "10:45" },
    { id: 2, remitente: "bot",     texto: "¡Hola Carmen! ¿Qué tipo de tienda tienes?", hora: "10:45" },
    { id: 3, remitente: "usuario", texto: "Vendo calzado de mujer, tenemos tienda física en Gamarra y también online", hora: "10:47" },
    { id: 4, remitente: "bot",     texto: "¡Gamarra + ecommerce, perfecto! Google Shopping es ideal para tu negocio. ¿Qué presupuesto manejas?", hora: "10:47" },
    { id: 5, remitente: "usuario", texto: "Por ahora 900 soles al mes", hora: "10:49" },
    { id: 6, remitente: "bot",     texto: "Con S/ 900 podemos empezar con Google Shopping enfocado en las búsquedas más rentables. ¿Te enviamos una propuesta?", hora: "10:49" },
  ],
  wa_006: [
    { id: 1, remitente: "usuario", texto: "Buenas! Busco una agencia para hacer crecer mi academia de inglés", hora: "08:22" },
    { id: 2, remitente: "bot",     texto: "¡Hola Rodrigo! El sector educativo tiene muy buena tasa de conversión en Google. ¿Cuántos alumnos tienes actualmente?", hora: "08:22" },
    { id: 3, remitente: "usuario", texto: "Tenemos 120 alumnos activos, queremos llegar a 200 este año", hora: "08:25" },
    { id: 4, remitente: "bot",     texto: "Objetivo claro 💪 Con Google Ads podemos llenar tus vacantes rápido. ¿Cuál es tu inversión mensual disponible?", hora: "08:25" },
    { id: 5, remitente: "usuario", texto: "1800 soles mensuales", hora: "08:27" },
    { id: 6, remitente: "bot",     texto: "Perfecto. Ya te asigné a uno de nuestros asesores, te escribirá en menos de 1 hora. ¡Gracias Rodrigo! 🙌", hora: "08:27" },
    { id: 7, remitente: "usuario", texto: "Gracias! Los espero", hora: "08:28" },
    { id: 8, remitente: "bot",     texto: "Propuesta enviada ✅ Confirmamos trabajo conjunto. Inicio campaña programado para el lunes.", hora: "09:15" },
  ],
  wa_007: [
    { id: 1, remitente: "usuario", texto: "Hola buenas tardes! Tengo una veterinaria y quiero hacer publicidad", hora: "15:05" },
    { id: 2, remitente: "bot",     texto: "¡Hola Patricia! Las veterinarias tienen mucha búsqueda local en Google. ¿En qué distrito estás ubicada?", hora: "15:05" },
    { id: 3, remitente: "usuario", texto: "Estamos en La Molina y Surco", hora: "15:07" },
    { id: 4, remitente: "bot",     texto: "Dos locales, mejor aún! Podemos hacer campañas geolocalizadas para cada zona. ¿Cuánto puedes invertir mensualmente?", hora: "15:07" },
    { id: 5, remitente: "usuario", texto: "Pienso en 1400 soles para empezar", hora: "15:09" },
    { id: 6, remitente: "bot",     texto: "Con S/ 1,400 dividido en dos zonas podemos generar buenos resultados. Un asesor te contactará mañana en la mañana 🐾", hora: "15:09" },
  ],
  wa_008: [
    { id: 1, remitente: "usuario", texto: "Hola, estoy buscando agencia de marketing digital para mi consultora", hora: "17:40" },
    { id: 2, remitente: "bot",     texto: "¡Hola Diego! ¿Qué tipo de consultoría manejas?", hora: "17:40" },
    { id: 3, remitente: "usuario", texto: "Consultoría de negocios y estrategia para PYMEs", hora: "17:42" },
    { id: 4, remitente: "bot",     texto: "Interesante. B2B en Google puede ser muy efectivo con la segmentación correcta. ¿Cuánto piensas invertir en publicidad?", hora: "17:42" },
    { id: 5, remitente: "usuario", texto: "Tengo presupuesto de 4200 soles al mes", hora: "17:44" },
    { id: 6, remitente: "bot",     texto: "Excelente. Con ese presupuesto podemos armar una estrategia B2B muy sólida. ¿Te mando la propuesta ahora?", hora: "17:44" },
    { id: 7, remitente: "usuario", texto: "Sí, por favor", hora: "17:45" },
    { id: 8, remitente: "bot",     texto: "Propuesta enviada por email. Revísala y cualquier consulta con gusto.", hora: "17:50" },
    { id: 9, remitente: "usuario", texto: "La vi, voy a pensarlo y les aviso la próxima semana", hora: "17:55" },
    { id: 10, remitente: "bot",    texto: "Perfecto Diego, quedamos atentos. ¡Éxito! 🙌", hora: "17:55" },
  ],
};

// ── Helpers visuales ───────────────────────────────────────────
const ESTADO_BADGE: Record<EstadoLead, string> = {
  "Nuevo":          "bg-blue-100 text-blue-700",
  "En seguimiento": "bg-yellow-100 text-yellow-700",
  "Cotizando":      "bg-orange-100 text-orange-700",
  "Cerrado":        "bg-green-100 text-green-700",
  "Perdido":        "bg-gray-200 text-gray-600",
};

function iniciales(nombre: string) {
  return nombre.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

// ── Componente principal ───────────────────────────────────────
export function ManychatModule() {
  const [leadActivo, setLeadActivo] = useState<Lead | null>(LEADS_MOCK[0]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<EstadoLead | "">("");

  const leadsFiltrados = LEADS_MOCK.filter((l) => {
    const q = busqueda.toLowerCase();
    const coincideTexto =
      !q ||
      l.nombre.toLowerCase().includes(q) ||
      l.telefono.includes(q) ||
      l.rubro.toLowerCase().includes(q);
    const coincideEstado = !filtroEstado || l.estado === filtroEstado;
    return coincideTexto && coincideEstado;
  });

  const mensajes = leadActivo ? (CONVERSACIONES_MOCK[leadActivo.id] ?? []) : [];

  // ── KPIs rápidos ──────────────────────────────────────────────
  const kpis = {
    total:          LEADS_MOCK.length,
    nuevos:         LEADS_MOCK.filter((l) => l.estado === "Nuevo").length,
    enSeguimiento:  LEADS_MOCK.filter((l) => l.estado === "En seguimiento").length,
    cerrados:       LEADS_MOCK.filter((l) => l.estado === "Cerrado").length,
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">
          ManyChat · Google Ads Search
        </p>
        <h3 className="mt-2 text-2xl font-bold text-gray-950">
          Leads de WhatsApp
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Leads capturados vía campaña Search con tag &quot;Servicio Google Ads&quot;.
          Vista de prueba con datos simulados.
        </p>
      </section>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Total leads",      valor: kpis.total,         color: "text-gray-950" },
          { label: "Nuevos",           valor: kpis.nuevos,        color: "text-blue-600" },
          { label: "En seguimiento",   valor: kpis.enSeguimiento, color: "text-yellow-600" },
          { label: "Cerrados",         valor: kpis.cerrados,      color: "text-green-600" },
        ].map(({ label, valor, color }) => (
          <div key={label} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">{label}</p>
            <p className={`mt-3 text-4xl font-black ${color}`}>{valor}</p>
          </div>
        ))}
      </div>

      {/* ── Panel principal: tabla + chat ── */}
      <div className="flex gap-4" style={{ minHeight: "600px" }}>

        {/* ── Columna izquierda: tabla de leads ── */}
        <div className="flex w-full flex-col rounded-3xl border border-gray-200 bg-white shadow-sm lg:w-1/2 xl:w-[55%]">
          {/* Filtros */}
          <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row">
            <input
              type="text"
              placeholder="Buscar lead..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="flex-1 rounded-2xl border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as EstadoLead | "")}
              className="rounded-2xl border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
            >
              <option value="">Todos los estados</option>
              {(["Nuevo", "En seguimiento", "Cotizando", "Cerrado", "Perdido"] as EstadoLead[]).map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>

          {/* Lista de leads */}
          <div className="flex-1 overflow-y-auto">
            {leadsFiltrados.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">
                No hay leads que coincidan con la búsqueda.
              </p>
            ) : (
              leadsFiltrados.map((lead) => {
                const activo = leadActivo?.id === lead.id;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setLeadActivo(lead)}
                    className={`flex w-full items-start gap-4 border-b border-gray-100 px-5 py-4 text-left transition hover:bg-gray-50 ${
                      activo ? "bg-red-50 hover:bg-red-50" : ""
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        activo ? "bg-red-700 text-white" : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {iniciales(lead.nombre)}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm font-semibold ${activo ? "text-red-700" : "text-gray-900"}`}>
                          {lead.nombre}
                        </span>
                        <span className="shrink-0 text-xs text-gray-400">{lead.fecha}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {lead.rubro} · {lead.presupuesto}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ESTADO_BADGE[lead.estado]}`}>
                          {lead.estado}
                        </span>
                        <span className="text-[10px] text-gray-400">{lead.telefono}</span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-gray-100 px-5 py-3">
            <p className="text-xs text-gray-400">
              {leadsFiltrados.length} de {LEADS_MOCK.length} leads · Canal WhatsApp · Datos de prueba
            </p>
          </div>
        </div>

        {/* ── Columna derecha: visor de chat ── */}
        <div className="hidden flex-1 flex-col rounded-3xl border border-gray-200 bg-white shadow-sm lg:flex">
          {leadActivo ? (
            <>
              {/* Header del chat */}
              <div className="flex items-center gap-4 border-b border-gray-100 bg-[#f0fdf4] px-5 py-4 rounded-t-3xl">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">
                  {iniciales(leadActivo.nombre)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{leadActivo.nombre}</p>
                  <p className="text-xs text-gray-500">{leadActivo.telefono} · {leadActivo.rubro}</p>
                </div>
                <div className="ml-auto text-right">
                  <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${ESTADO_BADGE[leadActivo.estado]}`}>
                    {leadActivo.estado}
                  </span>
                  <p className="mt-1 text-xs text-gray-400">Ppto: {leadActivo.presupuesto}</p>
                </div>
              </div>

              {/* Mensajes estilo WhatsApp */}
              <div className="flex-1 overflow-y-auto space-y-3 bg-[#f5f5f5] px-5 py-4"
                   style={{ backgroundImage: "radial-gradient(circle, #e0e0e0 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                {mensajes.map((msg) => {
                  const esUsuario = msg.remitente === "usuario";
                  return (
                    <div key={msg.id} className={`flex ${esUsuario ? "justify-start" : "justify-end"}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                          esUsuario
                            ? "rounded-tl-sm bg-white text-gray-900"
                            : "rounded-tr-sm bg-[#dcf8c6] text-gray-900"
                        }`}
                      >
                        <p className="leading-relaxed">{msg.texto}</p>
                        <p className={`mt-1 text-right text-[10px] ${esUsuario ? "text-gray-400" : "text-green-700"}`}>
                          {msg.hora}
                          {!esUsuario && <span className="ml-1 text-green-600">✓✓</span>}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input simulado (no funcional — solo visual) */}
              <div className="flex items-center gap-3 border-t border-gray-100 bg-white px-5 py-3 rounded-b-3xl">
                <div className="flex-1 rounded-full border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-400 select-none">
                  Vista de solo lectura — historial real vía Webhook
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-white text-sm font-bold shrink-0">
                  ↑
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-gray-400 text-sm">Selecciona un lead para ver la conversación</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Info webhook ── */}
      <section className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Conexión en tiempo real</p>
            <p className="mt-1 text-sm text-gray-700">
              Cuando el servidor de webhooks esté activo, los leads nuevos aparecerán aquí automáticamente sin recargar.
            </p>
          </div>
          <div className="shrink-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-yellow-100 px-4 py-2 text-xs font-bold text-yellow-700">
              <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
              Webhook pendiente
            </span>
          </div>
        </div>
        <div className="mt-3 rounded-2xl bg-gray-100 px-4 py-3 text-xs text-gray-600 font-mono">
          POST https://&lt;tu-dominio&gt;/webhook/manychat &nbsp;·&nbsp; python webhook_server.py
        </div>
      </section>
    </div>
  );
}
