// Glisser-déposer d'une confidence (carte) vers une ligne de catégorie.
// - Souris : on attrape la carte et on la fait glisser (seuil de quelques px).
// - Tactile : appui long (~0,35 s) puis glisser ; bouger avant = défilement.
// La page défile automatiquement près du haut / bas de l'écran ; Échap annule.

const LONG_PRESS_MS = 350;
const TOUCH_TOLERANCE = 10;
const MOUSE_THRESHOLD = 6;
const EDGE = 70;
const MAX_SPEED = 16;

/**
 * @param {HTMLElement} root  conteneur des lignes (.cat-row) et cartes (.pres-card)
 * @param {{ onDrop: (presentationId: string, categoryId: string | null) => void }} options
 */
export function enableCategoryDrag(root, { onDrop }) {
  let pending = null;
  let drag = null;
  let suppressClick = false;

  root.addEventListener("pointerdown", (e) => {
    if (drag || pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Les boutons et champs de la carte gardent leur comportement normal.
    if (e.target.closest("button, a, input, select, textarea")) return;
    const card = e.target.closest(".pres-card[data-id]");
    if (!card || !root.contains(card)) return;

    pending = {
      card,
      pointerId: e.pointerId,
      type: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      timer: null
    };
    if (e.pointerType === "touch") {
      card.classList.add("is-pressing");
      pending.timer = setTimeout(() => {
        if (!pending) return;
        try {
          navigator.vibrate?.(12);
        } catch {
          /* ignoré */
        }
        startDrag(pending.lastX, pending.lastY);
      }, LONG_PRESS_MS);
    }
  });

  function clearPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.card.classList.remove("is-pressing");
    pending = null;
  }

  function startDrag(x, y) {
    const { card, pointerId } = pending;
    clearPending();
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add("pres-card--ghost");
    ghost.removeAttribute("data-id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);

    drag = {
      card,
      pointerId,
      ghost,
      fromRow: card.closest(".cat-row"),
      target: null,
      offsetX: x - rect.left,
      offsetY: y - rect.top,
      x,
      y,
      raf: 0
    };
    card.classList.add("is-drag-source");
    root.classList.add("is-dragging");
    document.documentElement.classList.add("is-dragging-card");
    position();
    updateTarget();
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function position() {
    drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px) rotate(-1.5deg)`;
  }

  function rowAt(x, y) {
    // Le fantôme ignore les pointeurs (CSS) : on lit l'élément en dessous.
    const el = document.elementFromPoint(x, y);
    const row = el?.closest?.(".cat-row");
    return row && root.contains(row) ? row : null;
  }

  function updateTarget() {
    const row = rowAt(drag.x, drag.y);
    if (row === drag.target) return;
    drag.target?.classList.remove("is-drop-target");
    drag.target = row;
    // Déposer dans sa propre ligne ne change rien : pas de surbrillance.
    if (row && row !== drag.fromRow) row.classList.add("is-drop-target");
  }

  function autoScroll() {
    if (!drag) return;
    const h = window.innerHeight;
    let dy = 0;
    if (drag.y < EDGE) dy = -MAX_SPEED * (1 - drag.y / EDGE);
    else if (drag.y > h - EDGE) dy = MAX_SPEED * (1 - (h - drag.y) / EDGE);
    if (dy) {
      window.scrollBy(0, dy);
      updateTarget();
    }
    // Défilement horizontal de la ligne survolée, près de ses bords.
    const strip = drag.target?.querySelector(".cat-row__cards");
    if (strip) {
      const r = strip.getBoundingClientRect();
      if (drag.x < r.left + EDGE) strip.scrollLeft -= MAX_SPEED * 0.6;
      else if (drag.x > r.right - EDGE) strip.scrollLeft += MAX_SPEED * 0.6;
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  window.addEventListener("pointermove", (e) => {
    if (pending && e.pointerId === pending.pointerId) {
      pending.lastX = e.clientX;
      pending.lastY = e.clientY;
      const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (pending.type === "touch") {
        if (dist > TOUCH_TOLERANCE) clearPending();
      } else if (dist > MOUSE_THRESHOLD) {
        startDrag(e.clientX, e.clientY);
      }
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.x = e.clientX;
    drag.y = e.clientY;
    position();
    updateTarget();
  });

  // Pendant un glisser tactile, la page ne doit pas défiler sous le doigt.
  window.addEventListener(
    "touchmove",
    (e) => {
      if (drag) e.preventDefault();
    },
    { passive: false }
  );

  function teardown() {
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.card.classList.remove("is-drag-source");
    drag.target?.classList.remove("is-drop-target");
    root.classList.remove("is-dragging");
    document.documentElement.classList.remove("is-dragging-card");
    // Le relâchement produit un "click" sur la carte : on l'ignore.
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }

  function finish() {
    const { card, target, fromRow } = drag;
    teardown();
    drag = null;
    if (!target || target === fromRow) return;
    const categoryId = target.dataset.categoryId || null;
    onDrop(card.dataset.id, categoryId);
  }

  function cancel() {
    if (!drag) return;
    teardown();
    drag = null;
  }

  window.addEventListener("pointerup", (e) => {
    if (pending && e.pointerId === pending.pointerId) clearPending();
    if (drag && e.pointerId === drag.pointerId) finish();
  });
  window.addEventListener("pointercancel", (e) => {
    if (pending && e.pointerId === pending.pointerId) clearPending();
    if (drag && e.pointerId === drag.pointerId) cancel();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancel();
  });
  window.addEventListener("blur", () => {
    clearPending();
    cancel();
  });

  root.addEventListener(
    "click",
    (e) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );
  root.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".pres-card")) e.preventDefault();
  });
  root.addEventListener("dragstart", (e) => e.preventDefault());
}
