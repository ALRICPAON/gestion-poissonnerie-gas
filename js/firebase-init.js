// js/firebase-init.js

import { initializeApp } from \"https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js\";
import { getAuth } from \"https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js\";

const firebaseConfig = {
  apiKey: \"AIzaSyC_e4oTnRwr1Bpa3ls8HoYFljaR49knnyQ\",
  authDomain: \"poissonnerie-gas.firebaseapp.com\",
  projectId: \"poissonnerie-gas\",
  storageBucket: \"poissonnerie-gas.appspot.com\",
  messagingSenderId: \"1017257016151\",
  appId: \"1:1017257016151:web:0693a2c9c8bfa4252d5c12\",
  measurementId: \"G-MG8KM90PXP\"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
