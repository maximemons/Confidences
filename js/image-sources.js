// Sources d'image : fichier, caméra ou lien.
// Quelle que soit la source, on obtient un fichier image qui est ensuite
// compressé et stocké dans la confidence (comme un import de fichier) :
// rien n'est chargé depuis un site tiers au moment de la lecture.

const MAX_REMOTE_BYTES = 25 * 1024 * 1024;

/** Téléphone / tablette : l'appareil photo natif donne la meilleure qualité. */
export function prefersNativeCamera() {
  return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
}

export function hasLiveCamera() {
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

function asImageFile(blob, name = "image") {
  const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  return new File([blob], name, { type });
}

/* ---------------- Caméra (ordinateur) ---------------- */

/**
 * Ouvre une fenêtre avec l'aperçu de la caméra et renvoie la photo prise,
 * ou null si l'utilisateur annule. Lève une erreur si la caméra est
 * inaccessible (refus, absence de caméra…).
 */
export function captureFromCamera(modalRoot) {
  return new Promise((resolve, reject) => {
    let stream = null;
    let facing = "environment";
    let settled = false;

    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal--camera" role="dialog" aria-label="Prendre une photo">
          <h3 class="modal__title">Prendre une photo</h3>
          <div class="camera-view">
            <video id="camera-video" playsinline autoplay muted></video>
            <p class="camera-view__status" id="camera-status">Activation de la caméra…</p>
          </div>
          <div class="modal__actions modal__actions--spread">
            <button class="btn btn--ghost btn--sm" id="camera-switch" type="button" hidden>⟲ Changer de caméra</button>
            <span class="modal__spacer"></span>
            <button class="btn btn--ghost btn--sm" id="camera-cancel" type="button">Annuler</button>
            <button class="btn btn--primary btn--sm" id="camera-shoot" type="button" disabled>📷 Prendre la photo</button>
          </div>
        </div>
      </div>`;

    const video = modalRoot.querySelector("#camera-video");
    const status = modalRoot.querySelector("#camera-status");
    const btnShoot = modalRoot.querySelector("#camera-shoot");
    const btnSwitch = modalRoot.querySelector("#camera-switch");

    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const close = (result, error) => {
      if (settled) return;
      settled = true;
      stop();
      document.removeEventListener("keydown", onKey);
      modalRoot.innerHTML = "";
      if (error) reject(error);
      else resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKey);

    async function start() {
      stop();
      btnShoot.disabled = true;
      status.hidden = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
      } catch (err) {
        const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
        close(
          null,
          new Error(
            denied
              ? "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur."
              : "Aucune caméra disponible sur cet appareil."
          )
        );
        return;
      }
      if (settled) {
        stop();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      status.hidden = true;
      btnShoot.disabled = false;
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      btnSwitch.hidden = devices.filter((d) => d.kind === "videoinput").length < 2;
    }

    btnSwitch.addEventListener("click", () => {
      facing = facing === "environment" ? "user" : "environment";
      start();
    });
    modalRoot.querySelector("#camera-cancel").addEventListener("click", () => close(null));
    btnShoot.addEventListener("click", () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(video, 0, 0, w, h);
      btnShoot.disabled = true;
      canvas.toBlob(
        (blob) => (blob ? close(asImageFile(blob, "photo.jpg")) : close(null, new Error("Photo impossible."))),
        "image/jpeg",
        0.92
      );
    });

    start();
  });
}

/* ---------------- Lien ---------------- */

/** Demande une adresse d'image. Renvoie l'URL saisie, ou null si annulé. */
export function askImageUrl(modalRoot) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-label="Image depuis un lien">
          <h3 class="modal__title">Image depuis un lien</h3>
          <form id="link-form" novalidate>
            <div class="field" style="margin-bottom:8px;">
              <label for="link-url">Adresse de l'image</label>
              <input id="link-url" type="url" inputmode="url" autocomplete="off" placeholder="https://…/photo.jpg" />
            </div>
            <p class="field-hint">L'image est copiée dans la confidence : elle restera visible même si le lien disparaît, et le site d'origine ne voit pas vos lecteurs.</p>
            <p class="field-error" id="link-error" hidden></p>
            <div class="modal__actions">
              <button class="btn btn--ghost btn--sm" id="link-cancel" type="button">Annuler</button>
              <button class="btn btn--primary btn--sm" type="submit">Importer</button>
            </div>
          </form>
        </div>
      </div>`;
    const input = modalRoot.querySelector("#link-url");
    const error = modalRoot.querySelector("#link-error");
    const close = (value) => {
      document.removeEventListener("keydown", onKey);
      modalRoot.innerHTML = "";
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKey);
    modalRoot.querySelector("#link-cancel").addEventListener("click", () => close(null));
    modalRoot.querySelector("#link-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!isImportableUrl(value)) {
        error.textContent = "Saisissez une adresse commençant par https:// (ou http://).";
        error.hidden = false;
        input.focus();
        return;
      }
      close(value);
    });
    // Coller directement une adresse copiée est le cas le plus courant.
    setTimeout(() => input.focus(), 50);
  });
}

export function isImportableUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "data:";
  } catch {
    return false;
  }
}

/**
 * Récupère l'image d'une adresse web sous forme de fichier.
 * Le site doit autoriser la récupération (CORS) : beaucoup le font
 * (Wikimedia, Unsplash, la plupart des CDN), certains non.
 */
export async function fetchImageFromUrl(value) {
  const url = new URL(value);
  let blob = null;
  try {
    const res = await fetch(url.href, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length"));
    if (length > MAX_REMOTE_BYTES) throw new Error("too-large");
    blob = await res.blob();
  } catch (err) {
    if (err?.message === "too-large") {
      throw new Error("Cette image est trop lourde (plus de 25 Mo).");
    }
    // Repli : certains serveurs n'acceptent la récupération que via une balise <img>.
    blob = await viaImageElement(url.href).catch(() => null);
    if (!blob) {
      throw new Error(
        `Impossible de récupérer l'image de ${url.hostname || "ce lien"} : le site ne l'autorise pas ou l'adresse ne pointe pas vers une image. Enregistrez-la sur votre appareil puis utilisez « Fichier ».`
      );
    }
  }
  if (blob.size > MAX_REMOTE_BYTES) throw new Error("Cette image est trop lourde (plus de 25 Mo).");
  if (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
    throw new Error("Ce lien ne pointe pas vers une image (c'est sans doute une page web). Copiez l'adresse de l'image elle-même.");
  }
  return asImageFile(blob, url.pathname.split("/").pop() || "image");
}

function viaImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blocked"))), "image/png");
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
}
