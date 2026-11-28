import {
  collection,
  doc,
  addDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  serverTimestamp,
  increment,
  writeBatch,
  setDoc,
  deleteField,
  Bytes
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { todayISO } from "./slide-render.js";
import {
  DEFAULT_ITERATIONS,
  randomSalt,
  deriveKey,
  encryptJson,
  decryptJson
} from "./crypto.js";

const PRESENTATIONS = "presentations";

export function emptySlide() {
  return {
    id: crypto.randomUUID(),
    orientation: "portrait",
    background: { type: "color", color: "#14141c", imageUrl: "" },
    text: {
      content: "",
      font: "Inter",
      color: "#f5f0e8",
      size: "medium",
      align: "center",
      boxMode: "auto",
      boxColor: "#000000",
      boxOpacity: 85
    },
    image: {
      url: "",
      fit: "cover",
      position: "center",
      posX: 50,
      posY: 50,
      scale: 100,
      borderWidth: 0,
      borderColor: "#ffffff"
    },
    transition: { type: "fade", speed: "normal" }
  };
}

export async function createPresentation(ownerId, ownerEmail, categoryId = null) {
  const ref = await addDoc(collection(db, PRESENTATIONS), {
    ownerId,
    ownerEmail: ownerEmail || "",
    categoryId: categoryId || null,
    title: "Sans titre",
    showTitle: false,
    writtenAt: todayISO(),
    slides: [emptySlide()],
    viewCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export function watchMyPresentations(ownerId, callback) {
  const q = query(
    collection(db, PRESENTATIONS),
    where("ownerId", "==", ownerId),
    orderBy("updatedAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    callback(items);
  });
}

export async function getPresentation(id) {
  const snap = await getDoc(doc(db, PRESENTATIONS, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export function watchPresentation(id, callback) {
  return onSnapshot(doc(db, PRESENTATIONS, id), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function renamePresentation(id, title) {
  await updateDoc(doc(db, PRESENTATIONS, id), {
    title: title.trim() || "Sans titre",
    updatedAt: serverTimestamp()
  });
}

export async function setShowTitle(id, showTitle) {
  await updateDoc(doc(db, PRESENTATIONS, id), {
    showTitle: !!showTitle,
    updatedAt: serverTimestamp()
  });
}

export async function setWrittenAt(id, writtenAt) {
  await updateDoc(doc(db, PRESENTATIONS, id), {
    writtenAt,
    updatedAt: serverTimestamp()
  });
}

export async function setFeedback(id, feedback) {
  await updateDoc(doc(db, PRESENTATIONS, id), {
    feedback: {
      enabled: !!feedback.enabled,
      message: String(feedback.message || ""),
      allowComment: !!feedback.allowComment
    },
    updatedAt: serverTimestamp()
  });
}

/* ---------------- Protection par mot de passe ----------------
   Une confidence protégée garde ses pages chiffrées dans `payload` (octets) ;
   `slides` reste vide et `protection` décrit le chiffrement (sel, itérations,
   nombre de pages). Le mot de passe est aussi mémorisé dans un document réservé
   au propriétaire (`presentations/{id}/private/protection`) pour qu'il puisse
   rouvrir et modifier sa confidence sans le retaper. */

// Clés AES déjà dérivées des confidences protégées ouvertes dans l'éditeur.
const editorKeys = new Map();
// Écritures chiffrées mises à la queue : elles partent dans l'ordre.
const saveQueues = new Map();

export function isProtected(pres) {
  return !!pres && pres.protection?.enabled === true && !!pres.payload;
}

function secretRef(id) {
  return doc(db, PRESENTATIONS, id, "private", "protection");
}

/** Mot de passe mémorisé pour le propriétaire (null s'il n'est pas lisible). */
export async function getProtectionSecret(id) {
  const snap = await getDoc(secretRef(id));
  return snap.exists() ? snap.data().password || null : null;
}

export async function setProtectionSecret(id, password) {
  await setDoc(secretRef(id), { password, updatedAt: serverTimestamp() });
}

/** Déchiffre les pages d'une confidence protégée. Lève une erreur si le mot de passe est faux. */
export async function decryptPresentation(pres, password) {
  const { salt, iterations } = pres.protection;
  const key = await deriveKey(password, salt.toUint8Array(), iterations);
  const data = await decryptJson(key, pres.payload.toUint8Array());
  if (!data || !Array.isArray(data.slides) || data.slides.length === 0) throw new Error("bad-payload");
  return { key, slides: data.slides };
}

/** Éditeur : déchiffre les pages et garde la clé pour chiffrer les sauvegardes suivantes. */
export async function unlockForEditing(pres, password) {
  const { key, slides } = await decryptPresentation(pres, password);
  editorKeys.set(pres.id, key);
  return slides;
}

/** Active (ou change) le mot de passe : chiffre les pages actuelles. */
export async function enableProtection(id, slides, password) {
  const salt = randomSalt();
  const iterations = DEFAULT_ITERATIONS;
  const key = await deriveKey(password, salt, iterations);
  const payload = await encryptJson(key, { slides });
  // Le mot de passe est enregistré d'abord : s'il échouait après, le propriétaire
  // ne pourrait plus rouvrir sa confidence.
  await setProtectionSecret(id, password);
  await updateDoc(doc(db, PRESENTATIONS, id), {
    protection: {
      enabled: true,
      salt: Bytes.fromUint8Array(salt),
      iterations,
      pages: slides.length
    },
    payload: Bytes.fromUint8Array(payload),
    slides: [],
    updatedAt: serverTimestamp()
  });
  editorKeys.set(id, key);
}

/** Retire le mot de passe : les pages redeviennent lisibles par toute personne ayant le lien. */
export async function disableProtection(id, slides) {
  // Laisse partir les sauvegardes chiffrées en cours, pour qu'aucune ne passe après.
  await (saveQueues.get(id) || Promise.resolve()).catch(() => {});
  await updateDoc(doc(db, PRESENTATIONS, id), {
    protection: deleteField(),
    payload: deleteField(),
    slides,
    updatedAt: serverTimestamp()
  });
  editorKeys.delete(id);
  await deleteDoc(secretRef(id)).catch(() => {});
}

/** À appeler en quittant l'éditeur. */
export function forgetEditorKey(id) {
  editorKeys.delete(id);
}

export function saveSlides(id, slides) {
  const key = editorKeys.get(id);
  if (!key) {
    return updateDoc(doc(db, PRESENTATIONS, id), {
      slides,
      updatedAt: serverTimestamp()
    });
  }
  const previous = saveQueues.get(id) || Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async () => {
      const payload = await encryptJson(key, { slides });
      await updateDoc(doc(db, PRESENTATIONS, id), {
        payload: Bytes.fromUint8Array(payload),
        "protection.pages": slides.length,
        updatedAt: serverTimestamp()
      });
    });
  saveQueues.set(id, run);
  return run;
}

export async function deletePresentation(id) {
  const viewsSnap = await getDocs(collection(db, PRESENTATIONS, id, "views"));
  const refs = viewsSnap.docs.map((d) => d.ref);
  // Le mot de passe mémorisé part avec la confidence (les règles vérifient le parent : il doit exister).
  await deleteDoc(secretRef(id)).catch(() => {});
  editorKeys.delete(id);
  // Firestore batches are limited to 500 writes: delete views in chunks,
  // then the presentation itself (rules check ownership on the parent).
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  await deleteDoc(doc(db, PRESENTATIONS, id));
}

/**
 * Enregistre une consultation et renvoie l'identifiant du document créé.
 * Aucune donnée personnelle n'est collectée : seulement la date, le type
 * d'appareil (déduit de l'écran) et, ensuite, la progression et la durée.
 */
export async function logView(id, { device, slideCount }) {
  const ref = await addDoc(collection(db, PRESENTATIONS, id, "views"), {
    viewedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    device,
    slideCount,
    maxSlide: 1,
    completed: slideCount <= 1,
    durationMs: 0
  });
  await updateDoc(doc(db, PRESENTATIONS, id), {
    viewCount: increment(1)
  });
  return ref.id;
}

/** Met à jour la progression et la durée d'une consultation en cours. */
export async function updateViewProgress(id, viewId, { maxSlide, completed, durationMs }) {
  await updateDoc(doc(db, PRESENTATIONS, id, "views", viewId), {
    maxSlide,
    completed,
    durationMs,
    lastActiveAt: serverTimestamp()
  });
}

/** Enregistre l'avis (note 1–5 et commentaire facultatif) d'une consultation. */
export async function updateViewFeedback(id, viewId, { rating, comment }) {
  const data = {
    rating,
    feedbackAt: serverTimestamp(),
    lastActiveAt: serverTimestamp()
  };
  if (comment) data.comment = comment;
  await updateDoc(doc(db, PRESENTATIONS, id, "views", viewId), data);
}

export function watchViews(id, callback) {
  const q = query(
    collection(db, PRESENTATIONS, id, "views"),
    orderBy("viewedAt", "desc"),
    limit(50)
  );
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    callback(items);
  });
}
