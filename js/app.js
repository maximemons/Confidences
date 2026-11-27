import { watchAuth, signInWithGoogle, signOutUser } from "./auth.js";
import {
  createPresentation,
  watchMyPresentations,
  getPresentation,
  watchPresentation,
  renamePresentation,
  saveSlides,
  setShowTitle,
  setWrittenAt,
  deletePresentation,
  watchViews,
  emptySlide
} from "./presentations.js";
import { compressImageToDataUrl } from "./image-utils.js";
import {
  prefersNativeCamera,
  hasLiveCamera,
  captureFromCamera,
  askImageUrl,
  fetchImageFromUrl
} from "./image-sources.js";
import {
  renderSlide,
  FONT_OPTIONS,
  todayISO,
  timestampToISO,
  deckOrientation,
  normalizeTextBox,
  normalizeImage,
  normalizeTransition,
  TRANSITION_OPTIONS
} from "./slide-render.js";
import { playTransition, finishTransitions } from "./transitions.js";
import { enableSlideReorder } from "./slide-reorder.js";
import { enhanceColorInput, setRecentColorsOwner } from "./color-field.js";

// Limite technique de Firestore : 1 Mio (1 048 576 octets) par document.
// On garde ~48 Ko de marge pour les autres champs (titre, e-mail, dates, noms de champs…).
const MAX_DOC_BYTES = 1000000;

const views = {
  loading: document.getElementById("view-loading"),
  login: document.getElementById("view-login"),
  dashboard: document.getElementById("view-dashboard"),
  editor: document.getElementById("view-editor")
};

const headerUser = document.getElementById("header-user");
const headerUserPhoto = document.getElementById("header-user-photo");
const headerUserName = document.getElementById("header-user-name");

const dashboardEmpty = document.getElementById("dashboard-empty");
const presGrid = document.getElementById("pres-grid");

const editorTitle = document.getElementById("editor-title");
const fieldShowTitle = document.getElementById("field-show-title");
const fieldWrittenAtWrap = document.getElementById("field-written-at-wrap");
const fieldWrittenAt = document.getElementById("field-written-at");
const shareLink = document.getElementById("share-link");
const slideStrip = document.getElementById("slide-strip");
const previewSlide = document.getElementById("preview-slide");
const slidePosition = document.getElementById("slide-position");
const viewsCount = document.getElementById("views-count");
const viewsList = document.getElementById("views-list");
const viewsSummary = document.getElementById("views-summary");

const fieldOrientation = document.getElementById("field-orientation");
const fieldBgType = document.getElementById("field-bg-type");
const fieldBgColorWrap = document.getElementById("field-bg-color-wrap");
const fieldBgImageWrap = document.getElementById("field-bg-image-wrap");
const fieldBgColor = document.getElementById("field-bg-color");
const fieldBgImage = document.getElementById("field-bg-image");
const fieldBgImagePreview = document.getElementById("field-bg-image-preview");
const fieldText = document.getElementById("field-text");
const fieldTextCount = document.getElementById("field-text-count");
const fieldTextOverflow = document.getElementById("field-text-overflow");
const mdToolbar = document.getElementById("md-toolbar");
const fieldFont = document.getElementById("field-font");
const fieldTextColor = document.getElementById("field-text-color");
const fieldTextSize = document.getElementById("field-text-size");
const fieldTextAlign = document.getElementById("field-text-align");
const fieldBoxMode = document.getElementById("field-box-mode");
const fieldBoxHint = document.getElementById("field-box-hint");
const fieldBoxOptions = document.getElementById("field-box-options");
const fieldBoxColorWrap = document.getElementById("field-box-color-wrap");
const fieldBoxColor = document.getElementById("field-box-color");
const fieldBoxOpacity = document.getElementById("field-box-opacity");
const fieldBoxOpacityValue = document.getElementById("field-box-opacity-value");
const fieldImage = document.getElementById("field-image");
const fieldImagePreview = document.getElementById("field-image-preview");
const fieldImageFit = document.getElementById("field-image-fit");
const fieldImagePosition = document.getElementById("field-image-position");
const btnRemoveImage = document.getElementById("btn-remove-image");
const fieldBgImageCamera = document.getElementById("field-bg-image-camera");
const fieldImageCamera = document.getElementById("field-image-camera");
const fieldImagePosX = document.getElementById("field-image-pos-x");
const fieldImagePosY = document.getElementById("field-image-pos-y");
const fieldImagePosXValue = document.getElementById("field-image-pos-x-value");
const fieldImagePosYValue = document.getElementById("field-image-pos-y-value");
const fieldImageScale = document.getElementById("field-image-scale");
const fieldImageScaleValue = document.getElementById("field-image-scale-value");
const fieldImageBorderWidth = document.getElementById("field-image-border-width");
const fieldImageBorderWidthValue = document.getElementById("field-image-border-width-value");
const fieldImageBorderColor = document.getElementById("field-image-border-color");
const fieldTransition = document.getElementById("field-transition");
const fieldTransitionSpeed = document.getElementById("field-transition-speed");
const btnTransitionTest = document.getElementById("btn-transition-test");
const btnTransitionAll = document.getElementById("btn-transition-all");

const toastEl = document.getElementById("toast");
const modalRoot = document.getElementById("modal-root");

const state = {
  user: null,
  presentations: [],
  unsubPresentations: null,
  current: null,
  unsubViews: null,
  unsubDoc: null,
  slideIndex: 0
};

const APP_TITLE = "Confidences";

let toastTimer = null;
let saveTimer = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

function toast(message, ms = 2600) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, ms);
}

function confirmModal({ title, message, confirmLabel = "Confirmer", danger = false }) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h3 style="font-family:'Playfair Display',serif;font-size:1.1rem;">${title}</h3>
          <p style="color:var(--text-muted);">${message}</p>
          <div class="modal__actions">
            <button class="btn btn--ghost btn--sm" id="modal-cancel" type="button">Annuler</button>
            <button class="btn ${danger ? "btn--danger" : "btn--primary"} btn--sm" id="modal-confirm" type="button">${confirmLabel}</button>
          </div>
        </div>
      </div>`;
    const close = (result) => {
      modalRoot.innerHTML = "";
      resolve(result);
    };
    modalRoot.querySelector("#modal-cancel").addEventListener("click", () => close(false));
    modalRoot.querySelector("#modal-confirm").addEventListener("click", () => close(true));
  });
}

function showQrModal(link, title) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="text-align:center;">
        <h3 style="font-family:'Playfair Display',serif;font-size:1.1rem;">${escapeHtml(title || "Lien de partage")}</h3>
        <div id="qr-holder" class="qr-box"></div>
        <p style="word-break:break-all;font-size:.78rem;color:var(--text-muted);">${escapeHtml(link)}</p>
        <div class="modal__actions" style="justify-content:center;">
          <button class="btn btn--ghost btn--sm" id="modal-close" type="button">Fermer</button>
          <button class="btn btn--primary btn--sm" id="modal-download" type="button">Télécharger</button>
        </div>
      </div>
    </div>`;
  const holder = modalRoot.querySelector("#qr-holder");
  new QRCode(holder, {
    text: link,
    width: 200,
    height: 200,
    colorDark: "#14141c",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
  modalRoot.querySelector("#modal-close").addEventListener("click", () => {
    modalRoot.innerHTML = "";
  });
  modalRoot.querySelector("#modal-download").addEventListener("click", () => {
    const canvas = holder.querySelector("canvas");
    if (!canvas) {
      toast("Téléchargement indisponible sur ce navigateur");
      return;
    }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "confidence-qrcode.png";
    a.click();
  });
}

function formatDate(ts) {
  if (!ts?.toDate) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(ts.toDate());
}

function buildShareLink(id) {
  const url = new URL("view.html", location.href);
  url.searchParams.set("id", id);
  return url.toString();
}

/**
 * Lien d'aperçu du créateur, ouvert à une page précise (1 = première).
 * Le paramètre `slide` n'est appliqué par le lecteur que pour le créateur
 * connecté ; ses lectures ne sont pas comptées.
 */
function buildPreviewLink(id, slideNumber = 1) {
  const url = new URL(buildShareLink(id));
  if (slideNumber > 1) url.searchParams.set("slide", String(slideNumber));
  return url.toString();
}

function setSegmentedActive(container, value) {
  container.querySelectorAll("button[data-value]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === value);
  });
}

function wireSegmented(container, onChange) {
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    setSegmentedActive(container, btn.dataset.value);
    onChange(btn.dataset.value);
  });
}

function estimateDocBytes() {
  return new Blob([JSON.stringify(state.current.slides)]).size;
}

// Place restante (en octets) pour une nouvelle image sur la page courante,
// en ne comptant pas l'image qu'elle remplacerait. `clearSlot` vide
// temporairement l'emplacement visé sur une copie de la page.
function imageBudget(clearSlot) {
  const slides = state.current.slides.map((s, i) => {
    if (i !== state.slideIndex) return s;
    const copy = structuredClone(s);
    clearSlot(copy);
    return copy;
  });
  const used = new Blob([JSON.stringify(slides)]).size;
  return MAX_DOC_BYTES - used - 64;
}

/* ---------------- Auth ---------------- */

watchAuth((user) => {
  if (!user) {
    state.user = null;
    teardownEditorSubs();
    if (state.unsubPresentations) {
      state.unsubPresentations();
      state.unsubPresentations = null;
    }
    headerUser.hidden = true;
    showView("login");
    return;
  }
  state.user = user;
  setRecentColorsOwner(user.uid);
  headerUser.hidden = false;
  headerUserPhoto.src = user.photoURL || "";
  headerUserName.textContent = user.displayName || user.email || "";
  showView("dashboard");
  subscribeDashboard();
});

document.getElementById("btn-google").addEventListener("click", () => {
  signInWithGoogle().catch((err) => toast(err.message));
});

document.getElementById("btn-logout").addEventListener("click", () => {
  signOutUser();
});

/* ---------------- Dashboard ---------------- */

function subscribeDashboard() {
  if (state.unsubPresentations) state.unsubPresentations();
  state.unsubPresentations = watchMyPresentations(state.user.uid, (list) => {
    state.presentations = list;
    renderDashboard();
  });
}

function renderDashboard() {
  const list = state.presentations;
  dashboardEmpty.hidden = list.length > 0;
  presGrid.innerHTML = "";
  list.forEach((pres) => {
    const card = document.createElement("div");
    card.className = "pres-card";
    card.innerHTML = `
      <div class="pres-card__head">
        <div class="pres-card__title">${escapeHtml(pres.title || "Sans titre")}</div>
      </div>
      <div class="pres-card__meta">
        <span>${(pres.slides || []).length} page${(pres.slides || []).length > 1 ? "s" : ""}</span>
        <span>${pres.viewCount || 0} vue${(pres.viewCount || 0) > 1 ? "s" : ""}</span>
        <span>Modifié le ${formatDate(pres.updatedAt)}</span>
      </div>
      <div class="pres-card__actions">
        <button class="btn btn--sm" data-action="edit">Ouvrir</button>
        <button class="btn btn--ghost btn--sm" data-action="preview">▶ Aperçu</button>
        <button class="btn btn--ghost btn--sm" data-action="copy">⧉ Lien</button>
        <button class="btn btn--ghost btn--sm" data-action="qr">▦ QR</button>
        <button class="btn btn--danger btn--sm" data-action="delete">Supprimer</button>
      </div>`;
    card.querySelector('[data-action="edit"]').addEventListener("click", () => openEditor(pres.id));
    card.querySelector('[data-action="preview"]').addEventListener("click", () => {
      window.open(buildPreviewLink(pres.id), "_blank");
    });
    card.querySelector('[data-action="copy"]').addEventListener("click", () => copyLink(pres.id));
    card.querySelector('[data-action="qr"]').addEventListener("click", () => showQrModal(buildShareLink(pres.id), pres.title));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteFromDashboard(pres));
    presGrid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function copyLink(id) {
  navigator.clipboard
    .writeText(buildShareLink(id))
    .then(() => toast("Lien copié"))
    .catch(() => toast("Impossible de copier le lien"));
}

async function deleteFromDashboard(pres) {
  const ok = await confirmModal({
    title: "Supprimer cette confidence ?",
    message: "Cette action est définitive et supprimera toutes les pages et images associées.",
    confirmLabel: "Supprimer",
    danger: true
  });
  if (!ok) return;
  try {
    await deletePresentation(pres.id);
    toast("Confidence supprimée");
  } catch (err) {
    console.error(err);
    toast("Suppression impossible : " + err.message, 4000);
  }
}

async function createNew() {
  const id = await createPresentation(state.user.uid, state.user.email);
  openEditor(id);
}

document.getElementById("btn-new").addEventListener("click", createNew);
document.getElementById("btn-new-empty").addEventListener("click", createNew);

/* ---------------- Editor ---------------- */

FONT_OPTIONS.forEach((f) => {
  const opt = document.createElement("option");
  opt.value = f.value;
  opt.textContent = f.label;
  fieldFont.appendChild(opt);
});

function teardownEditorSubs() {
  if (state.unsubViews) {
    state.unsubViews();
    state.unsubViews = null;
  }
  if (state.unsubDoc) {
    state.unsubDoc();
    state.unsubDoc = null;
  }
}

async function openEditor(id) {
  const pres = await getPresentation(id).catch(() => null);
  if (!pres) {
    toast("Confidence introuvable");
    return;
  }
  state.current = {
    id: pres.id,
    ownerId: pres.ownerId,
    title: pres.title || "Sans titre",
    showTitle: !!pres.showTitle,
    // Older confidences have no writtenAt: fall back to their creation day.
    writtenAt: pres.writtenAt || timestampToISO(pres.createdAt) || todayISO(),
    slides: pres.slides && pres.slides.length ? pres.slides : [emptySlide()]
  };
  state.slideIndex = 0;
  // Les anciennes confidences pouvaient mélanger les orientations :
  // on aligne toutes les pages sur la première.
  if (applyOrientation(deckOrientation(state.current.slides))) flushSave(true);

  editorTitle.value = state.current.title;
  fieldShowTitle.checked = state.current.showTitle;
  fieldWrittenAt.value = state.current.writtenAt;
  fieldWrittenAtWrap.hidden = !state.current.showTitle;
  shareLink.value = buildShareLink(id);
  updateDocumentTitle();

  teardownEditorSubs();
  state.unsubViews = watchViews(id, (list) => renderViews(list));
  state.unsubDoc = watchPresentation(id, (doc) => {
    if (!doc) {
      toast("Cette confidence a été supprimée.");
      backToDashboard();
      return;
    }
    viewsCount.textContent = doc.viewCount || 0;
  });

  renderAll();
  showView("editor");
  // L'aperçu n'a de dimensions qu'une fois l'éditeur affiché.
  updateHeaderHeight();
  fitStickyPreview();
  checkTextOverflow();
}

function backToDashboard() {
  flushSave(true);
  teardownEditorSubs();
  state.current = null;
  document.title = APP_TITLE;
  showView("dashboard");
}

document.getElementById("btn-back").addEventListener("click", backToDashboard);

document.getElementById("btn-preview").addEventListener("click", () => {
  if (!state.current) return;
  flushSave(true);
  window.open(buildPreviewLink(state.current.id, state.slideIndex + 1), "_blank");
});

document.getElementById("btn-copy-link").addEventListener("click", () => {
  navigator.clipboard
    .writeText(shareLink.value)
    .then(() => toast("Lien copié"))
    .catch(() => toast("Impossible de copier le lien"));
});

document.getElementById("btn-show-qr").addEventListener("click", () => {
  if (!state.current) return;
  showQrModal(shareLink.value, state.current.title);
});

document.getElementById("btn-delete-pres").addEventListener("click", async () => {
  const ok = await confirmModal({
    title: "Supprimer cette confidence ?",
    message: "Cette action est définitive et supprimera toutes les pages et images associées.",
    confirmLabel: "Supprimer",
    danger: true
  });
  if (!ok || !state.current) return;
  clearTimeout(saveTimer);
  const id = state.current.id;
  teardownEditorSubs();
  try {
    await deletePresentation(id);
  } catch (err) {
    console.error(err);
    toast("Suppression impossible : " + err.message, 4000);
    openEditor(id);
    return;
  }
  state.current = null;
  document.title = APP_TITLE;
  showView("dashboard");
  toast("Confidence supprimée");
});

let titleTimer = null;
editorTitle.addEventListener("input", () => {
  if (state.current) {
    state.current.title = editorTitle.value.trim() || "Sans titre";
    updateDocumentTitle();
    if (state.current.showTitle) {
      renderPreview();
    }
  }
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => {
    if (!state.current) return;
    state.current.title = editorTitle.value.trim() || "Sans titre";
    renamePresentation(state.current.id, state.current.title).catch((err) => toast(err.message));
    if (state.current.showTitle) renderSlideStrip();
  }, 500);
});

fieldShowTitle.addEventListener("change", () => {
  if (!state.current) return;
  state.current.showTitle = fieldShowTitle.checked;
  fieldWrittenAtWrap.hidden = !state.current.showTitle;
  setShowTitle(state.current.id, state.current.showTitle).catch((err) => toast(err.message));
  // Make sure the date is stored for confidences created before this field existed.
  setWrittenAt(state.current.id, state.current.writtenAt).catch(() => {});
  renderAll();
});

fieldWrittenAt.addEventListener("change", () => {
  if (!state.current) return;
  // An emptied date field goes back to today.
  if (!fieldWrittenAt.value) fieldWrittenAt.value = todayISO();
  state.current.writtenAt = fieldWrittenAt.value;
  setWrittenAt(state.current.id, state.current.writtenAt).catch((err) => toast(err.message));
  renderAll();
});

function updateDocumentTitle() {
  document.title = state.current ? `${state.current.title} · ${APP_TITLE}` : APP_TITLE;
}

// Options passed to renderSlide: the title is only drawn on the first slide.
function slideOptions(index) {
  if (!state.current || !state.current.showTitle || index !== 0) return {};
  return { title: state.current.title, date: state.current.writtenAt };
}

/** Applique une orientation à toutes les pages. Renvoie true si une page a changé. */
function applyOrientation(orientation) {
  let changed = false;
  state.current.slides.forEach((slide) => {
    if (slide.orientation !== orientation) {
      slide.orientation = orientation;
      changed = true;
    }
  });
  return changed;
}

/** Redessine l'aperçu de la page courante et signale un texte qui déborde. */
function renderPreview() {
  finishTransitions(previewSlide);
  renderSlide(previewSlide, currentSlide(), slideOptions(state.slideIndex));
  fitStickyPreview();
  checkTextOverflow();
}

/* ---- Aperçu collant (desktop) ----
   Sur grand écran, l'aperçu reste visible pendant qu'on fait défiler les options.
   Si la fenêtre est trop basse pour l'afficher en entier, on le réduit avec `zoom`
   (texte compris) : les proportions restent identiques, la détection de
   débordement du texte reste donc fiable. */
const appHeader = document.querySelector(".app-header");
const editorPreview = document.querySelector(".editor-preview");
const slideNavMini = document.querySelector(".slide-nav-mini");
const desktopQuery = window.matchMedia("(min-width: 720px)");

function updateHeaderHeight() {
  if (!appHeader) return;
  document.documentElement.style.setProperty("--header-h", `${appHeader.offsetHeight}px`);
}

function fitStickyPreview() {
  if (!editorPreview || !state.current || views.editor.hidden || !desktopQuery.matches) {
    previewSlide.style.zoom = "";
    return;
  }
  const paysage = previewSlide.classList.contains("slide--paysage");
  const naturalWidth = Math.min(paysage ? 480 : 320, editorPreview.clientWidth || 320);
  const naturalHeight = paysage ? (naturalWidth * 9) / 16 : (naturalWidth * 16) / 9;
  const headerH = appHeader ? appHeader.offsetHeight : 72;
  const navH = slideNavMini ? slideNavMini.offsetHeight : 40;
  const available = window.innerHeight - headerH - 16 - 16 - 14 - navH;
  const zoom = Math.max(0.5, Math.min(1, available / naturalHeight));
  previewSlide.style.zoom = zoom < 0.999 ? zoom.toFixed(3) : "";
}

updateHeaderHeight();
if (appHeader && "ResizeObserver" in window) {
  new ResizeObserver(updateHeaderHeight).observe(appHeader);
}
desktopQuery.addEventListener?.("change", () => {
  if (state.current && !views.editor.hidden) renderPreview();
});

function checkTextOverflow() {
  const wrap = previewSlide.querySelector(".slide__text-wrap");
  let overflow = false;
  if (wrap && wrap.firstElementChild) {
    const box = previewSlide.getBoundingClientRect();
    const first = wrap.firstElementChild.getBoundingClientRect();
    const last = wrap.lastElementChild.getBoundingClientRect();
    overflow = box.height > 0 && (first.top < box.top - 1 || last.bottom > box.bottom + 1);
  }
  fieldTextOverflow.hidden = !overflow;
}

function updateTextCount() {
  fieldTextCount.textContent = `${fieldText.value.length} / ${fieldText.maxLength}`;
}

function flushSave(immediate) {
  clearTimeout(saveTimer);
  if (!state.current) return;
  const run = () => {
    if (estimateDocBytes() > MAX_DOC_BYTES) {
      toast("Cette confidence est trop volumineuse (images trop grandes). Remplacez ou retirez une image.", 4000);
      return;
    }
    saveSlides(state.current.id, state.current.slides).catch((err) => toast(err.message));
  };
  if (immediate) run();
  else saveTimer = setTimeout(run, 600);
}

function currentSlide() {
  return state.current.slides[state.slideIndex];
}

function renderAll() {
  renderSlideStrip();
  renderPreviewAndForm();
}

function renderSlideStrip() {
  slideStrip.innerHTML = "";
  state.current.slides.forEach((slide, i) => {
    const thumb = document.createElement("div");
    thumb.className = `slide-thumb slide--${slide.orientation === "paysage" ? "paysage" : "portrait"}`;
    thumb.dataset.index = i;
    thumb.title = "Cliquer pour modifier · maintenir et glisser pour déplacer";
    if (i === state.slideIndex) thumb.classList.add("is-active");
    const inner = document.createElement("div");
    inner.style.position = "absolute";
    inner.style.inset = "0";
    thumb.appendChild(inner);
    renderSlide(inner, slide, slideOptions(i));
    const badge = document.createElement("span");
    badge.className = "slide-thumb__index";
    badge.textContent = i + 1;
    thumb.appendChild(badge);
    const dup = document.createElement("button");
    dup.type = "button";
    dup.className = "slide-thumb__action slide-thumb__duplicate";
    dup.title = `Dupliquer la page ${i + 1}`;
    dup.setAttribute("aria-label", `Dupliquer la page ${i + 1}`);
    dup.innerHTML = DUPLICATE_ICON;
    dup.addEventListener("click", (e) => {
      e.stopPropagation();
      duplicateSlide(i);
    });
    thumb.appendChild(dup);
    thumb.addEventListener("click", () => {
      state.slideIndex = i;
      renderSlideStrip();
      renderPreviewAndForm();
    });
    slideStrip.appendChild(thumb);
  });
  const addBtn = document.createElement("button");
  addBtn.className = "slide-thumb-add";
  addBtn.type = "button";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", addSlide);
  slideStrip.appendChild(addBtn);
}

function renderPreviewAndForm() {
  const slide = currentSlide();
  renderPreview();
  slidePosition.textContent = `${state.slideIndex + 1} / ${state.current.slides.length}`;

  setSegmentedActive(fieldOrientation, deckOrientation(state.current.slides));
  setSegmentedActive(fieldBgType, slide.background.type);
  setSegmentedActive(fieldTextSize, slide.text.size);
  setSegmentedActive(fieldTextAlign, slide.text.align);
  normalizeTextBox(slide);
  setSegmentedActive(fieldBoxMode, slide.text.boxMode);
  updateBoxControls(slide);
  const im = normalizeImage(slide);
  setSegmentedActive(fieldImageFit, im.fit);
  updatePositionControls(im);
  fieldImageScale.value = im.scale;
  fieldImageScaleValue.textContent = im.scale;
  fieldImageBorderWidth.value = im.borderWidth;
  updateBorderWidthLabel(im.borderWidth);
  fieldImageBorderColor.value = im.borderColor;
  fieldImageBorderColor.disabled = im.borderWidth === 0;
  const tr = normalizeTransition(slide);
  fieldTransition.value = tr.type;
  setSegmentedActive(fieldTransitionSpeed, tr.speed);
  fieldTransitionSpeed.classList.toggle("is-disabled", tr.type === "none");

  fieldBgColorWrap.hidden = slide.background.type !== "color";
  fieldBgImageWrap.hidden = slide.background.type !== "image";
  fieldBgColor.value = slide.background.color || "#14141c";
  fieldBgImagePreview.src = slide.background.imageUrl || "";
  fieldBgImagePreview.style.visibility = slide.background.imageUrl ? "visible" : "hidden";

  if (document.activeElement !== fieldText) {
    fieldText.value = slide.text.content || "";
  }
  updateTextCount();
  fieldFont.value = slide.text.font || "Inter";
  fieldTextColor.value = slide.text.color || "#f5f0e8";

  fieldImagePreview.src = slide.image.url || "";
  fieldImagePreview.style.visibility = slide.image.url ? "visible" : "hidden";
  btnRemoveImage.hidden = !slide.image.url;
}

/** Affiche les réglages du fond de texte qui correspondent au mode choisi. */
function updateBoxControls(slide) {
  const t = normalizeTextBox(slide);
  fieldBoxOptions.hidden = t.boxMode === "none";
  fieldBoxColorWrap.hidden = t.boxMode !== "color";
  fieldBoxColor.value = t.boxColor;
  fieldBoxOpacity.value = t.boxOpacity;
  fieldBoxOpacityValue.textContent = t.boxOpacity;
  fieldBoxHint.hidden = t.boxMode === "color";
  fieldBoxHint.textContent =
    t.boxMode === "none"
      ? "Aucun fond derrière le texte."
      : "Auto : un fond uni (sombre ou clair selon la couleur du texte) apparaît uniquement quand la page a une photo.";
}

const DUPLICATE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/></svg>';

/**
 * Duplique une page (texte, mise en forme, images, transition) et place la
 * copie juste après l'original. Les images étant stockées dans le document,
 * la copie les duplique : si la confidence dépasserait la limite de Firestore,
 * on propose de dupliquer la page sans ses images.
 */
async function duplicateSlide(index) {
  const slides = state.current?.slides;
  if (!slides?.[index]) return;
  const copy = structuredClone(slides[index]);
  copy.id = crypto.randomUUID();
  slides.splice(index + 1, 0, copy);

  if (estimateDocBytes() > MAX_DOC_BYTES) {
    slides.splice(index + 1, 1);
    const ok = await confirmModal({
      title: "Pas assez de place",
      message:
        "Avec ses images, la copie dépasserait la taille maximale d'une confidence. Dupliquer la page sans ses images (texte, couleurs et mise en forme conservés) ?",
      confirmLabel: "Dupliquer sans images"
    });
    if (!ok || !state.current || state.current.slides !== slides) return;
    copy.image.url = "";
    copy.background.imageUrl = "";
    if (copy.background.type === "image") copy.background.type = "color";
    const at = Math.min(slides.length, index + 1);
    slides.splice(at, 0, copy);
    state.slideIndex = at;
  } else {
    state.slideIndex = index + 1;
  }
  flushSave(true);
  renderAll();
  toast(`Page ${index + 1} dupliquée`);
}

/**
 * Nouvelle page : elle est insérée juste après la page affichée et reprend ses
 * couleurs — fond (couleur ou image), couleur du texte et fond du texte.
 * Une image de fond reprise est dupliquée dans le document ; si elle ne tient
 * plus dans la limite de Firestore, la nouvelle page garde seulement la couleur.
 */
function addSlide() {
  const slide = emptySlide();
  const slides = state.current.slides;
  const previous = slides[state.slideIndex] || slides[slides.length - 1];
  const insertAt = Math.min(slides.length, state.slideIndex + 1);
  slide.orientation = deckOrientation(slides);
  if (previous) {
    const bg = previous.background || {};
    slide.background = {
      type: bg.type === "image" && bg.imageUrl ? "image" : "color",
      color: bg.color || slide.background.color,
      imageUrl: bg.type === "image" ? bg.imageUrl || "" : ""
    };
    const t = normalizeTextBox(previous);
    slide.text.color = previous.text?.color || slide.text.color;
    slide.text.boxMode = t.boxMode;
    slide.text.boxColor = t.boxColor;
    slide.text.boxOpacity = t.boxOpacity;
  }
  slides.splice(insertAt, 0, slide);
  if (slide.background.imageUrl && estimateDocBytes() > MAX_DOC_BYTES) {
    slide.background.type = "color";
    slide.background.imageUrl = "";
    toast("Plus assez de place pour reprendre l'image de fond : la nouvelle page garde seulement la couleur de fond.", 4500);
  }
  state.slideIndex = insertAt;
  flushSave(true);
  renderAll();
}

async function deleteSlide() {
  if (state.current.slides.length <= 1) {
    toast("Il faut au moins une page.");
    return;
  }
  const ok = await confirmModal({
    title: "Supprimer cette page ?",
    message: "La page et ses images seront définitivement supprimées.",
    confirmLabel: "Supprimer",
    danger: true
  });
  if (!ok) return;
  state.current.slides.splice(state.slideIndex, 1);
  state.slideIndex = Math.max(0, Math.min(state.slideIndex, state.current.slides.length - 1));
  flushSave(true);
  renderAll();
}

function moveSlide(delta) {
  const slides = state.current.slides;
  const from = state.slideIndex;
  const to = from + delta;
  if (to < 0 || to >= slides.length) return;
  [slides[from], slides[to]] = [slides[to], slides[from]];
  state.slideIndex = to;
  flushSave(true);
  renderAll();
}

/**
 * Applique un nouvel ordre issu du glisser-déposer.
 * `order` liste les anciens index dans le nouvel ordre ; la page déplacée devient la page active.
 */
function reorderSlides(order, draggedIndex) {
  const slides = state.current.slides;
  if (order.length !== slides.length) {
    renderSlideStrip();
    return;
  }
  const dragged = slides[draggedIndex];
  const reordered = order.map((i) => slides[i]);
  slides.splice(0, slides.length, ...reordered);
  state.slideIndex = Math.max(0, slides.indexOf(dragged));
  flushSave(true);
  renderAll();
}

enableSlideReorder(slideStrip, {
  onReorder: reorderSlides,
  onCancel: () => renderSlideStrip()
});

document.getElementById("btn-slide-delete").addEventListener("click", deleteSlide);
document.getElementById("btn-slide-up").addEventListener("click", () => moveSlide(-1));
document.getElementById("btn-slide-down").addEventListener("click", () => moveSlide(1));

wireSegmented(fieldOrientation, (value) => {
  applyOrientation(value);
  flushSave(true);
  renderAll();
});

wireSegmented(fieldBgType, (value) => {
  currentSlide().background.type = value;
  fieldBgColorWrap.hidden = value !== "color";
  fieldBgImageWrap.hidden = value !== "image";
  flushSave(true);
  renderAll();
});

fieldBgColor.addEventListener("input", () => {
  currentSlide().background.color = fieldBgColor.value;
  renderPreview();
});
fieldBgColor.addEventListener("change", () => flushSave(true));

/* ---------------- Champs couleur (HEX + couleurs récentes) ---------------- */

/** Couleurs déjà utilisées dans la confidence ouverte (proposées dans les champs couleur). */
function deckColors() {
  if (!state.current) return [];
  const colors = [];
  state.current.slides.forEach((s) => {
    colors.push(s.background?.color, s.text?.color);
    if (s.text?.boxMode === "color") colors.push(s.text.boxColor);
    if (s.image?.url && s.image.borderWidth > 0) colors.push(s.image.borderColor);
  });
  return colors.filter(Boolean);
}

[fieldBgColor, fieldTextColor, fieldBoxColor, fieldImageBorderColor].forEach((input) =>
  enhanceColorInput(input, { getDeckColors: deckColors })
);

/* ---------------- Import d'image : fichier, caméra ou lien ---------------- */

// Emplacements d'image d'une page : la photo affichée et le fond.
const IMAGE_SLOTS = {
  image: {
    get: (slide) => slide.image.url,
    set: (slide, url) => {
      slide.image.url = url;
    },
    clear: (s) => (s.image.url = ""),
    fileInput: fieldImage,
    cameraInput: fieldImageCamera
  },
  background: {
    get: (slide) => slide.background.imageUrl,
    set: (slide, url) => {
      slide.background.imageUrl = url;
      if (url) slide.background.type = "image";
    },
    clear: (s) => (s.background.imageUrl = ""),
    fileInput: fieldBgImage,
    cameraInput: fieldBgImageCamera
  }
};

/**
 * Compresse puis place une image dans un emplacement de la page courante.
 * La page est mémorisée au départ : changer de page pendant la compression
 * ne déplace pas l'image ailleurs.
 */
async function importImageToSlot(file, slotName) {
  if (!file || !state.current) return;
  const slot = IMAGE_SLOTS[slotName];
  const slide = currentSlide();
  const previousUrl = slot.get(slide);
  const previousBgType = slide.background.type;
  try {
    toast("Compression de l'image…", 1500);
    const dataUrl = await compressImageToDataUrl(file, imageBudget(slot.clear));
    if (!state.current || !state.current.slides.includes(slide)) return;
    slot.set(slide, dataUrl);
    if (estimateDocBytes() > MAX_DOC_BYTES) {
      slot.set(slide, previousUrl);
      slide.background.type = previousBgType;
      toast("Cette confidence serait trop volumineuse avec cette image. Retirez ou remplacez une autre image.", 4000);
    } else {
      flushSave(true);
    }
    renderAll();
  } catch (err) {
    toast(err.message, 4000);
  }
}

Object.entries(IMAGE_SLOTS).forEach(([slotName, slot]) => {
  [slot.fileInput, slot.cameraInput].forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files[0];
      input.value = "";
      importImageToSlot(file, slotName);
    });
  });
});

async function useCamera(slotName) {
  const slot = IMAGE_SLOTS[slotName];
  // Téléphone : l'appareil photo natif (meilleure qualité, flash, mise au point).
  // Ordinateur : aperçu en direct de la webcam. Sinon : sélecteur de fichier.
  if (prefersNativeCamera() || !hasLiveCamera()) {
    slot.cameraInput.click();
    return;
  }
  try {
    const file = await captureFromCamera(modalRoot);
    if (file) await importImageToSlot(file, slotName);
  } catch (err) {
    toast(err.message, 4000);
  }
}

async function useLink(slotName, group) {
  const url = await askImageUrl(modalRoot);
  if (!url) return;
  const wrap = group.closest(".image-upload");
  wrap?.classList.add("is-busy");
  try {
    toast("Récupération de l'image…", 2500);
    const file = await fetchImageFromUrl(url);
    await importImageToSlot(file, slotName);
  } catch (err) {
    toast(err.message, 5000);
  } finally {
    wrap?.classList.remove("is-busy");
  }
}

document.querySelectorAll(".image-source").forEach((group) => {
  group.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-source]");
    if (!btn || !state.current) return;
    const slotName = group.dataset.slot;
    if (btn.dataset.source === "file") IMAGE_SLOTS[slotName].fileInput.click();
    else if (btn.dataset.source === "camera") useCamera(slotName);
    else if (btn.dataset.source === "link") useLink(slotName, group);
  });
});

let textFlush = null;
fieldText.addEventListener("input", () => {
  currentSlide().text.content = fieldText.value;
  updateTextCount();
  renderPreview();
  clearTimeout(textFlush);
  textFlush = setTimeout(() => flushSave(true), 600);
});
fieldText.addEventListener("blur", () => {
  flushSave(true);
  renderSlideStrip();
});

/* ---------------- Barre d'outils Markdown ---------------- */

/**
 * Remplace la sélection du textarea. execCommand conserve l'historique
 * d'annulation (Ctrl+Z) ; à défaut on utilise setRangeText.
 * Dans tous les cas un événement "input" met à jour l'aperçu en direct.
 */
function replaceSelection(text, selectFrom, selectTo) {
  fieldText.focus();
  const start = fieldText.selectionStart;
  const max = fieldText.maxLength > 0 ? fieldText.maxLength : Infinity;
  const removed = fieldText.selectionEnd - start;
  if (fieldText.value.length - removed + text.length > max) {
    toast("Le texte atteint la longueur maximale.");
    return;
  }
  let done = false;
  try {
    done = document.execCommand("insertText", false, text);
  } catch {
    done = false;
  }
  if (!done || fieldText.value.slice(start, start + text.length) !== text) {
    fieldText.setRangeText(text, start, fieldText.selectionEnd, "end");
    fieldText.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (selectFrom !== undefined) {
    fieldText.setSelectionRange(start + selectFrom, start + (selectTo ?? selectFrom));
  }
}

/** Entoure la sélection (ou retire l'entourage s'il est déjà présent). */
function wrapSelection(marker, placeholder) {
  const { selectionStart: start, selectionEnd: end, value } = fieldText;
  const selected = value.slice(start, end);
  const len = marker.length;
  if (value.slice(start - len, start) === marker && value.slice(end, end + len) === marker) {
    fieldText.setSelectionRange(start - len, end + len);
    replaceSelection(selected, 0, selected.length);
    return;
  }
  const inner = selected || placeholder;
  replaceSelection(`${marker}${inner}${marker}`, len, len + inner.length);
}

/** Ajoute (ou retire) un préfixe à chaque ligne sélectionnée. */
function prefixLines(makePrefix, matcher) {
  const { value } = fieldText;
  const start = value.lastIndexOf("\n", fieldText.selectionStart - 1) + 1;
  let end = value.indexOf("\n", fieldText.selectionEnd);
  if (end === -1 || (fieldText.selectionEnd > fieldText.selectionStart && value[fieldText.selectionEnd - 1] === "\n")) {
    end = end === -1 ? value.length : fieldText.selectionEnd - 1;
  }
  const lines = value.slice(start, end).split("\n");
  const allPrefixed = lines.every((l) => !l.trim() || matcher.test(l));
  const result = lines
    .map((l, i) => {
      if (allPrefixed) return l.replace(matcher, "");
      return l.trim() ? makePrefix(i) + l.replace(matcher, "") : l;
    })
    .join("\n");
  fieldText.setSelectionRange(start, end);
  replaceSelection(result, 0, result.length);
}

function insertLink() {
  const { selectionStart: start, selectionEnd: end, value } = fieldText;
  const selected = value.slice(start, end).trim();
  if (/^(https?:\/\/|mailto:)/i.test(selected)) {
    const text = `[texte](${selected})`;
    replaceSelection(text, 1, 6);
  } else {
    const label = selected || "texte";
    const text = `[${label}](https://)`;
    replaceSelection(text, label.length + 3, label.length + 11);
  }
}

function insertBlock(block) {
  const { selectionStart: start, value } = fieldText;
  const before = value.slice(0, start);
  const lead = !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const text = `${lead}${block}\n\n`;
  fieldText.setSelectionRange(start, fieldText.selectionEnd);
  replaceSelection(text, text.length);
}

const MD_ACTIONS = {
  bold: () => wrapSelection("**", "texte en gras"),
  italic: () => wrapSelection("*", "texte en italique"),
  strike: () => wrapSelection("~~", "texte barré"),
  mark: () => wrapSelection("==", "texte surligné"),
  heading: () => prefixLines(() => "## ", /^#{1,6}\s+/),
  ul: () => prefixLines(() => "- ", /^\s*[-*+]\s+/),
  ol: () => prefixLines((i) => `${i + 1}. `, /^\s*\d{1,9}[.)]\s+/),
  quote: () => prefixLines(() => "> ", /^\s*>\s?/),
  link: insertLink,
  hr: () => insertBlock("---")
};

// mousedown + preventDefault : le textarea garde le focus et sa sélection.
mdToolbar.addEventListener("mousedown", (e) => {
  if (e.target.closest("button")) e.preventDefault();
});
mdToolbar.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-md]");
  if (!btn || !state.current) return;
  MD_ACTIONS[btn.dataset.md]?.();
});

fieldText.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey) {
    const action = { b: "bold", i: "italic", k: "link" }[e.key.toLowerCase()];
    if (action) {
      e.preventDefault();
      MD_ACTIONS[action]();
      return;
    }
  }

  // Entrée dans une liste : continue la liste, ou la termine sur un élément vide.
  if (e.key === "Enter" && !mod && !e.shiftKey && !e.isComposing && fieldText.selectionStart === fieldText.selectionEnd) {
    const { selectionStart: pos, value } = fieldText;
    const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
    const line = value.slice(lineStart, pos);
    const m = /^(\s*)([-*+]|\d{1,9}[.)]|>)(\s+)(.*)$/.exec(line);
    if (!m) return;
    e.preventDefault();
    if (!m[4].trim()) {
      // Élément vide : on sort de la liste en laissant une ligne vide,
      // sinon le paragraphe suivant serait rattaché au dernier élément.
      fieldText.setSelectionRange(lineStart, pos);
      replaceSelection("\n", 1);
      return;
    }
    let marker = m[2];
    const num = /^(\d+)([.)])$/.exec(marker);
    if (num) marker = `${Number(num[1]) + 1}${num[2]}`;
    const insert = `\n${m[1]}${marker}${m[3]}`;
    replaceSelection(insert, insert.length);
  }
});

window.addEventListener("resize", () => {
  if (state.current && !views.editor.hidden) {
    fitStickyPreview();
    checkTextOverflow();
  }
});

// Les polices web peuvent changer la hauteur du texte une fois chargées.
document.fonts?.ready.then(() => {
  if (state.current) checkTextOverflow();
});

fieldFont.addEventListener("change", () => {
  currentSlide().text.font = fieldFont.value;
  flushSave(true);
  renderAll();
});

fieldTextColor.addEventListener("input", () => {
  currentSlide().text.color = fieldTextColor.value;
  renderPreview();
});
fieldTextColor.addEventListener("change", () => {
  flushSave(true);
  renderSlideStrip();
});

wireSegmented(fieldTextSize, (value) => {
  currentSlide().text.size = value;
  flushSave(true);
  renderAll();
});

wireSegmented(fieldBoxMode, (value) => {
  normalizeTextBox(currentSlide()).boxMode = value;
  updateBoxControls(currentSlide());
  flushSave(true);
  renderAll();
});

fieldBoxColor.addEventListener("input", () => {
  normalizeTextBox(currentSlide()).boxColor = fieldBoxColor.value;
  renderPreview();
});
fieldBoxColor.addEventListener("change", () => {
  flushSave(true);
  renderSlideStrip();
});

fieldBoxOpacity.addEventListener("input", () => {
  normalizeTextBox(currentSlide()).boxOpacity = Number(fieldBoxOpacity.value);
  fieldBoxOpacityValue.textContent = fieldBoxOpacity.value;
  renderPreview();
});
fieldBoxOpacity.addEventListener("change", () => {
  flushSave(true);
  renderSlideStrip();
});

wireSegmented(fieldTextAlign, (value) => {
  currentSlide().text.align = value;
  flushSave(true);
  renderAll();
});

btnRemoveImage.addEventListener("click", () => {
  currentSlide().image.url = "";
  flushSave(true);
  renderAll();
});

wireSegmented(fieldImageFit, (value) => {
  currentSlide().image.fit = value;
  flushSave(true);
  renderAll();
});

/* ---------------- Position de l'image ---------------- */

// Les boutons Haut / Centre / Bas sont des raccourcis des curseurs :
// Haut et Bas règlent la verticale, Centre recentre dans les deux sens.
const POSITION_PRESETS = {
  top: { posY: 0 },
  center: { posX: 50, posY: 50 },
  bottom: { posY: 100 }
};

function positionLabel(value, low, high) {
  if (value === 50) return "Centre";
  if (value === 0) return low;
  if (value === 100) return high;
  return `${value} %`;
}

/** Synchronise curseurs, libellés et boutons avec la position de l'image. */
function updatePositionControls(im) {
  fieldImagePosX.value = im.posX;
  fieldImagePosY.value = im.posY;
  fieldImagePosXValue.textContent = positionLabel(im.posX, "Gauche", "Droite");
  fieldImagePosYValue.textContent = positionLabel(im.posY, "Haut", "Bas");
  // Le bouton actif reflète la position verticale ; Centre seulement si
  // l'image est centrée dans les deux sens.
  const preset =
    im.posY === 0 ? "top" : im.posY === 100 ? "bottom" : im.posY === 50 && im.posX === 50 ? "center" : "";
  setSegmentedActive(fieldImagePosition, preset);
}

/** Conserve `position` (haut / centre / bas) cohérent pour les anciens lecteurs. */
function syncLegacyPosition(im) {
  im.position = im.posY <= 25 ? "top" : im.posY >= 75 ? "bottom" : "center";
}

wireSegmented(fieldImagePosition, (value) => {
  const im = normalizeImage(currentSlide());
  Object.assign(im, POSITION_PRESETS[value]);
  syncLegacyPosition(im);
  updatePositionControls(im);
  flushSave(true);
  renderAll();
});

[
  [fieldImagePosX, "posX"],
  [fieldImagePosY, "posY"]
].forEach(([input, key]) => {
  input.addEventListener("input", () => {
    const im = normalizeImage(currentSlide());
    im[key] = Number(input.value);
    syncLegacyPosition(im);
    updatePositionControls(im);
    renderPreview();
  });
  input.addEventListener("change", () => {
    flushSave(true);
    renderSlideStrip();
  });
  // Double-clic : retour au centre sur cet axe.
  input.addEventListener("dblclick", () => {
    const im = normalizeImage(currentSlide());
    im[key] = 50;
    syncLegacyPosition(im);
    updatePositionControls(im);
    flushSave(true);
    renderAll();
  });
});

/* ---------------- Taille et contour de l'image ---------------- */

function updateBorderWidthLabel(width) {
  fieldImageBorderWidthValue.textContent =
    width > 0 ? `${String(width).replace(".", ",")}` : "Aucun";
}

fieldImageScale.addEventListener("input", () => {
  const im = normalizeImage(currentSlide());
  im.scale = Number(fieldImageScale.value);
  fieldImageScaleValue.textContent = im.scale;
  renderPreview();
});
fieldImageScale.addEventListener("change", () => {
  flushSave(true);
  renderSlideStrip();
});

fieldImageBorderWidth.addEventListener("input", () => {
  const im = normalizeImage(currentSlide());
  im.borderWidth = Number(fieldImageBorderWidth.value);
  updateBorderWidthLabel(im.borderWidth);
  fieldImageBorderColor.disabled = im.borderWidth === 0;
  renderPreview();
});
fieldImageBorderWidth.addEventListener("change", () => {
  flushSave(true);
  renderSlideStrip();
});

fieldImageBorderColor.addEventListener("input", () => {
  normalizeImage(currentSlide()).borderColor = fieldImageBorderColor.value;
  renderPreview();
});
fieldImageBorderColor.addEventListener("change", () => {
  flushSave(true);
  renderSlideStrip();
});

/* ---------------- Transitions ---------------- */

TRANSITION_OPTIONS.forEach((t) => {
  const opt = document.createElement("option");
  opt.value = t.value;
  opt.textContent = t.label;
  fieldTransition.appendChild(opt);
});

fieldTransition.addEventListener("change", () => {
  const tr = normalizeTransition(currentSlide());
  tr.type = fieldTransition.value;
  fieldTransitionSpeed.classList.toggle("is-disabled", tr.type === "none");
  flushSave(true);
  if (tr.type !== "none") testTransition();
});

wireSegmented(fieldTransitionSpeed, (value) => {
  normalizeTransition(currentSlide()).speed = value;
  flushSave(true);
  if (normalizeTransition(currentSlide()).type !== "none") testTransition();
});

/**
 * Joue la transition de la page courante dans l'aperçu : on part de la page
 * précédente (ou d'un écran noir pour la première page).
 */
function testTransition() {
  if (!state.current) return;
  const slide = currentSlide();
  const tr = normalizeTransition(slide);
  if (tr.type === "none") {
    toast("Choisissez d'abord un effet.");
    return;
  }
  finishTransitions(previewSlide);
  previewSlide.innerHTML = "";

  const fromEl = document.createElement("div");
  fromEl.className = "slide-layer";
  const prevIndex = state.slideIndex - 1;
  if (prevIndex >= 0) {
    renderSlide(fromEl, state.current.slides[prevIndex], slideOptions(prevIndex));
  } else {
    fromEl.style.background = "#000";
  }
  const toEl = document.createElement("div");
  toEl.className = "slide-layer";
  renderSlide(toEl, slide, slideOptions(state.slideIndex));
  // renderSlide pose les classes d'orientation sur les calques : on les retire
  // pour qu'ils suivent simplement la taille de l'aperçu.
  [fromEl, toEl].forEach((el) => el.classList.remove("slide--portrait", "slide--paysage"));
  previewSlide.append(fromEl, toEl);

  playTransition({
    stage: previewSlide,
    fromEl,
    toEl,
    type: tr.type,
    speed: tr.speed,
    direction: 1
  }).then(() => {
    // Ne redessine que si aucun autre rendu n'a eu lieu entre-temps.
    if (toEl.isConnected && state.current && slide === currentSlide()) {
      renderSlide(previewSlide, slide, slideOptions(state.slideIndex));
      checkTextOverflow();
    }
  });
}

btnTransitionTest.addEventListener("click", testTransition);

btnTransitionAll.addEventListener("click", async () => {
  if (!state.current) return;
  const tr = normalizeTransition(currentSlide());
  const label = TRANSITION_OPTIONS.find((o) => o.value === tr.type)?.label || tr.type;
  const ok = await confirmModal({
    title: "Appliquer à toutes les pages ?",
    message: `Toutes les pages utiliseront la transition « ${escapeHtml(label)} ».`,
    confirmLabel: "Appliquer"
  });
  if (!ok || !state.current) return;
  state.current.slides.forEach((s) => {
    s.transition = { type: tr.type, speed: tr.speed };
  });
  flushSave(true);
  toast("Transition appliquée à toutes les pages");
});

/* ---------------- Récapitulatif des consultations ---------------- */

const DEVICE_LABELS = {
  mobile: { icon: "📱", label: "Mobile" },
  tablette: { icon: "📱", label: "Tablette" },
  ordinateur: { icon: "💻", label: "Ordinateur" }
};

/** 72 500 ms -> "1 min 13 s" ; < 1 s -> "< 1 s". */
function formatDuration(ms) {
  const total = Math.round((Number(ms) || 0) / 1000);
  if (total < 1) return "< 1 s";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Les consultations enregistrées avant ces statistiques n'ont que la date. */
function hasDetails(v) {
  return Number.isFinite(v.slideCount) && Number.isFinite(v.maxSlide);
}

function renderViewsSummary(list) {
  const detailed = list.filter(hasDetails);
  if (!detailed.length) {
    viewsSummary.hidden = true;
    return;
  }
  const completed = detailed.filter((v) => v.completed).length;
  const devices = detailed.reduce((acc, v) => {
    acc[v.device] = (acc[v.device] || 0) + 1;
    return acc;
  }, {});
  const deviceText = Object.entries(DEVICE_LABELS)
    .filter(([key]) => devices[key])
    .map(([key, d]) => `${d.label} ${devices[key]}`)
    .join(" · ");
  viewsSummary.innerHTML = `
    <div class="views-summary__item">
      <span class="views-summary__value">${completed} / ${detailed.length}</span>
      <span class="views-summary__label">lues en entier</span>
    </div>
    <div class="views-summary__item">
      <span class="views-summary__value">${escapeHtml(formatDuration(median(detailed.map((v) => v.durationMs || 0))))}</span>
      <span class="views-summary__label">durée médiane</span>
    </div>
    <div class="views-summary__item">
      <span class="views-summary__value">${escapeHtml(deviceText || "—")}</span>
      <span class="views-summary__label">appareils</span>
    </div>`;
  viewsSummary.hidden = false;
}

function renderViews(list) {
  viewsList.innerHTML = "";
  renderViewsSummary(list);
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "views-list__empty";
    li.textContent = "Aucune consultation pour le moment.";
    viewsList.appendChild(li);
    return;
  }
  list.forEach((v, i) => {
    const li = document.createElement("li");
    li.className = "view-item";

    const head = document.createElement("div");
    head.className = "view-item__head";
    head.innerHTML = `<span class="view-item__num">Consultation #${list.length - i}</span><span>${escapeHtml(formatDate(v.viewedAt))}</span>`;
    li.appendChild(head);

    if (hasDetails(v)) {
      const total = Math.max(1, v.slideCount);
      const reached = Math.min(total, Math.max(1, v.maxSlide));
      const pct = Math.round((reached / total) * 100);
      const device = DEVICE_LABELS[v.device] || { icon: "❔", label: "Appareil inconnu" };

      const progress = document.createElement("div");
      progress.className = `view-item__progress${v.completed ? " is-complete" : ""}`;
      progress.innerHTML = `
        <div class="view-item__bar" role="progressbar" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${reached}">
          <div class="view-item__bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="view-item__progress-label">${v.completed ? "✓ Lue en entier" : `Page ${reached} / ${total}`}</span>`;
      li.appendChild(progress);

      const meta = document.createElement("div");
      meta.className = "view-item__meta";
      meta.innerHTML = `
        <span title="Type d'appareil">${device.icon} ${device.label}</span>
        <span title="Durée de lecture (onglet visible)">⏱ ${escapeHtml(formatDuration(v.durationMs))}</span>`;
      li.appendChild(meta);
    } else {
      const meta = document.createElement("div");
      meta.className = "view-item__meta view-item__meta--legacy";
      meta.textContent = "Détails non disponibles (consultation antérieure aux statistiques)";
      li.appendChild(meta);
    }

    viewsList.appendChild(li);
  });
}

window.addEventListener("beforeunload", () => {
  if (saveTimer && state.current) {
    saveSlides(state.current.id, state.current.slides).catch(() => {});
  }
});
