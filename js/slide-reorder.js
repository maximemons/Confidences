/**
 * Réorganisation des miniatures de la bande de pages par glisser-déposer.
 *
 * - Souris / stylet : on clique sur une miniature et on la fait glisser.
 * - Tactile : appui long (~350 ms) sur une miniature, puis on la fait glisser.
 *   Un glissement rapide sans appui long continue de faire défiler la bande.
 * - Échap annule le déplacement en cours.
 *
 * Le module écoute la bande par délégation d'événements : il survit donc aux
 * re-rendus de la bande (les miniatures doivent porter `data-index`).
 */

const LONG_PRESS_MS = 350;
const TOUCH_TOLERANCE = 8; // px de mouvement tolérés pendant l'appui long
const MOUSE_THRESHOLD = 6; // px avant de démarrer un glisser à la souris
const EDGE_ZONE = 48; // px près des bords qui déclenchent le défilement auto
const EDGE_SPEED = 14; // px par image au maximum

export function enableSlideReorder(strip, { onReorder, onCancel } = {}) {
  let pending = null; // appui en cours, glisser pas encore démarré
  let drag = null; // glisser en cours
  let suppressClick = false;

  const thumbs = () => Array.from(strip.querySelectorAll(".slide-thumb"));

  /* ---------- Démarrage ---------- */

  strip.addEventListener("pointerdown", (e) => {
    if (drag || pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Les boutons posés sur une miniature (dupliquer…) ne lancent pas de déplacement.
    if (e.target.closest(".slide-thumb__action")) return;
    const thumb = e.target.closest(".slide-thumb");
    if (!thumb || !strip.contains(thumb)) return;
    if (strip.querySelectorAll(".slide-thumb").length < 2) return;

    pending = {
      thumb,
      pointerId: e.pointerId,
      type: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      timer: null
    };

    if (e.pointerType === "touch") {
      thumb.classList.add("is-pressing");
      pending.timer = setTimeout(() => {
        if (!pending) return;
        if (navigator.vibrate) {
          try {
            navigator.vibrate(12);
          } catch {
            /* ignoré */
          }
        }
        startDrag(pending.lastX, pending.lastY);
      }, LONG_PRESS_MS);
    }
  });

  function clearPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.thumb.classList.remove("is-pressing");
    pending = null;
  }

  function startDrag(x, y) {
    const { thumb, pointerId } = pending;
    clearPending();

    const rect = thumb.getBoundingClientRect();
    const ghost = thumb.cloneNode(true);
    ghost.classList.remove("is-pressing");
    ghost.classList.add("slide-thumb--ghost");
    ghost.removeAttribute("data-index");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);

    drag = {
      thumb,
      pointerId,
      ghost,
      offsetX: x - rect.left,
      offsetY: y - rect.top,
      x,
      y,
      initialOrder: thumbs().map((el) => Number(el.dataset.index)),
      raf: 0
    };

    thumb.classList.add("is-drag-source");
    strip.classList.add("is-reordering");
    document.documentElement.classList.add("is-dragging-slide");
    positionGhost();
    drag.raf = requestAnimationFrame(autoScrollLoop);
  }

  /* ---------- Déplacement ---------- */

  window.addEventListener("pointermove", (e) => {
    if (pending && e.pointerId === pending.pointerId) {
      pending.lastX = e.clientX;
      pending.lastY = e.clientY;
      const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (pending.type === "touch") {
        // On a bougé avant la fin de l'appui long : c'est un défilement.
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
    positionGhost();
    updatePlaceholder();
  });

  // Pendant un glisser tactile, on bloque le défilement natif de la page/bande.
  strip.addEventListener(
    "touchmove",
    (e) => {
      if (drag) e.preventDefault();
    },
    { passive: false }
  );

  function positionGhost() {
    drag.ghost.style.transform = `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0) scale(1.08)`;
  }

  /** Place la miniature déplacée à l'endroit visé, avec une petite animation (FLIP). */
  function updatePlaceholder() {
    const source = drag.thumb;
    if (!source.isConnected) {
      cancelDrag();
      return;
    }
    const others = thumbs().filter((el) => el !== source);
    let before = null;
    for (const el of others) {
      const r = el.getBoundingClientRect();
      if (drag.x < r.left + r.width / 2) {
        before = el;
        break;
      }
    }
    const reference = before || strip.querySelector(".slide-thumb-add");
    if (source.nextElementSibling === reference) return;
    if (!before && others.length && others[others.length - 1].nextElementSibling === source) return;

    const first = new Map(others.map((el) => [el, el.getBoundingClientRect().left]));
    strip.insertBefore(source, reference);
    for (const el of others) {
      const dx = first.get(el) - el.getBoundingClientRect().left;
      if (!dx) continue;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
      el.getBoundingClientRect(); // force le recalcul
      el.style.transition = "";
      el.style.transform = "";
    }
  }

  function autoScrollLoop() {
    if (!drag) return;
    const r = strip.getBoundingClientRect();
    let delta = 0;
    if (drag.x < r.left + EDGE_ZONE) {
      delta = -EDGE_SPEED * Math.min(1, (r.left + EDGE_ZONE - drag.x) / EDGE_ZONE);
    } else if (drag.x > r.right - EDGE_ZONE) {
      delta = EDGE_SPEED * Math.min(1, (drag.x - (r.right - EDGE_ZONE)) / EDGE_ZONE);
    }
    if (delta) {
      const before = strip.scrollLeft;
      strip.scrollLeft += delta;
      if (strip.scrollLeft !== before) updatePlaceholder();
    }
    if (drag) drag.raf = requestAnimationFrame(autoScrollLoop);
  }

  /* ---------- Fin ---------- */

  function teardown() {
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.thumb.classList.remove("is-drag-source");
    strip.classList.remove("is-reordering");
    document.documentElement.classList.remove("is-dragging-slide");
    thumbs().forEach((el) => {
      el.style.transition = "";
      el.style.transform = "";
    });
    // Le clic qui suit un relâchement ne doit pas sélectionner une page.
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    drag = null;
  }

  function finishDrag() {
    const { thumb, initialOrder } = drag;
    const connected = thumb.isConnected;
    const order = connected ? thumbs().map((el) => Number(el.dataset.index)) : initialOrder;
    const draggedIndex = Number(thumb.dataset.index);
    teardown();
    const changed = order.some((v, i) => v !== initialOrder[i]);
    if (connected && changed) onReorder?.(order, draggedIndex);
    else onCancel?.();
  }

  function cancelDrag() {
    if (!drag) return;
    teardown();
    onCancel?.();
  }

  window.addEventListener("pointerup", (e) => {
    if (pending && e.pointerId === pending.pointerId) clearPending();
    if (drag && e.pointerId === drag.pointerId) finishDrag();
  });

  window.addEventListener("pointercancel", (e) => {
    if (pending && e.pointerId === pending.pointerId) clearPending();
    if (drag && e.pointerId === drag.pointerId) cancelDrag();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drag) cancelDrag();
  });

  window.addEventListener("blur", () => {
    clearPending();
    cancelDrag();
  });

  strip.addEventListener(
    "click",
    (e) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  // Pas de menu contextuel ni de glisser natif des images pendant l'appui long.
  strip.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".slide-thumb")) e.preventDefault();
  });
  strip.addEventListener("dragstart", (e) => e.preventDefault());

  return {
    isDragging: () => Boolean(drag)
  };
}
