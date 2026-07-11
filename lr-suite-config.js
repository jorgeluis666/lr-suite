window.LR_SUITE_SUPABASE = {
  url: "https://ucyhnwuxmcwnyllrdzds.supabase.co",
  anonKey: "sb_publishable_-pUyPp1cOlnYE8EjrFqKHA_2wf3Q8Dw"
};

(function installPendingCompatibilityFixes() {
  const actionSelector =
    "[data-timer-toggle], .complete[data-task-id], [data-delete-task]";

  function generatedTaskId() {
    return (
      "task-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(16).slice(2, 8)
    );
  }

  function installUniqueTaskIdMigration() {
    if (
      typeof window.ensureTaskIds !== "function" ||
      typeof window.taskId !== "function"
    ) {
      return false;
    }

    if (window.ensureTaskIds.__lrUniqueTaskIdMigration) return true;

    const originalEnsureTaskIds = window.ensureTaskIds;
    const originalTaskId = window.taskId;

    function ensureUniqueTaskIds() {
      const seen = new Map();
      let repairedCount = 0;
      const currentTaskId = window.taskId;

      window.taskId = function uniqueTaskIdForMigration(task, index) {
        let id = String(originalTaskId(task, index) || "").trim();
        const previousTask = seen.get(id);

        if (!id || (previousTask && previousTask !== task)) {
          do {
            id = generatedTaskId();
          } while (seen.has(id));

          if (Array.isArray(task)) task[6] = id;
          repairedCount += 1;
        }

        seen.set(id, task);
        return id;
      };

      try {
        originalEnsureTaskIds();
      } finally {
        window.taskId = currentTaskId;
      }

      if (repairedCount > 0) {
        window.setTimeout(() => {
          window.saveTaskState?.({
            reason: "reparar-identificadores-duplicados"
          });

          if (document.querySelector(".task-module")) {
            window.tasksModule?.();
          }
        }, 0);
      }

      return repairedCount;
    }

    ensureUniqueTaskIds.__lrUniqueTaskIdMigration = true;
    window.ensureTaskIds = ensureUniqueTaskIds;
    window.ensureTaskIds();
    return true;
  }

  function installTaskHitTestFallback() {
    if (document.documentElement.dataset.lrPendingHitTestFix === "true") {
      return;
    }

    document.documentElement.dataset.lrPendingHitTestFix = "true";

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest(".task-module")) return;

        // Si el botón recibió el clic directamente, conserva la lógica original.
        if (target.closest(actionSelector)) return;

        // Recupera una acción visible que haya quedado debajo de otra capa.
        const action = document
          .elementsFromPoint(event.clientX, event.clientY)
          .find(
            (element) =>
              element instanceof Element &&
              element.matches(actionSelector) &&
              element.closest(".task")
          );

        if (!action) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (action.matches("[data-timer-toggle]")) {
          window.toggleTaskTimer?.(action.dataset.timerToggle);
          return;
        }

        if (action.matches(".complete[data-task-id]")) {
          window.completeTask?.(action.dataset.taskId);
          return;
        }

        if (action.matches("[data-delete-task]")) {
          window.deleteTask?.(action.dataset.deleteTask);
        }
      },
      true
    );
  }

  function installFixes() {
    installTaskHitTestFallback();

    if (installUniqueTaskIdMigration()) return;

    let attempts = 0;
    const retryTimer = window.setInterval(() => {
      attempts += 1;
      if (installUniqueTaskIdMigration() || attempts >= 40) {
        window.clearInterval(retryTimer);
      }
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFixes, { once: true });
  } else {
    installFixes();
  }
})();
