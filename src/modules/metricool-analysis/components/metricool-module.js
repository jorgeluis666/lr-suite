// Metricool Analysis — render del módulo
// Extraído de index.html al ocultar el módulo: la suite no carga este archivo.
// Para reactivarlo, reincorporar el código al <script> principal de index.html.

// Entrada de navegación (array de módulos en index.html):
//     {
//       id: "metricool",
//       icon: icons.megaphone,
//       title: "Metricool Analysis",
//       desc: "Lectura social media con KPIs, contenidos y recomendaciones."
//     }
//
// Enrutado en render():
//   else if (state.active === "metricool") metricoolModule();

function metricoolModule() {
  const metricoolSnapshot = readMetricoolSnapshot();
  const activeMetricool = metricoolSnapshot?.report || metricool;
  const maxViews = Math.max(1, ...activeMetricool.topPosts.map((post) => post[3]));
  const period = `${fmtDate(activeMetricool.meta.from)} - ${fmtDate(activeMetricool.meta.to)}`;
  const uploadNotice = metricoolUploadNotice
    ? `
      <div class="panel">
        <div class="toolbar">
          <div>
            <strong>${metricoolUploadNotice.title}</strong>
            <p class="small">${escapeHtml(metricoolUploadNotice.detail)}</p>
          </div>
          ${badge(metricoolUploadNotice.status)}
        </div>
      </div>
    `
    : "";
  const topRows = [...activeMetricool.topPosts]
    .sort((left, right) => right[3] - left[3])
    .map(
      (post) => `
        <article class="post-row">
          <div>
            <div class="task-meta">
              ${badge(post[0])}
              <span class="muted">${fmtDate(post[1])}</span>
            </div>
            <p class="post-title">${post[2]}</p>
            <p class="post-metrics">${fmtNumber(post[3])} vistas · ${post[4]} likes · ${fmtMetricPercent(post[5])} engagement</p>
          </div>
          <div>
            <div class="bar-track">
              <span class="bar-fill" style="width:${Math.max(8, (post[3] / maxViews) * 100)}%"></span>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  shell(`
    <section class="module">
      ${header(
        "Metricool Analysis",
        "Dashboard social media de Lima Retail con KPIs del periodo, comparativo por canal, contenidos con mejor tracción y próximos ángulos recomendados.",
        "Social Media",
        icons.megaphone,
        `<div class="metricool-actions">
          <div class="control metricool-period">${icons.calendar}<div><p class="small">Periodo Metricool</p><strong>${period}</strong></div></div>
          <button class="btn" id="metricoolUploadButton" type="button">${icons.upload} Cargar PDF</button>
          ${metricoolSnapshot ? `<button class="btn" id="metricoolResetButton" type="button">${icons.trash} Restaurar base</button>` : ""}
          <input id="metricoolPdfInput" type="file" accept=".pdf,application/pdf" hidden />
        </div>`
      )}

      <div class="panel">
        <div class="toolbar">
          <div>
            <strong>Cargar reporte Metricool</strong>
            <p class="small">Selecciona un PDF exportado desde Metricool para actualizar el periodo y KPIs del módulo.</p>
          </div>
          <button class="btn primary" id="metricoolUploadPanelButton" type="button">${icons.upload} Cargar documento</button>
        </div>
      </div>

      ${uploadNotice}

      <div class="compare-card">
        <div class="compare-left">
          <span class="compare-icon">${icons.trend}</span>
          <div>
            <p class="compare-title">${activeMetricool.meta.brand}</p>
            <p class="small">${activeMetricool.meta.handle} · ${activeMetricool.meta.days} días · ${activeMetricool.meta.source}</p>
          </div>
        </div>
        <div class="compare-grid">
          <span>Canal fuerte<strong class="up">TikTok</strong></span>
          <span>Mayor alerta<strong class="negative">Instagram</strong></span>
          <span>Top alcance<strong>${fmtNumber(559)} vistas</strong></span>
          <span>Contenido core<strong>Ads + Shopify</strong></span>
        </div>
      </div>

      <div class="metrics">
        ${activeMetricool.summary
          .map((item) => metric(item[0], fmtNumber(item[1]), item[2], item[3]))
          .join("")}
      </div>

      <div class="panel">
        <div class="panel-head">
          <strong>Comparativo por canal</strong>
          <p class="small">Instagram y TikTok del periodo Metricool</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Canal</th>
                <th class="right">Seguidores</th>
                <th>Alcance</th>
                <th class="right">Publicaciones</th>
                <th class="right">Interacciones</th>
                <th class="right">Engagement</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${activeMetricool.channels
                .map(
                  (channel) => `
                    <tr>
                      <td>
                        <strong>${channel.name}</strong>
                        <p class="small">${channel.audience}</p>
                      </td>
                      <td class="right"><strong>${fmtNumber(channel.followers)}</strong></td>
                      <td>${channel.reachLabel}</td>
                      <td class="right">${fmtNumber(channel.posts)}</td>
                      <td class="right">${fmtNumber(channel.interactions)}</td>
                      <td class="right">${fmtMetricPercent(channel.engagement)}</td>
                      <td>${badge(channel.status)}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="split metricool-split">
        <div class="panel">
          <div class="panel-head">
            <strong>Top contenido por vistas</strong>
            <p class="small">Piezas destacadas del reporte Metricool</p>
          </div>
          <div class="post-rank">${topRows}</div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <strong>Recomendaciones accionables</strong>
            <p class="small">Ángulos priorizados para la siguiente semana</p>
          </div>
          <div class="recommendation-list">
            ${activeMetricool.recommendations
              .map(
                (item) => `
                  <article class="recommendation">
                    <div class="task-meta">
                      ${badge(item[0])}
                      ${badge(item[3])}
                      <span class="muted">${item[1]}</span>
                    </div>
                    <strong>${item[2]}</strong>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `);

  const uploadInput = document.getElementById("metricoolPdfInput");
  document.querySelectorAll("#metricoolUploadButton, #metricoolUploadPanelButton").forEach((button) => {
    button.addEventListener("click", () => {
      uploadInput?.click();
    });
  });
  uploadInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) handleMetricoolPdfUpload(file);
  });
  document.getElementById("metricoolResetButton")?.addEventListener("click", () => {
    clearMetricoolReport();
    metricoolUploadNotice = {
      detail: "Se volvió a la base integrada del módulo Metricool.",
      status: "Cargado",
      title: "Reporte base restaurado"
    };
    metricoolModule();
  });
}
