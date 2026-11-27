import { getPresentation, logView, updateViewProgress, updateViewFeedback } from "./presentations.js";
import {
  renderSlide,
  timestampToISO,
  deckOrientation,
  normalizeTransition,
  normalizeFeedback,
  MAX_FEEDBACK_COMMENT
} from "./slide-render.js";
import { playTransition } from "./transitions.js";
import { watchAuth } from "./auth.js";

const elLoading = document.getElementById("reader-loading");
const elError = document.getElementById("reader-error");
const elReader = document.getElementById("reader");
const elFrame = document.getElementById("reader-frame");
const elContent = document.getElementById("reader-slide-content");
const elProgress = document.getElementById("reader-progress");
const elHint = document.getElementById("reader-hint");
const elTapPrev = document.getElementById("tap-prev");
const elTapNext = document.getElementById("tap-next");
const elOwnerBar = document.getElementById("reader-owner-bar");
const elOwnerSelect = document.getElementById("reader-owner-select");
const elRotate = document.getElementById("reader-rotate");

let slides = [];
let title = "";
let showTitle = false;
let writtenAt = "";
let index = 0;
let hintTimer = null;
// Calque de la page affichée ; chaque changement de page crée un nouveau calque
// pour que la transition puisse animer l'ancienne et la nouvelle page ensemble.
let currentLayer = elContent;
// Page d'avis facultative, ajoutée après la dernière page (jamais dans l'éditeur).
let feedback = normalizeFeedback(null);
let ownerMode = false;
const feedbackState = { rating: 0, comment: "", sent: false, sending: false, error: "" };

/** Nombre de pages affichées : les pages de la confidence, plus la page d'avis. */
function pageCount() {
  return slides.length + (feedback.enabled ? 1 : 0);
}

function isFeedbackPage(i) {
  return feedback.enabled && i === slides.length;
}

function buildProgress() {
  elProgress.innerHTML = "";
  Array.from({ length: pageCount() }).forEach(() => {
    const seg = document.createElement("div");
    seg.className = "reader__progress-seg";
    const fill = document.createElement("div");
    fill.className = "reader__progress-fill";
    seg.appendChild(fill);
    elProgress.appendChild(seg);
  });
}

function updateProgress() {
  const segs = elProgress.children;
  for (let i = 0; i < segs.length; i++) {
    segs[i].classList.toggle("is-done", i < index);
    segs[i].classList.toggle("is-current", i === index);
  }
}

function dismissHint() {
  if (elHint.hidden) return;
  elHint.style.opacity = "0";
  setTimeout(() => {
    elHint.hidden = true;
  }, 400);
}

/* ---- Statistiques de lecture ----
   Pour chaque consultation (hors créateur) : type d'appareil, page la plus
   loin atteinte et durée de lecture active (onglet visible). Rien qui
   permette d'identifier le lecteur. */

/** Type d'appareil, déduit de l'écran (pas de l'adresse IP ni du user-agent). */
function deviceType() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return "ordinateur";
  const shortSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  return shortSide < 600 ? "mobile" : "tablette";
}

const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

const tracker = {
  presentationId: null,
  viewId: null,
  slideCount: 0,
  maxSlide: 1,
  activeMs: 0,
  visibleSince: null,
  lastSent: null,
  timer: null,
  heartbeat: null,

  ready: null,

  start(presentationId, slideCount) {
    this.ready = this.begin(presentationId, slideCount);
    return this.ready;
  },

  /** Envoie l'avis du lecteur sur la consultation en cours. */
  async sendFeedback(rating, comment) {
    await this.ready;
    if (!this.viewId) throw new Error("no-view");
    await updateViewFeedback(this.presentationId, this.viewId, { rating, comment });
  },

  async begin(presentationId, slideCount) {
    this.presentationId = presentationId;
    this.slideCount = slideCount;
    this.maxSlide = 1;
    if (document.visibilityState === "visible") this.visibleSince = performance.now();
    try {
      this.viewId = await logView(presentationId, { device: deviceType(), slideCount });
    } catch {
      return;
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.visibleSince = performance.now();
      } else {
        this.pause();
        this.flush();
      }
    });
    window.addEventListener("pagehide", () => {
      this.pause();
      this.flush();
    });
    // Envoi régulier tant que la page est ouverte (la fermeture n'est pas
    // toujours signalée de façon fiable sur mobile).
    this.heartbeat = setInterval(() => {
      if (document.visibilityState === "visible") this.schedule();
    }, 15000);
    this.flush();
  },

  pause() {
    if (this.visibleSince !== null) {
      this.activeMs += performance.now() - this.visibleSince;
      this.visibleSince = null;
    }
  },

  durationMs() {
    const running = this.visibleSince !== null ? performance.now() - this.visibleSince : 0;
    return Math.min(MAX_DURATION_MS, Math.round(this.activeMs + running));
  },

  onSlide(i) {
    if (!this.presentationId) return;
    const reached = Math.min(this.slideCount, i + 1);
    if (reached > this.maxSlide) {
      this.maxSlide = reached;
      this.schedule(true);
    }
  },

  schedule(soon = false) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), soon ? 800 : 0);
  },

  flush() {
    clearTimeout(this.timer);
    if (!this.viewId) return;
    const payload = {
      maxSlide: this.maxSlide,
      completed: this.maxSlide >= this.slideCount,
      durationMs: this.durationMs()
    };
    const key = JSON.stringify(payload);
    if (key === this.lastSent) return;
    this.lastSent = key;
    updateViewProgress(this.presentationId, this.viewId, payload).catch(() => {
      this.lastSent = null;
    });
  }
};

/* ---- Page d'avis ---- */

const STAR_PATH =
  "M12 2.8l2.84 5.76 6.36.92-4.6 4.49 1.09 6.33L12 17.31l-5.69 2.99 1.09-6.33-4.6-4.49 6.36-.92z";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Dessine la page d'avis : le fond de la dernière page, puis un panneau avec
 * le message de l'auteur, 5 étoiles et (si demandé) un commentaire libre.
 */
function renderFeedbackPage(target) {
  const last = slides[slides.length - 1];
  renderSlide(target, { orientation: last.orientation, background: last.background, text: {}, image: {} });

  const wrap = el("div", "feedback");
  const panel = el("div", "feedback__panel");
  panel.style.fontFamily = `"${last.text?.font || "Inter"}", system-ui, sans-serif`;
  wrap.appendChild(panel);
  target.appendChild(wrap);

  panel.appendChild(el("p", "feedback__message", feedback.message));

  const stars = el("div", "feedback__stars");
  stars.setAttribute("role", "radiogroup");
  stars.setAttribute("aria-label", "Votre note, de 1 à 5 étoiles");
  const starButtons = [];
  const paint = (value) => {
    starButtons.forEach((b, k) => {
      b.classList.toggle("is-on", k < value);
      b.setAttribute("aria-checked", String(k + 1 === feedbackState.rating));
    });
  };
  for (let n = 1; n <= 5; n++) {
    const b = el("button", "feedback__star");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", `${n} étoile${n > 1 ? "s" : ""}`);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"></path></svg>`;
    b.disabled = feedbackState.sent;
    b.addEventListener("click", () => {
      feedbackState.rating = n;
      feedbackState.error = "";
      paint(n);
      updateSend();
    });
    b.addEventListener("pointerenter", () => !feedbackState.sent && paint(n));
    b.addEventListener("pointerleave", () => paint(feedbackState.rating));
    starButtons.push(b);
    stars.appendChild(b);
  }
  panel.appendChild(stars);
  paint(feedbackState.rating);

  if (feedbackState.sent) {
    renderFeedbackPage.updateSend = null;
    panel.appendChild(el("p", "feedback__thanks", "Merci ! Votre avis a bien été envoyé."));
  } else {
    let textarea = null;
    if (feedback.allowComment) {
      const label = el("label", "feedback__label", "Un mot pour l'auteur (facultatif)");
      textarea = el("textarea", "feedback__comment");
      textarea.maxLength = MAX_FEEDBACK_COMMENT;
      textarea.rows = 3;
      textarea.placeholder = "Votre commentaire…";
      textarea.value = feedbackState.comment;
      const id = "feedback-comment";
      textarea.id = id;
      label.htmlFor = id;
      textarea.addEventListener("input", () => {
        feedbackState.comment = textarea.value;
      });
      panel.append(label, textarea);
    }

    const send = el("button", "feedback__send", "Envoyer mon avis");
    send.type = "button";
    const status = el("p", "feedback__status");
    status.setAttribute("role", "status");
    const updateSend = () => {
      send.disabled = ownerMode || feedbackState.sending || !feedbackState.rating;
      status.textContent = ownerMode
        ? "Aperçu créateur : votre avis n'est pas enregistré."
        : feedbackState.error || (feedbackState.rating ? "" : "Choisissez une note pour envoyer votre avis.");
    };
    // Le bouton est mis à jour par les étoiles.
    renderFeedbackPage.updateSend = updateSend;
    send.addEventListener("click", async () => {
      if (ownerMode || !feedbackState.rating || feedbackState.sending) return;
      feedbackState.sending = true;
      send.textContent = "Envoi…";
      updateSend();
      try {
        await tracker.sendFeedback(feedbackState.rating, (feedbackState.comment || "").trim());
        feedbackState.sent = true;
        feedbackState.sending = false;
        // Redessine la page en mode « merci » (étoiles figées).
        renderFeedbackPage(target);
      } catch {
        feedbackState.sending = false;
        feedbackState.error = "L'envoi n'a pas abouti. Vérifiez votre connexion et réessayez.";
        send.textContent = "Envoyer mon avis";
        updateSend();
      }
    });
    panel.append(send, status);
    updateSend();
  }

  const back = el("button", "feedback__back", "‹ Revoir la confidence");
  back.type = "button";
  back.addEventListener("click", () => goTo(0));
  panel.appendChild(back);

  function updateSend() {
    renderFeedbackPage.updateSend?.();
  }
}

function slideOptionsFor(i) {
  return showTitle && i === 0 ? { title, date: writtenAt } : {};
}

/**
 * Affiche la page `i`. La transition jouée est celle de la page d'arrivée en
 * avançant, et celle de la page quittée (à l'envers) en reculant.
 */
function showSlide(i, { animate = true } = {}) {
  const from = index;
  index = i;
  const feedbackPage = isFeedbackPage(index);
  const slide = feedbackPage ? slides[slides.length - 1] : slides[index];
  elFrame.classList.remove("slide--portrait", "slide--paysage");
  elFrame.classList.add(slide.orientation === "paysage" ? "slide--paysage" : "slide--portrait");
  // Sur la page d'avis, les zones de tap ne doivent pas capter les clics du formulaire.
  elFrame.classList.toggle("is-feedback", feedbackPage);
  updateProgress();
  if (elOwnerSelect) elOwnerSelect.value = String(index);
  tracker.onSlide(index);

  const draw = (target) => {
    if (feedbackPage) renderFeedbackPage(target);
    else renderSlide(target, slide, slideOptionsFor(index));
  };

  if (!animate || from === i) {
    draw(currentLayer);
    return;
  }

  const layer = document.createElement("div");
  layer.className = "reader__content";
  draw(layer);
  elFrame.insertBefore(layer, elProgress);

  const previous = currentLayer;
  currentLayer = layer;
  const direction = i > from ? 1 : -1;
  // La page d'avis arrive (et repart) en fondu.
  const transition =
    isFeedbackPage(i) || isFeedbackPage(from)
      ? { type: "fade", speed: "normal" }
      : normalizeTransition(direction > 0 ? slides[i] : slides[from]);
  playTransition({
    stage: elFrame,
    fromEl: previous,
    toEl: layer,
    type: transition.type,
    speed: transition.speed,
    direction
  }).then(() => previous.remove());
}

function bounce(direction) {
  elFrame.style.setProperty("--bounce", direction > 0 ? "14px" : "-14px");
  elFrame.classList.remove("reader__bounce");
  void elFrame.offsetWidth;
  elFrame.classList.add("reader__bounce");
}

function goTo(i) {
  dismissHint();
  if (i < 0 || i >= pageCount()) {
    bounce(i < 0 ? -1 : 1);
    return;
  }
  showSlide(i);
  // Le conseil de rotation n'est proposé que sur la première page affichée.
  if (i !== startIndex) dismissRotateHint();
}

/* ---- Conseil de rotation (mobile) ----
   Sur téléphone ou tablette, si l'écran n'est pas dans le sens des pages
   (écran vertical pour des pages paysage, ou l'inverse), on propose de pivoter.
   Le conseil disparaît dès que l'écran est dans le bon sens, ou définitivement
   quand on quitte la première page sans avoir tourné. */
const touchDevice = window.matchMedia("(pointer: coarse) and (hover: none)");
const portraitScreen = window.matchMedia("(orientation: portrait)");
let deckIsPaysage = false;
let rotateDismissed = false;
let startIndex = 0;
let rotateAutoHideTimer = null;
// Le conseil s'efface de lui-même au bout de ce délai.
const ROTATE_HINT_DURATION_MS = 2000;

function isMismatched() {
  return touchDevice.matches && portraitScreen.matches === deckIsPaysage;
}

function updateRotateHint() {
  if (!elRotate) return;
  const show = !rotateDismissed && isMismatched();
  if (show) {
    elRotate.hidden = false;
    requestAnimationFrame(() => elRotate.classList.add("is-visible"));
    // Disparition automatique 2 s après l'apparition (une seule fois).
    if (!rotateAutoHideTimer) {
      rotateAutoHideTimer = setTimeout(dismissRotateHint, ROTATE_HINT_DURATION_MS);
    }
  } else if (!elRotate.hidden) {
    elRotate.classList.remove("is-visible");
    setTimeout(() => {
      if (!elRotate.classList.contains("is-visible")) elRotate.hidden = true;
    }, 350);
  }
}

function dismissRotateHint() {
  if (rotateDismissed) return;
  rotateDismissed = true;
  clearTimeout(rotateAutoHideTimer);
  updateRotateHint();
}

function setupRotateHint() {
  if (!elRotate) return;
  deckIsPaysage = slides[0]?.orientation === "paysage";
  elRotate.classList.toggle("reader__rotate--to-paysage", deckIsPaysage);
  elRotate.querySelector(".reader__rotate-label").textContent = deckIsPaysage
    ? "Tournez votre téléphone à l'horizontale pour un meilleur affichage"
    : "Tournez votre téléphone à la verticale pour un meilleur affichage";
  updateRotateHint();
  portraitScreen.addEventListener?.("change", updateRotateHint);
  window.addEventListener("orientationchange", () => setTimeout(updateRotateHint, 150));
}

function next() {
  goTo(index + 1);
}

function prev() {
  goTo(index - 1);
}

elTapPrev.addEventListener("click", prev);
elTapNext.addEventListener("click", next);

document.addEventListener("keydown", (e) => {
  if (e.target === elOwnerSelect) return;
  // Les flèches servent au curseur pendant la saisie d'un commentaire.
  if (e.target.closest?.("textarea, input, button")) return;
  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") prev();
});

let touchStartX = null;
elReader.addEventListener(
  "touchstart",
  (e) => {
    // Un glissement commencé dans le formulaire d'avis ne change pas de page.
    touchStartX = e.target.closest?.(".feedback__panel") ? null : e.touches[0].clientX;
  },
  { passive: true }
);
elReader.addEventListener(
  "touchend",
  (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      dx < 0 ? next() : prev();
    }
    touchStartX = null;
  },
  { passive: true }
);

/** Premier état d'authentification connu (le lecteur ne demande jamais de connexion). */
function currentUser() {
  return new Promise((resolve) => {
    let unsub = null;
    let done = false;
    const finish = (user) => {
      if (done) return;
      done = true;
      resolve(user);
      if (unsub) unsub();
    };
    try {
      unsub = watchAuth(finish);
      if (done) unsub();
    } catch {
      finish(null);
    }
    // Sécurité : sans réponse rapide, on considère le lecteur comme anonyme.
    setTimeout(() => finish(null), 4000);
  });
}

/** Barre réservée au créateur : lecture non comptée + choix de la page. */
function setupOwnerBar() {
  elOwnerSelect.innerHTML = "";
  slides.forEach((slide, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    const firstLine = (slide.text?.content || "")
      .split("\n")
      .map((l) => l.replace(/[#>*_~=`\[\]()-]/g, "").trim())
      .find(Boolean);
    opt.textContent = `Page ${i + 1} / ${slides.length}${firstLine ? ` — ${firstLine.slice(0, 32)}` : ""}`;
    elOwnerSelect.appendChild(opt);
  });
  if (feedback.enabled) {
    const opt = document.createElement("option");
    opt.value = String(slides.length);
    opt.textContent = "Page d'avis (ajoutée à la fin)";
    elOwnerSelect.appendChild(opt);
  }
  elOwnerSelect.value = String(index);
  elOwnerSelect.addEventListener("change", () => {
    goTo(Number(elOwnerSelect.value));
    elOwnerSelect.blur();
  });
  elOwnerBar.hidden = false;
  elReader.classList.add("reader--owner");
}

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) return fail();

  let presentation;
  let user;
  try {
    [presentation, user] = await Promise.all([getPresentation(id), currentUser()]);
  } catch {
    return fail();
  }

  if (!presentation || !Array.isArray(presentation.slides) || presentation.slides.length === 0) {
    return fail();
  }

  // Le créateur qui relit sa confidence ne fait pas grimper le compteur.
  const isOwner = !!user && user.uid === presentation.ownerId;

  // Toutes les pages suivent l'orientation de la première.
  const orientation = deckOrientation(presentation.slides);
  slides = presentation.slides.map((slide) => ({ ...slide, orientation }));
  title = (presentation.title || "").trim();
  showTitle = !!presentation.showTitle;
  writtenAt = presentation.writtenAt || timestampToISO(presentation.createdAt);
  if (title) document.title = title;
  feedback = normalizeFeedback(presentation.feedback);
  ownerMode = isOwner;
  buildProgress();

  // Page de départ (`?slide=3`) : réservée au créateur, les lecteurs commencent
  // toujours au début.
  let start = 0;
  if (isOwner) {
    const wanted = parseInt(params.get("slide"), 10);
    if (Number.isFinite(wanted)) start = Math.min(pageCount(), Math.max(1, wanted)) - 1;
  }
  index = start;
  startIndex = start;
  showSlide(start, { animate: false });
  if (isOwner) setupOwnerBar();

  elLoading.hidden = true;
  elReader.hidden = false;

  hintTimer = setTimeout(dismissHint, 3000);
  setupRotateHint();

  if (!isOwner) tracker.start(id, slides.length);
}

function fail() {
  elLoading.hidden = true;
  elError.hidden = false;
  if (hintTimer) clearTimeout(hintTimer);
}

init();
