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

type MonthlyInput = {
  presupuesto: number;
  vendido: number;
  googleAds: number;
  metaAds: number;
  plataformas: number;
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

const TRACKED_MONTHS = MONTHS.filter(([key]) => key !== "sin-fecha");
const INITIAL_MONTHLY_INPUTS: Record<string, MonthlyInput> = Object.fromEntries(
  TRACKED_MONTHS.map(([key]) => [key, { presupuesto: 0, vendido: 0, googleAds: 0, metaAds: 0, plataformas: 0 }])
);

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
const MONTHLY_STORAGE_KEY = "lr-suite-cotizaciones-mensual-v1";
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
  const [showAll, setShowAll] = useState(false);
  const [monthlyInputs, setMonthlyInputs] = useState<Record<string, MonthlyInput>>(INITIAL_MONTHLY_INPUTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, Partial<Quote>>;
      setQuotes((current) => current.map((quote) => ({ ...quote, ...saved[quote.id], id: quote.id })));
      const savedMonthly = JSON.parse(localStorage.getItem(MONTHLY_STORAGE_KEY) || "{}") as Record<string, Partial<MonthlyInput>>;
      setMonthlyInputs((current) => Object.fromEntries((Object.entries(current) as [string, MonthlyInput][]).map(([key, value]) => [key, {
        presupuesto: Math.max(0, Number(savedMonthly[key]?.presupuesto ?? value.presupuesto) || 0),
        vendido: Math.max(0, Number(savedMonthly[key]?.vendido ?? value.vendido) || 0),
        googleAds: Math.max(0, Number(savedMonthly[key]?.googleAds ?? 0) || 0),
        metaAds: Math.max(0, Number(savedMonthly[key]?.metaAds ?? 0) || 0),
        plataformas: Math.max(0, Number(savedMonthly[key]?.plataformas ?? 0) || 0),
      }])));
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

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(MONTHLY_STORAGE_KEY, JSON.stringify(monthlyInputs));
  }, [monthlyInputs, loaded]);

  const monthQuotes = useMemo(() => quotes.filter((quote) => monthOf(quote) === month), [quotes, month]);
  const displayedQuotes = showAll ? quotes : monthQuotes;
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return displayedQuotes;
    return displayedQuotes.filter((quote) => `${quote.empresa} ${quote.contacto} ${quote.servicio} ${quote.telefono}`.toLowerCase().includes(query));
  }, [displayedQuotes, search]);

  const currentMonthly = monthlyInputs[month] ?? { presupuesto: 0, vendido: 0, googleAds: 0, metaAds: 0, plataformas: 0 };
  const monthLabel = MONTHS.find(([key]) => key === month)?.[2] ?? month;
  const totalQuoted = quotes.reduce((sum, quote) => sum + quote.montoCotizado, 0);
  const totalBilled = quotes.reduce((sum, quote) => sum + quote.montoFacturado, 0);
  const totalContacts = quotes.reduce((sum, quote) => sum + quote.contactos, 0);
  const totalBudget = (Object.values(monthlyInputs) as MonthlyInput[]).reduce((sum, value) => sum + value.googleAds + value.metaAds + value.plataformas, 0);
  const totalSold = (Object.values(monthlyInputs) as MonthlyInput[]).reduce((sum, value) => sum + value.vendido, 0);
  const activeInputs = showAll
    ? (Object.values(monthlyInputs) as MonthlyInput[]).reduce((sum, value) => ({
        googleAds: sum.googleAds + value.googleAds,
        metaAds: sum.metaAds + value.metaAds,
        plataformas: sum.plataformas + value.plataformas,
      }), { googleAds: 0, metaAds: 0, plataformas: 0 })
    : currentMonthly;
  const activeQuotes = showAll ? quotes : monthQuotes;
  const activeQuoted = activeQuotes.reduce((sum, quote) => sum + quote.montoCotizado, 0);
  const activeBilled = activeQuotes.reduce((sum, quote) => sum + quote.montoFacturado, 0);
  const closeRate = totalQuoted ? Math.min(1, totalBilled / totalQuoted) : 0;

  const monthlyDistribution = TRACKED_MONTHS.map(([key, short, label]) => {
    const rows = quotes.filter((quote) => monthOf(quote) === key);
    const monto = rows.reduce((sum, quote) => sum + quote.montoCotizado, 0);
    const values = monthlyInputs[key] ?? { presupuesto: 0, vendido: 0, googleAds: 0, metaAds: 0, plataformas: 0 };
    const inversionAds = values.googleAds + values.metaAds;
    const inversionTotal = inversionAds + values.plataformas;
    return { key, short, label, cantidad: rows.length, monto, ...values, inversionAds, inversionTotal };
  });

  const demandedServices = (Array.from(
    quotes.reduce((map, quote) => {
      const current = map.get(quote.servicio) ?? { servicio: quote.servicio, cantidad: 0, monto: 0 };
      current.cantidad += 1;
      current.monto += quote.montoCotizado;
      map.set(quote.servicio, current);
      return map;
    }, new Map<string, { servicio: string; cantidad: number; monto: number }>()).values()
  ) as { servicio: string; cantidad: number; monto: number }[]).sort((left, right) => right.cantidad - left.cantidad || right.monto - left.monto);
  const maxServiceCount = Math.max(1, ...demandedServices.map((service) => service.cantidad));

  function updateQuote(id: string, patch: Partial<Quote>) {
    setQuotes((current) => current.map((quote) => quote.id === id ? { ...quote, ...patch } : quote));
  }

  function updateMonthly(key: string, patch: Partial<MonthlyInput>) {
    setMonthlyInputs((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
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
            <div className="w-full max-w-xl rounded-2xl bg-gray-950 p-5 text-white">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-xs text-gray-400">Oportunidad total</p><p className="mt-1 text-lg font-black">{money.format(totalQuoted)}</p></div>
                <div className="text-right"><p className="text-xs text-gray-400">Cierre real</p><p className="mt-1 text-lg font-black text-emerald-400">{money.format(totalBilled)}</p></div>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/15" aria-label={`${percent(closeRate)} de oportunidad cerrada`}>
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${closeRate * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs"><span className="text-gray-400">Pendiente {money.format(Math.max(0, totalQuoted - totalBilled))}</span><strong>{percent(closeRate)} cerrado</strong></div>
            </div>
          </div>
        </header>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-700">Acumulado histórico</p>
              <h2 className="mt-1 text-xl font-black text-gray-950">Totales hasta la fecha</h2>
            </div>
            <p className="text-xs text-gray-500">Enero–agosto 2026</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Cotizaciones", String(quotes.length), "Propuestas enviadas"],
              ["Monto cotizado", money.format(totalQuoted), "Valor potencial acumulado"],
              ["Oportunidad facturada", money.format(totalBilled), `${percent(totalQuoted ? totalBilled / totalQuoted : 0)} de conversión`],
              ["Presupuesto invertido", money.format(totalBudget), "Inversión acumulada"],
              ["Ventas registradas", money.format(totalSold), totalBudget ? `ROAS ${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(totalSold / totalBudget)}x` : `${totalContacts} contactos`],
            ].map(([label, value, detail]) => (
              <article key={label} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p>
                <p className="mt-3 text-2xl font-black text-gray-950">{value}</p>
                <p className="mt-1 text-xs text-gray-500">{detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {MONTHS.map(([key, short, label]) => (
                <button key={key} type="button" onClick={() => { setMonth(key); setShowAll(false); }} aria-label={label} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${!showAll && month === key ? "bg-red-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  {short}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowAll((current) => !current)} className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${showAll ? "border-red-700 bg-red-700 text-white" : "border-red-200 bg-white text-red-700 hover:bg-red-50"}`}>
              {showAll ? "Ver mes seleccionado" : `Ver lista total (${quotes.length})`}
            </button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Inversión en Ads</p>
            <p className="mt-2 text-2xl font-black text-gray-950">{money.format(activeInputs.googleAds + activeInputs.metaAds)}</p>
            {showAll ? <p className="mt-1 text-xs text-gray-500">Google {money.format(activeInputs.googleAds)} · Meta {money.format(activeInputs.metaAds)}</p> : <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[10px] font-bold uppercase text-gray-500">Google<input type="number" min="0" value={currentMonthly.googleAds} onChange={(event) => updateMonthly(month, { googleAds: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-950" /></label><label className="text-[10px] font-bold uppercase text-gray-500">Meta<input type="number" min="0" value={currentMonthly.metaAds} onChange={(event) => updateMonthly(month, { metaAds: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-950" /></label></div>}
          </article>
          <article className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Inversión en plataformas</p>
            <p className="mt-2 text-2xl font-black text-gray-950">{money.format(activeInputs.plataformas)}</p>
            {!showAll && <label className="mt-3 block text-[10px] font-bold uppercase text-gray-500">Monto del mes<input type="number" min="0" value={currentMonthly.plataformas} onChange={(event) => updateMonthly(month, { plataformas: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-950" /></label>}
          </article>
          {[
            ["Cotizaciones enviadas", String(activeQuotes.length), showAll ? "Total acumulado" : monthLabel],
            ["Monto cotizado promedio", money.format(activeQuotes.length ? activeQuoted / activeQuotes.length : 0), "Promedio por cotización"],
            ["Monto total cotizado", money.format(activeQuoted), `${activeQuotes.length} propuestas`],
            ["Oportunidad facturada", money.format(activeBilled), `${percent(activeQuoted ? activeBilled / activeQuoted : 0)} del monto cotizado`],
          ].map(([label, value, detail]) => (
            <article key={label} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p><p className="mt-3 text-2xl font-black text-gray-950">{value}</p><p className="mt-1 text-xs text-gray-500">{detail}</p></article>
          ))}
        </section>

        <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 p-5">
            <h2 className="font-black text-gray-950">Distribución mensual e inversión</h2>
            <p className="mt-1 text-sm text-gray-500">Ingresa el presupuesto y las ventas atribuibles de cada mes. El ROAS se calcula como ventas ÷ presupuesto.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-4">Mes</th>
                  <th className="px-5 py-4 text-right">Google Ads</th>
                  <th className="px-5 py-4 text-right">Meta Ads</th>
                  <th className="px-5 py-4 text-right">Plataformas</th>
                  <th className="px-5 py-4 text-right">Ventas</th>
                  <th className="px-5 py-4 text-right">ROAS</th>
                  <th className="px-5 py-4 text-right">Cotizaciones</th>
                  <th className="px-5 py-4 text-right">Monto cotizado</th>
                  <th className="px-5 py-4 text-right">Costo/cotización</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {monthlyDistribution.map((row) => (
                  <tr key={row.key} className={month === row.key ? "bg-red-50/60" : "hover:bg-gray-50/70"}>
                    <td className="px-5 py-4"><button type="button" onClick={() => setMonth(row.key)} className="font-bold text-gray-950 hover:text-red-700">{row.label}</button></td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="0.01" value={row.googleAds} onChange={(event) => updateMonthly(row.key, { googleAds: Math.max(0, Number(event.target.value) || 0) })} className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" /></td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="0.01" value={row.metaAds} onChange={(event) => updateMonthly(row.key, { metaAds: Math.max(0, Number(event.target.value) || 0) })} className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" /></td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="0.01" value={row.plataformas} onChange={(event) => updateMonthly(row.key, { plataformas: Math.max(0, Number(event.target.value) || 0) })} className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" /></td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="0.01" value={row.vendido} onChange={(event) => updateMonthly(row.key, { vendido: Math.max(0, Number(event.target.value) || 0) })} className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" aria-label={`Ventas de ${row.label}`} /></td>
                    <td className="px-5 py-4 text-right font-black text-gray-950">{row.inversionTotal ? `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(row.vendido / row.inversionTotal)}x` : "—"}</td>
                    <td className="px-5 py-4 text-right font-bold">{row.cantidad}</td>
                    <td className="px-5 py-4 text-right font-bold">{money.format(row.monto)}</td>
                    <td className="px-5 py-4 text-right text-gray-500">{row.cantidad ? money.format(row.inversionTotal / row.cantidad) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-950 font-bold text-white">
                <tr>
                  <td className="px-5 py-4">Total hasta la fecha</td>
                  <td className="px-5 py-4 text-right">{money.format((Object.values(monthlyInputs) as MonthlyInput[]).reduce((sum, value) => sum + value.googleAds, 0))}</td>
                  <td className="px-5 py-4 text-right">{money.format((Object.values(monthlyInputs) as MonthlyInput[]).reduce((sum, value) => sum + value.metaAds, 0))}</td>
                  <td className="px-5 py-4 text-right">{money.format((Object.values(monthlyInputs) as MonthlyInput[]).reduce((sum, value) => sum + value.plataformas, 0))}</td>
                  <td className="px-5 py-4 text-right">{money.format(totalSold)}</td>
                  <td className="px-5 py-4 text-right">{totalBudget ? `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(totalSold / totalBudget)}x` : "—"}</td>
                  <td className="px-5 py-4 text-right">{quotes.filter((quote) => quote.fecha).length}</td>
                  <td className="px-5 py-4 text-right">{money.format(quotes.filter((quote) => quote.fecha).reduce((sum, quote) => sum + quote.montoCotizado, 0))}</td>
                  <td className="px-5 py-4 text-right">{quotes.some((quote) => quote.fecha) ? money.format(totalBudget / quotes.filter((quote) => quote.fecha).length) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="font-black text-gray-950">Servicios más demandados</h2>
            <p className="mt-1 text-sm text-gray-500">Ranking acumulado por número de cotizaciones; el monto muestra el valor potencial generado.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {demandedServices.map((service, index) => (
              <article key={service.servicio} className="rounded-2xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-red-700">#{index + 1}</p>
                    <h3 className="mt-1 truncate font-bold text-gray-950" title={service.servicio}>{service.servicio}</h3>
                  </div>
                  <div className="shrink-0 text-right"><p className="font-black text-gray-950">{service.cantidad}</p><p className="text-xs text-gray-500">cotizaciones</p></div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-red-700" style={{ width: `${(service.cantidad / maxServiceCount) * 100}%` }} /></div>
                <p className="mt-3 text-sm font-bold text-gray-700">{money.format(service.monto)} cotizados</p>
              </article>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-black text-gray-950">{showAll ? "Lista total de cotizaciones" : `Cotizaciones de ${monthLabel}`}</h2>
              <p className="text-sm text-gray-500">{visible.length} registros visibles</p>
            </div>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, servicio o contacto" className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-red-600 md:max-w-sm" />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  {showAll && <th className="px-5 py-4">Mes</th>}
                  {showAll && <th className="px-5 py-4">Empresa / cliente</th>}
                  {showAll && <th className="px-5 py-4">Contacto</th>}
                  <th className="px-5 py-4">Servicio</th>
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
                    {showAll && <td className="whitespace-nowrap px-5 py-4 font-bold text-gray-700">{MONTHS.find(([key]) => key === monthOf(quote))?.[2] ?? "Sin fecha"}</td>}
                    {showAll && <td className="px-5 py-4"><p className="font-bold text-gray-950">{quote.empresa}</p><p className="mt-1 text-xs text-gray-400">{quote.correo || "Sin correo"}</p></td>}
                    {showAll && <td className="px-5 py-4"><p className="font-medium text-gray-800">{quote.contacto || "Sin nombre"}</p><p className="mt-1 whitespace-nowrap text-xs text-gray-400">{quote.telefono}</p></td>}
                    <td className="px-5 py-4">
                      <p className="font-bold text-gray-950">{quote.servicio}</p>
                      {!showAll && <><p className="mt-1 text-xs text-gray-500">{quote.empresa}</p><p className="mt-1 text-xs text-gray-400">{[quote.contacto, quote.telefono, quote.correo].filter(Boolean).join(" · ") || "Contacto pendiente"}</p></>}
                    </td>
                    <td className="px-5 py-4"><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Enviada</span></td>
                    <td className="px-5 py-4 text-right font-bold">{money.format(quote.montoCotizado)}</td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="0.01" value={quote.montoFacturado} onChange={(event) => updateQuote(quote.id, { montoFacturado: Math.max(0, Number(event.target.value) || 0) })} className="w-28 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" aria-label={`Monto facturado de ${quote.empresa}`} /></td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-500">{quote.fecha ? date.format(new Date(`${quote.fecha}T12:00:00`)) : "Fecha pendiente"}</td>
                    <td className="px-5 py-4 text-right"><input type="number" min="0" step="1" value={quote.contactos} onChange={(event) => updateQuote(quote.id, { contactos: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className="w-20 rounded-xl border border-gray-300 px-3 py-2 text-right outline-none focus:border-red-600" aria-label={`Contactos de ${quote.empresa}`} /></td>
                  </tr>
                ))}
                {!visible.length && <tr><td colSpan={showAll ? 9 : 6} className="px-5 py-14 text-center text-gray-500">No hay cotizaciones para este periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
