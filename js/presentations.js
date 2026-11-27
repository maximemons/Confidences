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

const PRESENTATIONS = "presentations";

export function emptySlide() {
  return {
    id: crypto.randomUUID(),
    orientation: "portrait",
    background: { type: "color", color: "#14141c", imageUrl: "" },
    text: { content: "", font: "Inter", color: "#f5f0e8", size: "medium", align: "center" },
    image: { url: "", fit: "cover", position: "center" }
  };
}

export async function createPresentation(ownerId, ownerEmail) {
  const ref = await addDoc(collection(db, PRESENTATIONS), {
    ownerId,
    ownerEmail: ownerEmail || "",
    title: "Sans titre",
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

export async function saveSlides(id, slides) {
  await updateDoc(doc(db, PRESENTATIONS, id), {
    slides,
    updatedAt: serverTimestamp()
  });
}

export async function deletePresentation(id) {
  const viewsSnap = await getDocs(collection(db, PRESENTATIONS, id, "views"));
  const batch = writeBatch(db);
  viewsSnap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, PRESENTATIONS, id));
  await batch.commit();
}

export async function logView(id) {
  await addDoc(collection(db, PRESENTATIONS, id, "views"), {
    viewedAt: serverTimestamp()
  });
  await updateDoc(doc(db, PRESENTATIONS, id), {
    viewCount: increment(1)
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
