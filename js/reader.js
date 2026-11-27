import { getPresentation, logView } from "./presentations.js";
import { renderSlide, timestampToISO } from "./slide-render.js";

const elLoading = document.getElementById("reader-loading");
const elError = document.getElementById("reader-error");
const elReader = document.getElementById("reader");
const elFrame = document.getElementById("reader-frame");
const elContent = document.getElementById("reader-slide-content");
const elProgress = document.getElementById("reader-progress");
const elHint = document.getElementById("reader-hint");
const elTapPrev = document.getElementById("tap-prev");
const elTapNext = document.getElementById("tap-next");

let slides = [];
let title = "";
let showTitle = false;
let writtenAt = "";
let index = 0;
let hintTimer = null;

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

function showSlide(i) {
  index = i;
  const slide = slides[index];
  renderSlide(elContent, slide, showTitle && index === 0 ? { title, date: writtenAt } : {});
  elFrame.classList.remove("slide--portrait", "slide--paysage");
  elFrame.classList.add(slide.orientation === "paysage" ? "slide--paysage" : "slide--portrait");
  updateProgress();
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

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) return fail();

  let presentation;
  try {
    presentation = await getPresentation(id);
  } catch {
    return fail();
  }

  if (!presentation || !Array.isArray(presentation.slides) || presentation.slides.length === 0) {
    return fail();
  }

  slides = presentation.slides;
  title = (presentation.title || "").trim();
  showTitle = !!presentation.showTitle;
  writtenAt = presentation.writtenAt || timestampToISO(presentation.createdAt);
  if (title) document.title = title;
  buildProgress();
  showSlide(0);

  elLoading.hidden = true;
  elReader.hidden = false;

  hintTimer = setTimeout(dismissHint, 3000);

  logView(id).catch(() => {});
}

function fail() {
  elLoading.hidden = true;
  elError.hidden = false;
  if (hintTimer) clearTimeout(hintTimer);
}

init();
