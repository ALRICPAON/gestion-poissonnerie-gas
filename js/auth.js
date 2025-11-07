// Auth guard + login/logout
import { auth } from './firebase-init.js';
import { 
  onAuthStateChanged, signInWithEmailAndPassword, signOut 
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';

export function redirectIfLoggedIn(target='/pages/home.html'){
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.replace(target);
  });
}

export function requireAuth(){
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      const redirect = encodeURIComponent(location.pathname + location.search);
      location.replace('/pages/login.html?next=' + redirect);
    } else {
      window.__currentUser = user;
      if (typeof window.__afterAuth === 'function') window.__afterAuth(user);
    }
  });
}
window.__requireAuth = requireAuth;

window.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.querySelector('#email').value.trim();
    const pwd   = document.querySelector('#password').value;
    const errEl = document.querySelector('#login-error');
    errEl.textContent = '';

    try {
      await signInWithEmailAndPassword(auth, email, pwd);
      const url = new URL(location.href);
      const next = url.searchParams.get('next') || '/pages/home.html';
      location.replace(next);
    } catch (err) {
      errEl.textContent = (err && err.message) ? err.message : 'Connexion impossible.';
    }
  });
});

export async function doLogout(){
  await signOut(auth);
  location.replace('/pages/login.html');
}
