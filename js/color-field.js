// Champ couleur enrichi : pastille (sélecteur natif) + saisie HEX + couleurs
// récentes. Le <input type="color"> d'origine est conservé : il reste la
// source de vérité et reçoit les événements "input" (aperçu en direct) et
// "change" (validation), donc le code existant n'a rien à changer.

const MAX_RECENT = 12;
const STORAGE_PREFIX = "confidences:recent-colors";

let storageKey = `${STORAGE_PREFIX}:anonyme`;
let recent = [];
const fields = new Set();
let openPopover = null;

/** Normalise "#ABC", "abc", "#aabbcc"… en "#aabbcc" ; null si invalide. */
export function parseHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || "").trim());
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.replace(/./g, "$&$&");
  return `#${hex}`;
}

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey) || "[]");
    recent = Array.isArray(list) ? list.map(parseHex).filter(Boolean).slice(0, MAX_RECENT) : [];
  } catch {
    recent = [];
  }
}

function saveRecent() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(recent));
  } catch {
    /* stockage indisponible (navigation privée…) : l'historique reste en mémoire */
  }
}

/** Les couleurs récentes sont propres à chaque compte (même navigateur partagé). */
export function setRecentColorsOwner(uid) {
  storageKey = `${STORAGE_PREFIX}:${uid || "anonyme"}`;
  loadRecent();
}

export function addRecentColor(value) {
  const hex = parseHex(value);
  if (!hex) return;
  recent = [hex, ...recent.filter((c) => c !== hex)].slice(0, MAX_RECENT);
  saveRecent();
}

export function getRecentColors() {
  return [...recent];
}

function closePopover() {
  if (!openPopover) return;
  openPopover.remove();
  openPopover = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutside(e) {
  if (openPopover && !openPopover.contains(e.target) && !e.target.closest?.(".color-field__more")) closePopover();
}

function onEscape(e) {
  if (e.key === "Escape") closePopover();
}

function swatchButton(hex, current, onPick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "color-swatch";
  b.style.backgroundColor = hex;
  b.title = hex.toUpperCase();
  b.setAttribute("aria-label", hex.toUpperCase());
  if (hex === current) b.classList.add("is-current");
  b.addEventListener("click", () => onPick(hex));
  return b;
}

/**
 * @param {HTMLInputElement} input  un <input type="color">
 * @param {{ getDeckColors?: () => string[] }} [options]
 *   getDeckColors : couleurs déjà utilisées dans la confidence ouverte.
 */
export function enhanceColorInput(input, { getDeckColors } = {}) {
  if (input.dataset.enhanced) return;
  input.dataset.enhanced = "1";

  const wrap = document.createElement("div");
  wrap.className = "color-field";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.classList.add("color-field__native");
  input.title = "Ouvrir le sélecteur de couleur";

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "color-field__hex";
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.autocomplete = "off";
  hexInput.setAttribute("autocapitalize", "off");
  hexInput.setAttribute("aria-label", "Couleur en hexadécimal (#RRGGBB)");
  hexInput.placeholder = "#RRGGBB";
  wrap.appendChild(hexInput);

  const more = document.createElement("button");
  more.type = "button";
  more.className = "color-field__more";
  more.setAttribute("aria-label", "Couleurs récentes");
  more.setAttribute("aria-haspopup", "dialog");
  more.title = "Couleurs récentes";
  more.textContent = "▾";
  wrap.appendChild(more);

  const showValue = () => {
    if (document.activeElement !== hexInput) hexInput.value = input.value.toUpperCase();
    hexInput.classList.remove("is-invalid");
  };

  // Les valeurs posées par le code (changement de page…) mettent aussi à jour le champ HEX.
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  Object.defineProperty(input, "value", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(v) {
      desc.set.call(this, v);
      showValue();
    }
  });

  const syncDisabled = () => {
    hexInput.disabled = input.disabled;
    more.disabled = input.disabled;
    wrap.classList.toggle("is-disabled", input.disabled);
  };
  new MutationObserver(syncDisabled).observe(input, { attributes: true, attributeFilter: ["disabled"] });
  syncDisabled();

  /** Applique une couleur comme si elle venait du sélecteur natif. */
  const apply = (hex, commit) => {
    if (input.value !== hex) {
      input.value = hex;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (commit) input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  input.addEventListener("input", showValue);
  input.addEventListener("change", () => {
    addRecentColor(input.value);
    showValue();
  });

  let committed = input.value;
  hexInput.addEventListener("focus", () => {
    committed = input.value;
    hexInput.select();
  });
  hexInput.addEventListener("input", () => {
    const hex = parseHex(hexInput.value);
    // Aperçu en direct dès que la saisie forme une couleur complète.
    hexInput.classList.toggle("is-invalid", !hex && hexInput.value.replace("#", "").length >= 6);
    if (hex && hexInput.value.replace("#", "").length === 6) apply(hex, false);
  });
  const commitHex = () => {
    const hex = parseHex(hexInput.value);
    if (hex) {
      apply(hex, hex !== committed);
      committed = hex;
    } else {
      // Saisie invalide : on revient à la dernière couleur valide.
      apply(committed, false);
    }
    hexInput.value = input.value.toUpperCase();
    hexInput.classList.remove("is-invalid");
  };
  hexInput.addEventListener("blur", commitHex);
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitHex();
      hexInput.select();
    } else if (e.key === "Escape") {
      hexInput.value = committed.toUpperCase();
      apply(committed, false);
      hexInput.blur();
    }
  });
  hexInput.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") || "";
    const hex = parseHex(text);
    if (hex) {
      e.preventDefault();
      hexInput.value = hex.toUpperCase();
      apply(hex, false);
    }
  });

  more.addEventListener("click", () => {
    if (openPopover?.dataset.for === input.id) {
      closePopover();
      return;
    }
    closePopover();
    const pop = document.createElement("div");
    pop.className = "color-popover";
    pop.dataset.for = input.id;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Couleurs");

    const pick = (hex) => {
      apply(hex, true);
      closePopover();
    };
    const section = (title, colors, emptyText) => {
      const h = document.createElement("div");
      h.className = "color-popover__title";
      h.textContent = title;
      pop.appendChild(h);
      const grid = document.createElement("div");
      grid.className = "color-popover__grid";
      if (!colors.length) {
        const p = document.createElement("p");
        p.className = "color-popover__empty";
        p.textContent = emptyText;
        grid.appendChild(p);
      }
      colors.forEach((c) => grid.appendChild(swatchButton(c, input.value, pick)));
      pop.appendChild(grid);
    };

    section("Récentes", getRecentColors(), "Les couleurs choisies apparaîtront ici.");
    const deck = [...new Set((getDeckColors?.() || []).map(parseHex).filter(Boolean))].slice(0, MAX_RECENT);
    if (deck.length) section("Dans cette confidence", deck, "");

    wrap.appendChild(pop);
    openPopover = pop;
    // Ouvre vers la gauche si le champ est près du bord droit.
    const rect = pop.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) pop.classList.add("color-popover--end");
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onEscape, true);
  });

  showValue();
  fields.add(input);
}
