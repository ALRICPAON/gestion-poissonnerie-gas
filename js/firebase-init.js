// Firebase init — Remplis la config puis décommente l'appel initializeApp.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';

// Tu peux définir la config globalement dans window.__FIREBASE_CONFIG
// (définie par Firebase Hosting via /__/firebase/init.js) ou la coller ici.
const cfg = window.__FIREBASE_CONFIG || {
  apiKey: "XXX",
  authDomain: "XXX.firebaseapp.com",
  projectId: "XXX",
  appId: "XXX",
};

export const app = initializeApp(cfg);
export const auth = getAuth(app);
