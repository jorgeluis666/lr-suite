"use client";

import { useEffect, useMemo, useState } from "react";

type Quote = {
  id: string;
  empresa: string;
  contacto: string;
  telefono: string;
  correo: string;
  servicio: string;
  montoCotizado: number;
  fecha: string;
  contactos: number;
  montoFacturado: number;
};

const MONTHS = [
  ["2026-01", "Ene", "Enero 2026"],
  ["2026-02", "Feb", "Febrero 2026"],
  ["2026-03", "Mar", "Marzo 2026"],
  ["2026-04", "Abr", "Abril 2026"],
  ["2026-05", "May", "Mayo 2026"],
  ["2026-06", "Jun", "Junio 2026"],
  ["2026-07", "Jul", "Julio 2026"],
  ["2026-08", "Ago", "Agosto 2026"],
  ["sin-fecha", "S/F", "Sin fecha"],
] as const;

const SALES_BY_MONTH: Record<string, number> = {
  "2026-01": 248500,
  "2026-02": 261300,
  "2026-03": 284500,
  "2026-04": 307000,
};

const RAW_QUOTES = [
  ["Oskar Valle", "Oskar Valle", "+51 949 037 970", "", "Gestión Google Ads", 650, "2026-08-14"],
  ["EL MUNDO ES TUYO !!!", "Diego Machuca", "+51 932 120 841", "", "Gestión Google Ads", 650, "2026-08-14"],
  ["Juris Group Abogados", "José", "+51 989 519 410", "", "Auditoría Google", 450, "2026-08-11"],
  ["JAIME S. CHAVEZ S.A.C.", "", "+51 922 433 921", "", "Página Web", 5400, "2026-08-05"],
  ["Cliente sin nombre", "Claudia", "+51 997 211 586", "", "Videos informativos", 7400, "2026-08-03"],
  ["Cliente sin nombre", "Harold", "+51 955 247 621", "", "Gestión Google Ads", 650, "2026-08-01"],
  ["Cliente sin nombre", "", "+51 946 005 326", "", "Gestión Google Ads", 650, "2026-07-30"],
  ["Cliente sin nombre", "", "+51 990 836 718", "", "Servicio pendiente de identificar", 850, "2026-06-30"],
  ["Transportes Ricapa", "Carlos", "+51 912 558 191", "", "Gestión Google Ads", 650, "2026-06-04"],
  ["Cliente sin nombre", "Fernando", "+51 993 199 793", "", "Gestión Google Ads", 650, "2026-05-22"],
  ["Geo Exploraciones del Norte SAC", "", "+51 978 402 621", "geoexploracionesdelnorte@gmail.com", "Videos con IA", 240, "2026-05-22"],
  ["Equípate Ya!", "", "+51 908 674 908", "", "Web", 950, "2026-05-12"],
  ["Cliente sin nombre", "Mariane Rivera Escobedo", "+51 943 569 053", "", "Meta Ads + Videos", 1150, "2026-05-06"],
  ["Lumi st", "", "+51 905 622 002", "", "Contenido / Gestión de contenido", 444, "2026-05-05"],
  ["Fernando Bajo El Sombrero", "Fernando", "+51 982 000 639", "", "Contenido / Gestión de contenido", 2010, "2026-05-05"],
  ["C.E.C. Guaman Poma de Ayala - Cusco", "Yaquelyn", "+51 902 384 742", "", "Plataforma educativa + Landing Page + difusión de 5 videos", 2400, "2026-04-28"],
  ["OCI Soluciones de Altura", "", "+51 922 216 277", "", "Servicio audiovisual - 4 videos", 1200, "2026-04-10"],
  ["RH SERVITEC", "Andrés", "+51 964 823 751", "", "Gestión Google Ads", 650, "2026-03-12"],
  ["CADMO", "Yasmin", "+51 946 779 449", "", "Diseño de Brochure / Catálogo corporativo", 1296, "2026-03-09"],
  ["Mijha", "Mijhael", "+51 938 402 636", "", "Gestión Google Ads", 650, "2026-02-20"],
  ["Cliente sin nombre", "Alex D.", "+7 901 302 1597", "", "Google Ads + Landing Page", 2100, "2026-02-06"],
  ["Dr Martin Nuñez", "Dr Martin Nuñez", "+51 964 039 912", "", "Desarrollo de Landing Page", 1600, ""],
] as const;

const INITIAL_QUOTES: Quote[] = RAW_QUOTES.map((row, index) => ({
  id: `quote-${index + 1}`,
  empresa: String(row[0]),
  contacto: String(row[1]),
  telefono: String(row[2]),
  correo: String(row[3]),
  servicio: String(row[4]),
  montoCotizado: Number(row[5]),
  fecha: String(row[6]),
  contactos: 0,
  montoFacturado: 0,
}));

const STORAGE_KEY = "lr-suite-cotizaciones-v1";
const money = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const date = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" });

function monthOf(quote: Quote) {
  return quote.fecha ? quote.fecha.slice(0, 7) : "sin-fecha";
}

function percent(value: number) {
  return `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

export default function CotizacionesPage() {
  const [quotes, setQuotes] = useState(INITIAL_QUOTES);
  const [month, setMonth] = useState("2026-08");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, Partial<Quote>>;
      setQuotes((current) => current.map((quote) => ({ ...quote, ...saved[quote.id], id: quote.id })));
    } catch {
      // La tabla sigue funcionando aunque el navegador bloquee localStorage.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(quotes.map((quote) => [quote.id, {
        contactos: quote.contactos,
        montoFacturado: quote.montoFacturado,
      }])))
    );
  }, [quotes, loaded]);

  const monthQuotes = useMemo(() => quotes.filter((quote) => monthOf(quote) === month), [quotes, month]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return monthQuotes;
    return monthQuotes.filter((quote) => `${quote.empresa} ${quote.contacto} ${quote.servicio} ${quote.telefono}`.toLowerCase().includes(query));
  }, [monthQuotes, search]);

  const quoted = monthQuotes.reduce((sum, quote) => sum + quote.montoCotizado, 0);
  const billed = monthQuotes.reduce((sum, quote) => sum + quote.montoFacturado, 0);
  const contacts = monthQuotes.reduce((sum, quote) => sum + quote.contactos, 0);
  const sales = SALES_BY_MONTH[month];
  const monthLabel = MONTHS.find(([key]) => key === month)?.[2] ?? month;

  function updateQuote(id: string, patch: Partial<Quote>) {
    setQuotes((current) => current.map((quote) => quote.id === id ? { ...quote, ...patch } : quote));
  }

  return (
    <div className="min-h-screen p-5 md:p-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-red-700">Finanzas · Lima Retail</p>
          <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-gray-950">Seguimiento de Cotizaciones</h1>
              <p className="mt-2 max-w-3xl text-sm text-gray-500">Cotizaciones enviadas, contactos comerciales y oportunidad realmente facturada frente a las ventas del mes.</p>
            </div>
            <div className="rounded-2xl bg-gray-950 px-5 py-3 text-white">
              <p className="text-xs text-gray-400">Periodo activo</p>
              <p className="font-bold">{monthLabel}</p>
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {MONTHS.map(([key, short, label]) => (
              <button key={key} type="button" onClick={() => setMonth(key)} aria-label={label} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${month === key ? "bg-red-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {short}
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Monto cotizado", money.format(quoted), `${monthQuotes.length} cotizaciones enviadas`],
            ["Oportunidad facturada", money.format(billed), `${percent(quoted ? billed / quoted : 0)} de lo cotizado`],
            ["Ventas del mes", sales === undefined ? "Sin dato" : money.format(sales), sales === undefined ? "Aún no existe P&G para el periodo" : "Ingresos registrados en P&G"],
            ["Aporte a ventas", sales ? percent(billed / sales) : "—", `${contacts} contactos registrados`],
          ].map(([label, value, detail]) => (
            <article key={label} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p>
              <p className="mt-3 text-2xl font-black text-gray-950">{value}</p>
              <p className="mt-1 text-xs text-gray-500">{detail}</p>
            </article>
          ))}
        </section>

        <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-black text-gray-950">Cotizaciones enviadas</h2>
              <p className="text-sm text-gray-500">{visible.length} registros visibles</p>
            </div>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, servicio o contacto" className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-red-600 md:max-w-sm" />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-4">Servicio / cliente</th>
                  <th className="px-5 py-4">Estado</th>
                  <th className="px-5 py-4 text-right">Monto cotizado</th>
                  <th className="px-5 py-4 text-right">Oportunidad facturada</th>
                  <th className="px-5 py-4">Fecha envío</th>
                  <th className="px-5 py-4 text-right">Contactos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((quote) => (
                  <tr key={quote.id} className="hover:bg-gray-50/70">
                    <td className="px-5 py-4">
                      <p className="font-bold text-gray-950">{quote.servicio}</p>
                      <p className="mt-1 text-xs text-gray-500">{quote.empresa}</p>
                      <p className="mt-1 text-xs text-gray-400">{[quote.contacto, quote.telefono, quote.correo].filter(Boolean).join(" · ") || "Contacto pendiente"}</p>
                    </td>
                    <td className="px-5 py-4"><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Enviada</span></td>
                    <td className="px-5 py-4 text-right font-bold">{money.format(quote.montoCotizado)}</td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="0.01" value={quote.montoFacturado} onChange={(event) => updateQuote(quote.id, { montoFacturado: Math.max(0, Number(event.target.value) || 0) })} className="w-28 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" aria-label={`Monto facturado de ${quote.empresa}`} /></td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-500">{quote.fecha ? date.format(new Date(`${quote.fecha}T12:00:00`)) : "Fecha pendiente"}</td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="1" value={quote.contactos} onChange={(event) => updateQuote(quote.id, { contactos: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className="w-20 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" aria-label={`Contactos de ${quote.empresa}`} /></td>
                  </tr>
                ))}
                {!visible.length && <tr><td colSpan={6} className="px-5 py-14 text-center text-gray-500">No hay cotizaciones para este periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
