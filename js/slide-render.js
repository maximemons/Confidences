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
    const wrap = document.createElement("div");
    wrap.className = "slide__image-wrap";
    const img = document.createElement("img");
    img.className = `slide__image slide__image--${slide.image.fit || "cover"}`;
    const position = slide.image.position || "center";
    img.style.objectPosition = position === "top" ? "center top" : position === "bottom" ? "center bottom" : "center center";
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
