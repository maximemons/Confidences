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

export function renderSlide(container, slide) {
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

  if (slide.text?.content) {
    const textWrap = document.createElement("div");
    textWrap.className = `slide__text-wrap slide__text-wrap--${slide.text.align || "center"}`;
    const p = document.createElement("p");
    p.className = `slide__text slide__text--${slide.text.size || "medium"}`;
    p.style.fontFamily = `"${slide.text.font || "Inter"}", system-ui, sans-serif`;
    p.style.color = slide.text.color || "#f5f0e8";
    p.textContent = slide.text.content;
    textWrap.appendChild(p);
    container.appendChild(textWrap);
  }
}
