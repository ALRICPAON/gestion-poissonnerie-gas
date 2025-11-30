// js/admin-users.js
// Page admin: création d'utilisateur via la Cloud Function `createUser`
import { app, auth, db } from '/js/firebase-init.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

const MODULES = ['achats','stock','articles','fournisseurs','inventaire','transformation','compta'];

// Créer la grille de modules
function renderModules() {
  const container = document.getElementById('modules-list');
  container.innerHTML = MODULES.map(m => `
    <label><input type="checkbox" name="modules" value="${m}"> ${m}</label>
  `).join('');
}

// Affiche message
function showResult(msg, ok = true) {
  const el = document.getElementById('result');
  el.textContent = msg;
  el.style.color = ok ? 'green' : 'crimson';
}

// Désactiver/activer le formulaire
function setFormEnabled(enabled) {
  document.getElementById('create-btn').disabled = !enabled;
  document.querySelectorAll('#create-user-form input, #create-user-form select').forEach(i => i.disabled = !enabled);
  document.getElementById('spinner').style.display = enabled ? 'none' : 'inline';
}

renderModules();

// --- Hook après authentification (auth.js appellera window.__afterAuth(user) )
window.__afterAuth = async (user) => {
  try {
    setFormEnabled(false);
    // Vérifier que l'utilisateur connecté est provisionné comme admin dans app_users
    const udoc = await getDoc(doc(db, 'app_users', user.uid));
    if (!udoc.exists()) {
      alert('Compte non configuré. Contacte le support.');
      await auth.signOut();
      return;
    }
    const data = udoc.data();
    if (data.role !== 'admin') {
      alert('Accès refusé : page réservée aux administrateurs.');
      await auth.signOut();
      return;
    }

    // OK c'est un admin → activer le formulaire
    setFormEnabled(true);

    // initialiser l'UI (ex: pré-remplir modules si besoin)
    showResult(`Connecté en tant que ${data.displayName || user.email}`);
  } catch (err) {
    console.error('Erreur __afterAuth:', err);
    alert('Erreur lors de la vérification admin');
    await auth.signOut();
  }
};

// demander le guard (auth.js défini requireAuth())
// Si requireAuth existe, l'appellera et déclenchera __afterAuth
if (typeof window.requireAuth === 'function') {
  window.requireAuth();
} else {
  console.warn('requireAuth() non trouvé — la page attend que le client gère l’auth.');
  // fallback: si l'utilisateur est déjà connecté, appeler __afterAuth manuellement
  if (auth.currentUser && typeof window.__afterAuth === 'function') {
    window.__afterAuth(auth.currentUser);
  }
}

// Fonction helper : récupère les modules cochés
function readModules() {
  return Array.from(document.querySelectorAll('input[name="modules"]:checked')).map(i => i.value);
}

// Submit handler
document.getElementById('create-user-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  setFormEnabled(false);
  showResult('');
  try {
    // Vérif authentification
    if (!auth.currentUser) {
      showResult('Tu dois être connecté en tant qu’admin', false);
      setFormEnabled(true);
      return;
    }

    const email = document.getElementById('email').value.trim();
    const displayName = document.getElementById('displayName').value.trim();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const modules = readModules();

    if (!email || !password) {
      showResult('Email et mot de passe obligatoires', false);
      setFormEnabled(true);
      return;
    }

    // Appel Cloud Function
    const functions = getFunctions(app, 'europe-west1');
    const createUserFn = httpsCallable(functions, 'createUser');

    const payload = { email, password, displayName, role, modules };

    showResult('Création en cours…', true);
    const res = await createUserFn(payload);
    // res.data === { uid, email } selon la fonction
    showResult(`Utilisateur créé : ${res.data.uid} — ${res.data.email}`, true);

    // reset du formulaire (sans vider la liste de modules par commodité)
    document.getElementById('create-user-form').reset();
  } catch (err) {
    console.error('Erreur createUserFn:', err);
    // Firebase callable errors ont souvent la structure err.message ou err.code
    const msg = err?.message || (err?.code ? String(err.code) : 'Erreur inconnue');
    showResult(`Erreur : ${msg}`, false);
  } finally {
    setFormEnabled(true);
  }
});
