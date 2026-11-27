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
import { renderSlide, FONT_OPTIONS, todayISO, timestampToISO } from "./slide-render.js";

const MAX_DOC_BYTES = 900000; // headroom under Firestore's 1 MiB per-document hard limit

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

const fieldOrientation = document.getElementById("field-orientation");
const fieldBgType = document.getElementById("field-bg-type");
const fieldBgColorWrap = document.getElementById("field-bg-color-wrap");
const fieldBgImageWrap = document.getElementById("field-bg-image-wrap");
const fieldBgColor = document.getElementById("field-bg-color");
const fieldBgImage = document.getElementById("field-bg-image");
const fieldBgImagePreview = document.getElementById("field-bg-image-preview");
const fieldText = document.getElementById("field-text");
const fieldFont = document.getElementById("field-font");
const fieldTextColor = document.getElementById("field-text-color");
const fieldTextSize = document.getElementById("field-text-size");
const fieldTextAlign = document.getElementById("field-text-align");
const fieldImage = document.getElementById("field-image");
const fieldImagePreview = document.getElementById("field-image-preview");
const fieldImageFit = document.getElementById("field-image-fit");
const fieldImagePosition = document.getElementById("field-image-position");
const btnRemoveImage = document.getElementById("btn-remove-image");

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
      window.open(buildShareLink(pres.id), "_blank");
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
  window.open(shareLink.value, "_blank");
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
      renderSlide(previewSlide, currentSlide(), slideOptions(state.slideIndex));
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
  renderSlide(previewSlide, slide, slideOptions(state.slideIndex));
  slidePosition.textContent = `${state.slideIndex + 1} / ${state.current.slides.length}`;

  setSegmentedActive(fieldOrientation, slide.orientation);
  setSegmentedActive(fieldBgType, slide.background.type);
  setSegmentedActive(fieldTextSize, slide.text.size);
  setSegmentedActive(fieldTextAlign, slide.text.align);
  setSegmentedActive(fieldImageFit, slide.image.fit);
  setSegmentedActive(fieldImagePosition, slide.image.position);

  fieldBgColorWrap.hidden = slide.background.type !== "color";
  fieldBgImageWrap.hidden = slide.background.type !== "image";
  fieldBgColor.value = slide.background.color || "#14141c";
  fieldBgImagePreview.src = slide.background.imageUrl || "";
  fieldBgImagePreview.style.visibility = slide.background.imageUrl ? "visible" : "hidden";

  if (document.activeElement !== fieldText) {
    fieldText.value = slide.text.content || "";
  }
  fieldFont.value = slide.text.font || "Inter";
  fieldTextColor.value = slide.text.color || "#f5f0e8";

  fieldImagePreview.src = slide.image.url || "";
  fieldImagePreview.style.visibility = slide.image.url ? "visible" : "hidden";
  btnRemoveImage.hidden = !slide.image.url;
}

function addSlide() {
  state.current.slides.push(emptySlide());
  state.slideIndex = state.current.slides.length - 1;
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

document.getElementById("btn-slide-delete").addEventListener("click", deleteSlide);
document.getElementById("btn-slide-up").addEventListener("click", () => moveSlide(-1));
document.getElementById("btn-slide-down").addEventListener("click", () => moveSlide(1));

wireSegmented(fieldOrientation, (value) => {
  currentSlide().orientation = value;
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
  renderSlide(previewSlide, currentSlide(), slideOptions(state.slideIndex));
});
fieldBgColor.addEventListener("change", () => flushSave(true));

fieldBgImage.addEventListener("change", async () => {
  const file = fieldBgImage.files[0];
  if (!file) return;
  const previousUrl = currentSlide().background.imageUrl;
  try {
    toast("Compression de l'image…", 1500);
    const dataUrl = await compressImageToDataUrl(file);
    currentSlide().background.imageUrl = dataUrl;
    currentSlide().background.type = "image";
    if (estimateDocBytes() > MAX_DOC_BYTES) {
      currentSlide().background.imageUrl = previousUrl;
      toast("Cette confidence serait trop volumineuse avec cette image. Essayez une image plus simple.", 4000);
    } else {
      flushSave(true);
    }
    renderAll();
  } catch (err) {
    toast(err.message);
  }
  fieldBgImage.value = "";
});

let textFlush = null;
fieldText.addEventListener("input", () => {
  currentSlide().text.content = fieldText.value;
  renderSlide(previewSlide, currentSlide(), slideOptions(state.slideIndex));
  clearTimeout(textFlush);
  textFlush = setTimeout(() => flushSave(true), 600);
});
fieldText.addEventListener("blur", () => {
  flushSave(true);
  renderSlideStrip();
});

fieldFont.addEventListener("change", () => {
  currentSlide().text.font = fieldFont.value;
  flushSave(true);
  renderAll();
});

fieldTextColor.addEventListener("input", () => {
  currentSlide().text.color = fieldTextColor.value;
  renderSlide(previewSlide, currentSlide(), slideOptions(state.slideIndex));
});
fieldTextColor.addEventListener("change", () => flushSave(true));

wireSegmented(fieldTextSize, (value) => {
  currentSlide().text.size = value;
  flushSave(true);
  renderAll();
});

wireSegmented(fieldTextAlign, (value) => {
  currentSlide().text.align = value;
  flushSave(true);
  renderAll();
});

fieldImage.addEventListener("change", async () => {
  const file = fieldImage.files[0];
  if (!file) return;
  const previousUrl = currentSlide().image.url;
  try {
    toast("Compression de l'image…", 1500);
    const dataUrl = await compressImageToDataUrl(file);
    currentSlide().image.url = dataUrl;
    if (estimateDocBytes() > MAX_DOC_BYTES) {
      currentSlide().image.url = previousUrl;
      toast("Cette confidence serait trop volumineuse avec cette image. Essayez une image plus simple.", 4000);
    } else {
      flushSave(true);
    }
    renderAll();
  } catch (err) {
    toast(err.message);
  }
  fieldImage.value = "";
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

wireSegmented(fieldImagePosition, (value) => {
  currentSlide().image.position = value;
  flushSave(true);
  renderAll();
});

function renderViews(list) {
  viewsList.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.textContent = "Aucune consultation pour le moment.";
    viewsList.appendChild(li);
    return;
  }
  list.forEach((v, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>Consultation #${list.length - i}</span><span>${formatDate(v.viewedAt)}</span>`;
    viewsList.appendChild(li);
  });
}

window.addEventListener("beforeunload", () => {
  if (saveTimer && state.current) {
    saveSlides(state.current.id, state.current.slides).catch(() => {});
  }
});
