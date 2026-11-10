/* Vista local: no escribe presupuestos ni inventa un histórico a partir del acumulado. */
(function (global) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (value, currency = "PEN") => new Intl.NumberFormat("es-PE", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  const dateLabel = (date) => new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
  const dayBefore = (date) => new Date(Date.parse(date + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
  let cleanup = () => {};
  let saved = {};

  // Fixture determinista independiente de los importes reales. Cada total suma las mismas marcas.
  function demoRows(marcas, mes, hasta) {
    const rows = [];
    const end = Number(hasta.slice(-2));
    marcas.forEach((brand) => {
      const seed = Array.from(brand.marca).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
      for (let day = 1; day <= end; day++) {
        rows.push({ marca: brand.marca, fecha: `${mes}-${String(day).padStart(2, "0")}`, monto: (1500 + seed % 7000 + (seed % 17 + day * 379) % 2500) / 100 });
      }
    });
    return rows;
  }

  function series(rows, marca, desde, hasta) {
    const days = new Map();
    rows.forEach((row) => {
      if ((!marca || row.marca === marca) && row.fecha >= desde && row.fecha <= hasta) {
        days.set(row.fecha, (days.get(row.fecha) || 0) + row.monto);
      }
    });
    return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, monto]) => ({ fecha, monto }));
  }

  function variation(current, previous) {
    if (current == null || previous == null) return { delta: null, percent: null };
    return { delta: current - previous, percent: previous === 0 ? null : (current - previous) / previous * 100 };
  }

  function pick(marcas, current, random = Math.random) {
    const pool = marcas.filter((brand) => brand.marca !== current);
    if (!pool.length) return marcas[0]?.marca || "";
    const weight = (brand) => brand.estado?.tono === "rose" ? 6 : brand.estado?.tono === "amber" ? 3 : 1;
    let target = random() * pool.reduce((sum, brand) => sum + weight(brand), 0);
    return (pool.find((brand) => (target -= weight(brand)) < 0) || pool[pool.length - 1]).marca;
  }

  // Gráfico de apoyo, no protagonista: son datos simulados y lo único que tienen que contar es la
  // forma de la curva. Antes medía 800x230 y, al estirarse al ancho del panel, pasaba de 300 px de
  // alto y empujaba el pacing por marca —que sí son datos reales— fuera de la pantalla.
  function chart(points, currency) {
    if (!points.length) return '<p class="gd-empty">No hay datos en el período elegido.</p>';
    const width = 900, height = 96, left = 44, right = 10, top = 8, bottom = 18;
    const ceiling = Math.max(100, Math.ceil(Math.max(...points.map((p) => p.monto)) / 100) * 100);
    const x = (i) => left + (points.length === 1 ? (width - left - right) / 2 : i * (width - left - right) / (points.length - 1));
    const y = (value) => height - bottom - value / ceiling * (height - top - bottom);
    // Tres líneas en vez de cinco: con esta altura, cinco quedaban pegadas y no se leían.
    const grid = Array.from({ length: 3 }, (_, i) => {
      const value = ceiling * i / 2;
      return `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" class="gd-grid"/><text x="${left - 6}" y="${y(value) + 3}" text-anchor="end">${Math.round(value)}</text>`;
    }).join("");
    // Un punto cada pocos días, no uno por día: así la línea se lee como una tendencia. El título
    // de cada punto sigue dando la cifra exacta al pasar el cursor.
    const cada = Math.max(1, Math.ceil(points.length / 8));
    const dots = points.map((p, i) => {
      const hito = i === 0 || i === points.length - 1 || i % cada === 0;
      const punto = hito ? `<circle cx="${x(i)}" cy="${y(p.monto)}" r="2.5" tabindex="0"><title>${dateLabel(p.fecha)}: ${esc(money(p.monto, currency))}</title></circle>` : "";
      return punto + (hito ? `<text x="${x(i)}" y="${height - 5}" text-anchor="middle">${dateLabel(p.fecha)}</text>` : "");
    }).join("");
    return `<svg class="gd-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gasto diario de ejemplo del ${esc(dateLabel(points[0].fecha))} al ${esc(dateLabel(points.at(-1).fecha))}">${grid}<polyline points="${points.map((p, i) => `${x(i)},${y(p.monto)}`).join(" ")}"/>${dots}</svg>`;
  }

  function mount(root, { mes, hasta, marcas }) {
    cleanup();
    if (!/^\d{4}-\d{2}$/.test(mes) || !marcas.length) { root.hidden = true; return; }
    root.hidden = false;
    const min = `${mes}-01`;
    const monthEnd = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0)).toISOString().slice(0, 10);
    const reportEnd = String(hasta || "").slice(0, 10);
    const max = /^\d{4}-\d{2}-\d{2}$/.test(reportEnd) && reportEnd >= min && reportEnd <= monthEnd ? reportEnd : monthEnd;
    if (saved.mes !== mes) saved = { mes, marca: "", desde: min, hasta: max };
    if (!marcas.some((brand) => brand.marca === saved.marca)) saved.marca = "";
    saved.desde = saved.desde >= min && saved.desde <= max ? saved.desde : min;
    saved.hasta = saved.hasta >= saved.desde && saved.hasta <= max ? saved.hasta : max;
    const rows = demoRows(marcas, mes, max);
    const currency = marcas[0].moneda || "PEN";
    let active = marcas.find((brand) => ["rose", "amber"].includes(brand.estado?.tono))?.marca || marcas[0].marca;
    let history = [active], position = 0, remaining = 8;
    let paused = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
    root.innerHTML = `<header class="gd-header"><div><h2>Variación del gasto diario</h2><p class="small" data-gd-subtitle></p></div><div class="gd-filters"><label>Marca<select data-gd-brand><option value="">Todas las marcas</option>${marcas.map((brand) => `<option value="${esc(brand.marca)}">${esc(brand.marca)}</option>`).join("")}</select></label><fieldset><legend>Rango de fechas</legend><label>Desde<input type="date" data-gd-from min="${min}" max="${max}"/></label><label>Hasta<input type="date" data-gd-to min="${min}" max="${max}"/></label></fieldset></div></header>
      <div class="gd-review"><div><span class="small">Revisión automática de marcas · Aleatorio, prioriza anomalías del informe mensual</span><div data-gd-review></div></div><div class="gd-controls"><button type="button" data-gd-view>Ver marca</button><button type="button" data-gd-prev aria-label="Marca anterior">‹</button><button type="button" data-gd-pause></button><button type="button" data-gd-next aria-label="Siguiente marca">›</button><span class="small" data-gd-count></span></div></div>
      <p class="gd-demo">Datos de ejemplo · El gráfico y el indicador son simulados; el informe disponible solo contiene acumulados mensuales.</p><p class="gd-error" data-gd-error role="alert"></p><div class="gd-body" data-gd-body></div>`;
    const find = (selector) => root.querySelector(selector);
    const from = find("[data-gd-from]"), to = find("[data-gd-to]"), select = find("[data-gd-brand]");
    from.value = saved.desde; to.value = saved.hasta; select.value = saved.marca;

    function renderData() {
      const points = series(rows, saved.marca, saved.desde, saved.hasta);
      const last = points.at(-1);
      // La comparación usa el día calendario anterior, aunque quede fuera del rango visible.
      const previous = last ? series(rows, saved.marca, dayBefore(last.fecha), dayBefore(last.fecha))[0] : null;
      const change = variation(last?.monto, previous?.monto);
      find("[data-gd-subtitle]").textContent = `${dateLabel(saved.desde)} – ${dateLabel(saved.hasta)} · ${saved.marca || "Total de todas las marcas"}`;
      find("[data-gd-body]").innerHTML = `<div class="gd-kpi"><span class="small">Último día del período${last ? ` · ${dateLabel(last.fecha)}` : ""}</span><div class="gd-value">${last ? esc(money(last.monto, currency)) : "—"}</div><strong class="gd-change">${change.percent == null ? "Sin base de comparación" : `${change.percent > 0 ? "↑ +" : change.percent < 0 ? "↓ " : ""}${change.percent.toFixed(1)}%`}</strong><p class="small">vs. día anterior${previous ? ` (${dateLabel(previous.fecha)})` : ""}</p><p class="small">Día anterior: ${previous ? esc(money(previous.monto, currency)) : "Sin datos"}<br/>Diferencia: ${change.delta == null ? "—" : `${change.delta > 0 ? "+" : ""}${esc(money(change.delta, currency))}`}</p></div><div class="gd-plot"><strong>Gasto diario (${esc(currency)})</strong>${chart(points, currency)}<details><summary>Ver datos diarios de ejemplo</summary><table><thead><tr><th>Fecha</th><th>Gasto</th></tr></thead><tbody>${points.map((p) => `<tr><td>${esc(p.fecha)}</td><td>${esc(money(p.monto, currency))}</td></tr>`).join("")}</tbody></table></details></div>`;
    }

    function renderReview() {
      const brand = marcas.find((item) => item.marca === active);
      const tone = brand.estado?.tono === "rose" ? "rose" : brand.estado?.tono === "amber" ? "amber" : "neutral";
      find("[data-gd-review]").innerHTML = `<div class="gd-review-title"><strong>${esc(brand.marca)}</strong><span class="gd-status ${tone}">${esc(brand.estado?.texto || "Sin estado")}</span></div><p class="small">${brand.presupuesto ? `${(brand.consumido * 100).toFixed(1)}% consumido` : "Sin presupuesto"} · ${(brand.avanceMes * 100).toFixed(0)}% del mes transcurrido · Proyección: ${esc(money(brand.proyeccion, brand.moneda || currency))}${brand.sinCambio ? " · Hay cuentas sin tipo de cambio" : ""}</p>`;
      find("[data-gd-prev]").disabled = position === 0;
      find("[data-gd-next]").disabled = marcas.length < 2;
      find("[data-gd-pause]").textContent = paused ? "Reanudar" : "Pausar";
      find("[data-gd-pause]").setAttribute("aria-pressed", String(paused));
      find("[data-gd-count]").textContent = marcas.length < 2 ? "Una marca disponible" : paused ? "Rotación pausada" : `Siguiente en ${remaining} s`;
    }

    function next() {
      if (position < history.length - 1) active = history[++position];
      else { active = pick(marcas, active); history.push(active); position++; }
      if (history.length > 100) { history.shift(); position--; }
      remaining = 8; renderReview();
    }

    select.onchange = () => { saved.marca = select.value; renderData(); };
    function updateDates() {
      const valid = from.value && to.value && from.validity.valid && to.validity.valid && from.value <= to.value;
      find("[data-gd-error]").textContent = valid ? "" : "Elige un rango válido dentro del informe; Desde debe ser anterior o igual a Hasta. Se mantiene el período anterior.";
      from.setAttribute("aria-invalid", String(!valid)); to.setAttribute("aria-invalid", String(!valid));
      if (valid) { saved.desde = from.value; saved.hasta = to.value; renderData(); }
    }
    from.onchange = to.onchange = updateDates;
    find("[data-gd-next]").onclick = next;
    find("[data-gd-prev]").onclick = () => { if (position) active = history[--position]; remaining = 8; renderReview(); };
    find("[data-gd-pause]").onclick = () => { paused = !paused; remaining = 8; renderReview(); };
    find("[data-gd-view]").onclick = () => { saved.marca = active; select.value = active; renderData(); };
    renderData(); renderReview();
    const timer = global.setInterval(() => {
      if (!root.isConnected) { cleanup(); return; }
      if (paused || document.hidden || marcas.length < 2 || root.querySelector(".gd-review:focus-within") || root.querySelector(".gd-review:hover")) return;
      if (--remaining <= 0) next();
      else find("[data-gd-count]").textContent = `Siguiente en ${remaining} s`;
    }, 1000);
    cleanup = () => { global.clearInterval(timer); };
  }

  global.LRGastoDiario = { mount, unmount: () => cleanup(), demoRows, series, variation, pick };
})(window);
