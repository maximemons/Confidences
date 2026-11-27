const MAX_DIMENSION = 900;
const INITIAL_QUALITY = 0.72;
const MIN_QUALITY = 0.35;
export const MAX_DATA_URL_BYTES = 160 * 1024;

export function compressImageToDataUrl(file) {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Le fichier doit être une image."));
  }
  return loadImage(file).then((img) => {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let quality = INITIAL_QUALITY;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > MAX_DATA_URL_BYTES && quality > MIN_QUALITY) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > MAX_DATA_URL_BYTES) {
      throw new Error("Image trop lourde même après compression : essayez une image plus simple.");
    }
    return dataUrl;
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
