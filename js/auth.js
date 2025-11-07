// js/auth.js — version avec logs & états UI
import { auth } from './firebase-init.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';

// --- Helpers UI ---
function setLoading(isLoading) {
  const btn = document.querySelector('#login-btn');
  if (!btn) return;
  btn.disabled = !!isLoading;
  btn.textContent = isLoading ? 'Connexion…' : 'Se connecter';
}

function showError(msg) {
  const el = document.querySelector('#login-error');
  if (!el) return;
  el.textContent = msg || '';
}

// --- Redirection si déjà connecté (utilisée sur login) ---
export function redirectIfLoggedIn(target = '/pages/home.html') {
  console.log('[auth] redirectIfLoggedIn: listen auth state');
  onAuthStateChanged(auth, (user) => {
    console.log('[auth] onAuthStateChanged (login page):', !!user, user && user.email);
    if (user) {
      window.location.replace(target);
    }
  });
}

// --- Guard générique (utilisé sur toutes les pages protégées) ---
export function requireAuth() {
  console.log('[auth] requireAuth: listen auth state');
  onAuthStateChanged(auth, (user) => {
    console.log('[auth] onAuthStateChanged (guarded page):', !!user, user && user.email);
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

// --- Login handler ---
window.addEventListener('DOMContentLoaded', () => {
  console.log('[auth] DOMContentLoaded');
  const form = document.querySelector('#login-form');
  if (!form) {
    console.warn('[auth] #login-form not found on this page');
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('[auth] submit login');
    const email = (document.querySelector('#email')?.value || '').trim();
    const pwd   = (document.querySelector('#password')?.value || '');
    showError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, pwd);
      const url = new URL(location.href);
      const next = url.searchParams.get('next') || '/pages/home.html';
      console.log('[auth] login ok → redirect', next);
      location.replace(next);
    } catch (err) {
      console.error('[auth] login error:', err);
      showError(err && err.message ? err.message : 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  });
});

// --- Logout global ---
export async function doLogout() {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('[auth] signOut warning:', e);
  }
  location.replace('/pages/login.html');
}
