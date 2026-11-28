/**
 * Chiffrement du contenu d'une confidence protégée par mot de passe.
 *
 * Tout se passe dans le navigateur (Web Crypto) : le mot de passe ne quitte
 * jamais l'appareil du lecteur, et Firestore ne contient que le texte chiffré.
 *
 *  - dérivation de clé : PBKDF2-SHA-256 (sel aléatoire de 16 octets, 600 000 itérations)
 *  - chiffrement      : AES-256-GCM (IV aléatoire de 12 octets à chaque écriture ;
 *                       GCM authentifie les données, un mauvais mot de passe est
 *                       donc détecté de façon fiable)
 *  - avant chiffrement, le JSON est compressé en gzip quand le navigateur le permet
 *    (utile : le document Firestore est limité à 1 Mio)
 *
 * Format du texte chiffré : IV (12 octets) | AES-GCM( drapeau (1 octet) | JSON ).
 * Drapeau : 0 = JSON brut, 1 = JSON compressé en gzip.
 */

export const DEFAULT_ITERATIONS = 600000;
const MAX_ITERATIONS = 2000000; // garde-fou à la lecture
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/** Même mot de passe, quelle que soit la façon dont le clavier compose les accents. */
function normalizePassword(password) {
  return String(password ?? "").normalize("NFC");
}

export async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  const n = Number(iterations);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ITERATIONS) throw new Error("bad-iterations");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizePassword(password)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: n, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canGzip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

/** Chiffre un objet JSON avec une clé déjà dérivée. Renvoie IV + texte chiffré. */
export async function encryptJson(key, value) {
  let body = encoder.encode(JSON.stringify(value));
  let flag = 0;
  if (canGzip) {
    try {
      body = await pipe(body, new CompressionStream("gzip"));
      flag = 1;
    } catch {
      body = encoder.encode(JSON.stringify(value));
    }
  }
  const plain = new Uint8Array(body.length + 1);
  plain[0] = flag;
  plain.set(body, 1);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(IV_BYTES + cipher.length);
  out.set(iv, 0);
  out.set(cipher, IV_BYTES);
  return out;
}

/** Déchiffre ; lève une erreur si la clé (donc le mot de passe) est mauvaise. */
export async function decryptJson(key, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length <= IV_BYTES + 16) throw new Error("bad-payload");
  const iv = bytes.slice(0, IV_BYTES);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(IV_BYTES))
  );
  let body = plain.slice(1);
  if (plain[0] === 1) {
    if (!canGzip) throw new Error("gzip-unsupported");
    body = await pipe(body, new DecompressionStream("gzip"));
  }
  return JSON.parse(decoder.decode(body));
}
