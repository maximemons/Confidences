import { getPresentation, logView, updateViewProgress } from "./presentations.js";
import { renderSlide, timestampToISO, deckOrientation, normalizeTransition } from "./slide-render.js";
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

function buildProgress() {
  elProgress.innerHTML = "";
  slides.forEach(() => {
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

  async start(presentationId, slideCount) {
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
  const slide = slides[index];
  elFrame.classList.remove("slide--portrait", "slide--paysage");
  elFrame.classList.add(slide.orientation === "paysage" ? "slide--paysage" : "slide--portrait");
  updateProgress();
  if (elOwnerSelect) elOwnerSelect.value = String(index);
  tracker.onSlide(index);

  if (!animate || from === i) {
    renderSlide(currentLayer, slide, slideOptionsFor(index));
    return;
  }

  const layer = document.createElement("div");
  layer.className = "reader__content";
  renderSlide(layer, slide, slideOptionsFor(index));
  elFrame.insertBefore(layer, elProgress);

  const previous = currentLayer;
  currentLayer = layer;
  const direction = i > from ? 1 : -1;
  const transition = normalizeTransition(direction > 0 ? slides[i] : slides[from]);
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
  if (i < 0 || i >= slides.length) {
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

function isMismatched() {
  return touchDevice.matches && portraitScreen.matches === deckIsPaysage;
}

function updateRotateHint() {
  if (!elRotate) return;
  const show = !rotateDismissed && isMismatched();
  if (show) {
    elRotate.hidden = false;
    requestAnimationFrame(() => elRotate.classList.add("is-visible"));
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
  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") prev();
});

let touchStartX = null;
elReader.addEventListener(
  "touchstart",
  (e) => {
    touchStartX = e.touches[0].clientX;
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
  buildProgress();

  // Page de départ (`?slide=3`) : réservée au créateur, les lecteurs commencent
  // toujours au début.
  let start = 0;
  if (isOwner) {
    const wanted = parseInt(params.get("slide"), 10);
    if (Number.isFinite(wanted)) start = Math.min(slides.length, Math.max(1, wanted)) - 1;
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
