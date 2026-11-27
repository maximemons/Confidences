import { markdownToHtml } from "./markdown.js";

export const FONT_OPTIONS = [
  { value: "Inter", label: "Inter — moderne" },
  { value: "Playfair Display", label: "Playfair Display — élégant" },
  { value: "Poppins", label: "Poppins — rond" },
  { value: "Caveat", label: "Caveat — manuscrit" },
  { value: "Merriweather", label: "Merriweather — classique" },
  { value: "Dancing Script", label: "Dancing Script — calligraphie" },
  { value: "Montserrat", label: "Montserrat — épuré" },
  { value: "Courier Prime", label: "Courier Prime — machine à écrire" }
];

/**
 * Toutes les pages d'une confidence partagent la même orientation :
 * celle de la première page fait foi.
 */
export function deckOrientation(slides) {
  return slides?.[0]?.orientation === "paysage" ? "paysage" : "portrait";
}

/** Today's date as "YYYY-MM-DD" in the local time zone. */
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Converts a Firestore Timestamp to "YYYY-MM-DD" (local time zone). */
export function timestampToISO(ts) {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-27" -> "27 novembre 2026" (no time zone shift). */
export function formatWrittenDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

/**
 * Complète les réglages du fond de texte pour les pages créées avant cette
 * option : elles n'ont pas de fond (mode "none"), donc leur rendu ne change pas.
 */
export function normalizeTextBox(slide) {
  const t = slide.text || (slide.text = {});
  if (!["none", "auto", "color"].includes(t.boxMode)) t.boxMode = "none";
  if (!/^#[0-9a-f]{6}$/i.test(t.boxColor || "")) t.boxColor = "#000000";
  const op = Number(t.boxOpacity);
  t.boxOpacity = Number.isFinite(op) ? Math.min(100, Math.max(0, Math.round(op))) : 85;
  return t;
}

/** Transitions proposées à l'arrivée sur une page. */
export const TRANSITION_OPTIONS = [
  { value: "none", label: "Aucune" },
  { value: "fade", label: "Fondu" },
  { value: "slide", label: "Glissement" },
  { value: "rise", label: "Montée" },
  { value: "zoom", label: "Zoom" },
  { value: "flip", label: "Pivot" },
  { value: "blur", label: "Flou" }
];

export const TRANSITION_SPEEDS = { fast: 280, normal: 500, slow: 900 };

/**
 * Complète les réglages d'image pour les pages créées avant ces options :
 * taille 100 % et pas de contour, donc leur rendu ne change pas.
 */
export function normalizeImage(slide) {
  const im = slide.image || (slide.image = { url: "" });
  if (!["cover", "contain"].includes(im.fit)) im.fit = "cover";
  if (!["top", "center", "bottom"].includes(im.position)) im.position = "center";
  // Position fine en % (0 = gauche / haut, 100 = droite / bas). Les pages
  // antérieures n'ont que `position` (haut / centre / bas) : on en déduit Y.
  const clampPct = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
  };
  im.posX = clampPct(im.posX, 50);
  im.posY = clampPct(im.posY, im.position === "top" ? 0 : im.position === "bottom" ? 100 : 50);
  const scale = Number(im.scale);
  im.scale = Number.isFinite(scale) ? Math.min(100, Math.max(10, Math.round(scale))) : 100;
  const bw = Number(im.borderWidth);
  im.borderWidth = Number.isFinite(bw) ? Math.min(10, Math.max(0, Math.round(bw * 2) / 2)) : 0;
  if (!/^#[0-9a-f]{6}$/i.test(im.borderColor || "")) im.borderColor = "#ffffff";
  return im;
}

/** Complète les réglages de transition (anciennes pages : aucune transition). */
export function normalizeTransition(slide) {
  const t = slide.transition || (slide.transition = {});
  if (!TRANSITION_OPTIONS.some((o) => o.value === t.type)) t.type = "none";
  if (!(t.speed in TRANSITION_SPEEDS)) t.speed = "normal";
  return t;
}

/**
 * Dimensionne l'image en unités de conteneur (cqw / cqh) : la taille reste
 * proportionnelle à la page, quelle que soit la taille d'affichage.
 * - "Remplir" : un cadre de N % de la page, rempli par l'image (recadrée) ;
 * - "Ajuster" : l'image entière, aux proportions d'origine, tient dans ce cadre
 *   (le contour épouse donc l'image et non le cadre).
 */
function applyImageSize(img, im) {
  const s = im.scale;
  img.style.width = `${s}cqw`;
  img.style.height = `${s}cqh`;
  if (im.fit !== "contain") return;
  const fit = () => {
    const r = img.naturalWidth / img.naturalHeight;
    if (!r || !Number.isFinite(r)) return;
    img.style.width = `min(${s}cqw, ${+(s * r).toFixed(3)}cqh)`;
    img.style.height = `min(${s}cqh, ${+(s / r).toFixed(3)}cqw)`;
  };
  img.addEventListener("load", fit, { once: true });
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

/** Luminance relative (0 = noir, 1 = blanc). */
function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** La page affiche-t-elle une photo (en fond ou en image) derrière le texte ? */
function hasPhoto(slide) {
  return (slide.background?.type === "image" && !!slide.background.imageUrl) || !!slide.image?.url;
}

/**
 * Couleur CSS du fond derrière le texte, ou "" si aucun fond.
 * - "color"  : la couleur choisie ;
 * - "auto"   : seulement s'il y a une photo ; fond sombre pour un texte clair,
 *              fond clair pour un texte sombre (contraste garanti).
 */
export function textBoxColor(slide) {
  const t = normalizeTextBox({ ...slide, text: { ...(slide.text || {}) } });
  let rgb;
  if (t.boxMode === "color") {
    rgb = hexToRgb(t.boxColor);
  } else if (t.boxMode === "auto" && hasPhoto(slide)) {
    const textLum = luminance(hexToRgb(slide.text?.color || "#f5f0e8"));
    rgb = textLum > 0.4 ? [0, 0, 0] : [255, 255, 255];
  } else {
    return "";
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${t.boxOpacity / 100})`;
}

/**
 * @param {HTMLElement} container
 * @param {object} slide
 * @param {{ title?: string, date?: string }} [options] - when `title` is set,
 *   it is shown above the slide text in a larger size, followed by `date`
 *   ("YYYY-MM-DD") if given. Used for the first slide.
 */
export function renderSlide(container, slide, options = {}) {
  container.innerHTML = "";
  container.classList.remove("slide--portrait", "slide--paysage");
  container.classList.add(slide.orientation === "paysage" ? "slide--paysage" : "slide--portrait");

  const bg = document.createElement("div");
  bg.className = "slide__bg";
  if (slide.background?.type === "image" && slide.background.imageUrl) {
    bg.style.backgroundImage = `url("${slide.background.imageUrl}")`;
  } else {
    bg.style.backgroundColor = slide.background?.color || "#14141c";
  }
  container.appendChild(bg);

  if (slide.image?.url) {
    const im = normalizeImage(slide);
    const wrap = document.createElement("div");
    wrap.className = "slide__image-wrap";
    const img = document.createElement("img");
    img.className = `slide__image slide__image--${im.fit}`;
    // left/top en % de la page, puis translate en % de l'image : à 0 l'image
    // touche le bord gauche/haut, à 100 le bord droit/bas, à 50 elle est centrée.
    img.style.left = `${im.posX}%`;
    img.style.top = `${im.posY}%`;
    img.style.transform = `translate(-${im.posX}%, -${im.posY}%)`;
    // En mode « Remplir », la même position choisit aussi le cadrage dans l'image.
    img.style.objectPosition = `${im.posX}% ${im.posY}%`;
    applyImageSize(img, im);
    if (im.borderWidth > 0) {
      // Épaisseur relative au plus petit côté de la page : identique en miniature,
      // dans l'aperçu et en plein écran.
      img.style.border = `calc(${im.borderWidth} * 0.4cqmin) solid ${im.borderColor}`;
    }
    img.src = slide.image.url;
    img.alt = "";
    wrap.appendChild(img);
    container.appendChild(wrap);
  }

  const title = (options.title || "").trim();
  if (title || slide.text?.content) {
    const fontFamily = `"${slide.text?.font || "Inter"}", system-ui, sans-serif`;
    const color = slide.text?.color || "#f5f0e8";
    const textWrap = document.createElement("div");
    textWrap.className = `slide__text-wrap slide__text-wrap--${slide.text?.align || "center"}`;

    // Boîte qui regroupe titre, date et texte : c'est elle qui porte le fond.
    const textBox = document.createElement("div");
    textBox.className = "slide__text-box";
    const boxColor = textBoxColor(slide);
    if (boxColor) {
      textBox.classList.add("slide__text-box--filled");
      textBox.style.backgroundColor = boxColor;
    }

    if (title) {
      const h = document.createElement("h1");
      h.className = "slide__title";
      h.style.fontFamily = fontFamily;
      h.style.color = color;
      h.textContent = title;
      textBox.appendChild(h);

      const dateLabel = formatWrittenDate(options.date);
      if (dateLabel) {
        const time = document.createElement("time");
        time.className = "slide__date";
        time.dateTime = options.date;
        time.style.fontFamily = fontFamily;
        time.style.color = color;
        time.textContent = dateLabel;
        textBox.appendChild(time);
      }
    }

    if (slide.text?.content) {
      // Le texte est écrit en Markdown ; markdownToHtml échappe tout HTML saisi.
      const body = document.createElement("div");
      body.className = `slide__text slide__md slide__text--${slide.text.size || "medium"}`;
      body.style.fontFamily = fontFamily;
      body.style.color = color;
      body.innerHTML = markdownToHtml(slide.text.content);
      textBox.appendChild(body);
    }

    textWrap.appendChild(textBox);
    container.appendChild(textWrap);
  }
}
