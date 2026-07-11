window.LR_SUITE_SUPABASE = {
  url: "https://ucyhnwuxmcwnyllrdzds.supabase.co",
  anonKey: "sb_publishable_-pUyPp1cOlnYE8EjrFqKHA_2wf3Q8Dw"
};

(function installPendingButtonHitboxFix() {
  const actionSelector =
    "[data-timer-toggle], .complete[data-task-id], [data-delete-task]";

  function injectPendingHitboxStyles() {
    if (document.getElementById("lr-pending-hitbox-styles")) return;

    const style = document.createElement("style");
    style.id = "lr-pending-hitbox-styles";
    style.textContent = `
      .task-module .task {
        isolation: isolate !important;
        overflow: hidden !important;
        z-index: 0 !important;
      }

      .task-module .task:hover,
      .task-module .task:focus-within {
        z-index: 1 !important;
      }

      .task-module .task-main {
        z-index: auto !important;
      }

      .task-module .task-actions,
      .task-module .task-actions .timer-box,
      .task-module .task-actions button {
        position: relative !important;
        z-index: 20 !important;
        pointer-events: auto !important;
      }

      .task-module .task-actions button::before,
      .task-module .task-actions button::after,
      .task-module .timer-box::before,
      .task-module .timer-box::after {
        pointer-events: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  function visibleActionAtPoint(clientX, clientY) {
    const actions = Array.from(
      document.querySelectorAll(`.task-module ${actionSelector}`)
    );

    return (
      actions.find((action) => {
        if (!(action instanceof HTMLElement)) return false;
        if (action.disabled) return false;

        const style = window.getComputedStyle(action);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }

        const rect = action.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      }) || null
    );
  }

  function recoverCoveredButton(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(".task-module")) return;

    // Cuando el botón recibe el evento normalmente, dejamos trabajar
    // a sus listeners originales.
    if (target.closest(actionSelector)) return;

    const action = visibleActionAtPoint(event.clientX, event.clientY);
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Ejecuta el mismo clic nativo y conserva toda la lógica existente
    // de Iniciar, Terminar y Borrar.
    action.click();
  }

  function installFix() {
    injectPendingHitboxStyles();

    if (document.documentElement.dataset.lrPendingHitboxFix === "v3") return;
    document.documentElement.dataset.lrPendingHitboxFix = "v3";

    const pressEvent = "PointerEvent" in window ? "pointerdown" : "mousedown";
    document.addEventListener(pressEvent, recoverCoveredButton, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFix, { once: true });
  } else {
    installFix();
  }
})();
