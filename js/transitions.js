import { TRANSITION_SPEEDS } from "./slide-render.js";

/**
 * Animations d'entrée, décrites pour une navigation « vers l'avant ».
 * `in` anime la page qui arrive (toujours au-dessus), `out` celle qui s'en va.
 * Pour revenir en arrière, on joue la même animation à l'envers en échangeant
 * les rôles : la page quittée « repart » d'où elle était venue.
 */
const EFFECTS = {
  fade: {
    in: [{ opacity: 0 }, { opacity: 1 }]
  },
  slide: {
    in: [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }],
    out: [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }]
  },
  rise: {
    in: [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
    out: [
      { transform: "scale(1)", filter: "brightness(1)" },
      { transform: "scale(0.94)", filter: "brightness(0.45)" }
    ]
  },
  zoom: {
    in: [
      { opacity: 0, transform: "scale(1.18)" },
      { opacity: 1, transform: "scale(1)" }
    ],
    out: [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(0.9)" }
    ]
  },
  flip: {
    in: [
      { transform: "perspective(1400px) rotateY(90deg)", offset: 0 },
      { transform: "perspective(1400px) rotateY(90deg)", offset: 0.5 },
      { transform: "perspective(1400px) rotateY(0deg)", offset: 1 }
    ],
    out: [
      { transform: "perspective(1400px) rotateY(0deg)", offset: 0 },
      { transform: "perspective(1400px) rotateY(-90deg)", offset: 0.5 },
      { transform: "perspective(1400px) rotateY(-90deg)", offset: 1 }
    ]
  },
  blur: {
    in: [
      { opacity: 0, filter: "blur(18px)" },
      { opacity: 1, filter: "blur(0px)" }
    ],
    out: [{ filter: "blur(0px)" }, { filter: "blur(18px)" }]
  }
};

const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

// Animations en cours, par scène : une nouvelle transition termine la précédente.
const running = new WeakMap();

/** Termine immédiatement toute transition en cours sur `stage`. */
export function finishTransitions(stage) {
  const list = running.get(stage);
  if (!list) return;
  running.delete(stage);
  list.forEach((a) => {
    try {
      a.finish();
    } catch {
      /* animation déjà annulée */
    }
  });
}

/**
 * Joue une transition entre deux calques superposés dans `stage`.
 * `toEl` doit déjà être dans le DOM, après `fromEl`.
 * Résout quand l'animation est terminée (ou interrompue) : l'appelant peut
 * alors retirer `fromEl`.
 *
 * @param {{ stage: HTMLElement, fromEl: HTMLElement, toEl: HTMLElement,
 *           type?: string, speed?: string, direction?: 1 | -1 }} opts
 */
export function playTransition({ stage, fromEl, toEl, type = "none", speed = "normal", direction = 1 }) {
  finishTransitions(stage);
  let effect = EFFECTS[type];
  let duration = TRANSITION_SPEEDS[speed] || TRANSITION_SPEEDS.normal;
  if (effect && reducedMotion?.matches) {
    effect = EFFECTS.fade;
    duration = 180;
  }
  if (!effect || !fromEl || !toEl || typeof toEl.animate !== "function") {
    return Promise.resolve();
  }

  const backward = direction < 0;
  // En arrière, la page quittée passe au-dessus et rejoue son entrée à l'envers.
  const incoming = backward ? fromEl : toEl;
  const outgoing = backward ? toEl : fromEl;
  incoming.style.zIndex = "2";
  outgoing.style.zIndex = "1";

  const timing = {
    duration,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    fill: "both",
    direction: backward ? "reverse" : "normal"
  };
  const anims = [incoming.animate(effect.in, timing)];
  if (effect.out) anims.push(outgoing.animate(effect.out, timing));
  running.set(stage, anims);

  return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
    if (running.get(stage) === anims) running.delete(stage);
    // Retire les effets figés (fill) : la page affichée retrouve son état normal.
    anims.forEach((a) => a.cancel());
    incoming.style.zIndex = "";
    outgoing.style.zIndex = "";
  });
}
