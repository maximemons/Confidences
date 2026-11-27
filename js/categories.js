import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

// Les catégories sont propres à chaque compte : users/{uid}.categories,
// une liste ordonnée de { id, name }. Une confidence pointe vers sa catégorie
// par `categoryId` (null ou absent = sans catégorie).

export const MAX_CATEGORIES = 50;
export const MAX_CATEGORY_NAME = 40;

function userDoc(uid) {
  return doc(db, "users", uid);
}

function sanitize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
    .map((c) => ({ id: c.id, name: c.name.slice(0, MAX_CATEGORY_NAME) }));
}

export function watchCategories(uid, callback) {
  return onSnapshot(
    userDoc(uid),
    (snap) => callback(sanitize(snap.exists() ? snap.data().categories : [])),
    () => callback([])
  );
}

export async function saveCategories(uid, categories) {
  await setDoc(
    userDoc(uid),
    { categories: sanitize(categories), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Range une confidence dans une catégorie (null = sans catégorie). */
export async function setPresentationCategory(presentationId, categoryId) {
  // Pas de mise à jour de updatedAt : ranger n'est pas modifier le contenu,
  // la confidence garde sa place dans l'ordre « dernière modification ».
  await updateDoc(doc(db, "presentations", presentationId), {
    categoryId: categoryId || null
  });
}

/**
 * Supprime une catégorie : ses confidences repassent « sans catégorie »
 * (elles ne sont jamais supprimées).
 */
export async function deleteCategory(uid, categories, categoryId, presentationIds) {
  for (let i = 0; i < presentationIds.length; i += 450) {
    const batch = writeBatch(db);
    presentationIds.slice(i, i + 450).forEach((id) => {
      batch.update(doc(db, "presentations", id), { categoryId: null });
    });
    await batch.commit();
  }
  await saveCategories(
    uid,
    categories.filter((c) => c.id !== categoryId)
  );
}
