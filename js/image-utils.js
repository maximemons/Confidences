// Les images sont stockées en base64 dans le document Firestore de la confidence.
// Firestore impose une limite technique de 1 Mio par document : c'est elle qui
// borne le poids total des images. Les valeurs ci-dessous sont des réglages
// (qualité / définition) ajustables, pas des limites techniques.
const MAX_DIMENSION = 1280; // côté le plus long, en px
const MIN_DIMENSION = 480; // on ne descend pas en dessous lors de l'ajustement
// Le PNG (repli pour les images transparentes sans WebP) ne se règle pas en
// qualité : seule la définition baisse, on s'autorise donc à descendre plus bas.
const MIN_DIMENSION_PNG = 240;
const INITIAL_QUALITY = 0.8;
const MIN_QUALITY = 0.4;
const QUALITY_STEP = 0.08;
const DIMENSION_STEP = 0.82;
// Plafond par image : évite qu'une seule photo consomme toute la place
// disponible (≈ 4 images à plein plafond tiennent dans une confidence).
export const MAX_DATA_URL_BYTES = 240 * 1024;
// En dessous de ce budget, une image serait illisible : on refuse.
const MIN_DATA_URL_BYTES = 12 * 1024;

let webpSupport = null;
function supportsWebp() {
  if (webpSupport === null) {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
    } catch {
      webpSupport = false;
    }
  }
  return webpSupport;
}

// WebP est ~25-35 % plus léger que JPEG à qualité égale et conserve la
// transparence. Safari ne sait pas encoder en WebP via canvas : on retombe
// alors sur JPEG pour les photos, et sur PNG pour les images transparentes
// (le JPEG n'a pas de canal alpha : le fond deviendrait opaque).
function encode(canvas, quality, transparent) {
  if (supportsWebp()) return canvas.toDataURL("image/webp", quality);
  if (transparent) return canvas.toDataURL("image/png");
  return canvas.toDataURL("image/jpeg", quality);
}

/** L'image a-t-elle des pixels (au moins partiellement) transparents ? */
function hasTransparency(img) {
  try {
    const size = 256;
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch {
    // En cas de doute, on préserve la transparence.
    return true;
  }
}

/**
 * Compresse une image en data URL tenant dans `maxBytes` (au plus MAX_DATA_URL_BYTES).
 * On baisse d'abord la qualité, puis la définition, jusqu'à tenir dans le budget.
 */
export function compressImageToDataUrl(file, maxBytes = MAX_DATA_URL_BYTES) {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Le fichier doit être une image."));
  }
  const budget = Math.min(MAX_DATA_URL_BYTES, Math.floor(maxBytes));
  if (budget < MIN_DATA_URL_BYTES) {
    return Promise.reject(
      new Error("Plus assez de place dans cette confidence pour une image. Retirez ou remplacez une autre image.")
    );
  }
  return loadImage(file).then((img) => {
    const transparent = hasTransparency(img);
    const pngFallback = transparent && !supportsWebp();
    const minDimension = pngFallback ? MIN_DIMENSION_PNG : MIN_DIMENSION;
    const longest = Math.max(img.width, img.height);
    let dimension = Math.min(MAX_DIMENSION, longest);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    while (true) {
      const scale = dimension / longest;
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Fond blanc seulement pour les images opaques encodées en JPEG ; une
      // image transparente garde son canal alpha (WebP ou PNG).
      if (!transparent && !supportsWebp()) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (pngFallback) {
        const dataUrl = encode(canvas, 1, true);
        if (dataUrl.length <= budget) return dataUrl;
      } else {
        for (let quality = INITIAL_QUALITY; quality >= MIN_QUALITY - 1e-9; quality -= QUALITY_STEP) {
          const dataUrl = encode(canvas, quality, transparent);
          if (dataUrl.length <= budget) return dataUrl;
        }
      }
      if (dimension <= minDimension) break;
      dimension = Math.max(minDimension, Math.round(dimension * DIMENSION_STEP));
    }
    throw new Error("Plus assez de place dans cette confidence pour cette image. Retirez ou remplacez une autre image.");
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible."));
    };
    img.src = url;
  });
}
