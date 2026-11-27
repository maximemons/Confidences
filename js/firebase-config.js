import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCNBE_8jT5Tzvqf0jI1_dIWcJWKnnueesM",
  authDomain: "confidences-2dd1d.firebaseapp.com",
  projectId: "confidences-2dd1d",
  storageBucket: "confidences-2dd1d.firebasestorage.app",
  messagingSenderId: "54880320430",
  appId: "1:54880320430:web:05121e2482b5e10565263f"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
