// js/firebase-init.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-analytics.js';

const cfg = {
  apiKey: "// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC_e4oTnRwr1Bpa3ls8HoYFljaR49knnyQ",
  authDomain: "poissonnerie-gas.firebaseapp.com",
  projectId: "poissonnerie-gas",
  storageBucket: "poissonnerie-gas.firebasestorage.app",
  messagingSenderId: "1017257016151",
  appId: "1:1017257016151:web:0693a2c9c8bfa4252d5c12",
  measurementId: "G-MG8KM90PXP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);",
  authDomain: "poissonnerie-gas.firebaseapp.com",
  projectId: "poissonnerie-gas",
  storageBucket: "poissonnerie-gas.appspot.com", // <-- important: appspot.com
  messagingSenderId: "1017257016151",
  appId: "1:1017257016151:web:0693a2c9c8bfa4252d5c12",
  measurementId: "G-MG8KM90PXP"
};

export const app = initializeApp(cfg);
export const auth = getAuth(app);

// Analytics facultatif
isSupported().then(ok => ok && getAnalytics(app)).catch(() => {});
