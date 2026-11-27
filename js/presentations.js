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
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { todayISO } from "./slide-render.js";

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

export async function createPresentation(ownerId, ownerEmail) {
  const ref = await addDoc(collection(db, PRESENTATIONS), {
    ownerId,
    ownerEmail: ownerEmail || "",
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

export async function saveSlides(id, slides) {
  await updateDoc(doc(db, PRESENTATIONS, id), {
    slides,
    updatedAt: serverTimestamp()
  });
}

export async function deletePresentation(id) {
  const viewsSnap = await getDocs(collection(db, PRESENTATIONS, id, "views"));
  const refs = viewsSnap.docs.map((d) => d.ref);
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
