// Les images sont stockées en base64 dans le document Firestore de la confidence.
// Firestore impose une limite technique de 1 Mio par document : c'est elle qui
// borne le poids total des images. Les valeurs ci-dessous sont des réglages
// (qualité / définition) ajustables, pas des limites techniques.
const MAX_DIMENSION = 1280; // côté le plus long, en px
const MIN_DIMENSION = 480; // on ne descend pas en dessous lors de l'ajustement
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

// WebP est ~25-35 % plus léger que JPEG à qualité égale. Safari ne sait pas
// encoder en WebP via canvas : on retombe alors sur JPEG.
function encode(canvas, quality) {
  if (supportsWebp()) return canvas.toDataURL("image/webp", quality);
  return canvas.toDataURL("image/jpeg", quality);
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
    const longest = Math.max(img.width, img.height);
    let dimension = Math.min(MAX_DIMENSION, longest);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    while (true) {
      const scale = dimension / longest;
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (let quality = INITIAL_QUALITY; quality >= MIN_QUALITY - 1e-9; quality -= QUALITY_STEP) {
        const dataUrl = encode(canvas, quality);
        if (dataUrl.length <= budget) return dataUrl;
      }
      if (dimension <= MIN_DIMENSION) break;
      dimension = Math.max(MIN_DIMENSION, Math.round(dimension * DIMENSION_STEP));
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
