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

    if (title) {
      const h = document.createElement("h1");
      h.className = "slide__title";
      h.style.fontFamily = fontFamily;
      h.style.color = color;
      h.textContent = title;
      textWrap.appendChild(h);

      const dateLabel = formatWrittenDate(options.date);
      if (dateLabel) {
        const time = document.createElement("time");
        time.className = "slide__date";
        time.dateTime = options.date;
        time.style.fontFamily = fontFamily;
        time.style.color = color;
        time.textContent = dateLabel;
        textWrap.appendChild(time);
      }
    }

    if (slide.text?.content) {
      const p = document.createElement("p");
      p.className = `slide__text slide__text--${slide.text.size || "medium"}`;
      p.style.fontFamily = fontFamily;
      p.style.color = color;
      p.textContent = slide.text.content;
      textWrap.appendChild(p);
    }

    container.appendChild(textWrap);
  }
}
