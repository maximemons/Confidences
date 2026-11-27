import { getPresentation, logView } from "./presentations.js";
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
  showSlide(start, { animate: false });
  if (isOwner) setupOwnerBar();

  elLoading.hidden = true;
  elReader.hidden = false;

  hintTimer = setTimeout(dismissHint, 3000);

  if (!isOwner) logView(id).catch(() => {});
}

function fail() {
  elLoading.hidden = true;
  elError.hidden = false;
  if (hintTimer) clearTimeout(hintTimer);
}

init();
