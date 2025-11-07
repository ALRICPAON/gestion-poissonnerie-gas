# Gestion Poissonnerie — Starter (Web App)

- Frontend: Netlify (principal) ou Firebase Hosting (test)
- Auth: Firebase (email / mot de passe)
- Code: GitHub

## Configuration Firebase
1. Crée un projet Firebase, active l'auth Email/Password.
2. Récupère la config Web (apiKey, authDomain, projectId, appId).
3. Ouvre `js/firebase-init.js`, remplace la config puis déploie.

> Sur Firebase Hosting, tu peux utiliser `__/firebase/init.js` pour injecter la config automatiquement.

## Sécurité / Routage
- Toutes les pages dans `pages/` sont protégées par `requireAuth()` (redirection vers login si non connecté).
- `login.html` redirige vers `home.html` si déjà connecté.

## Déploiement Netlify
- Connecte le dépôt GitHub à Netlify.
- Le site démarre sur `/pages/login.html` via `_redirects` et `netlify.toml`.

## Déploiement Firebase Hosting (optionnel)
```
firebase init hosting
firebase deploy
```
Le `index.html` root redirige automatiquement vers `/pages/login.html`.

## Pousser sur GitHub (exemple)
```
git init
git branch -M master
git remote add origin https://github.com/ALRICPAON/gestion-poissonnerie-gas.git
git add .
git commit -m "feat: starter UI + auth guard + menu"
git push -u origin master
```

## À intégrer ensuite (modules)
- Brancher les pages avec Google Apps Script / API (Achats, Stock, Inventaire…).
- Ajouter Firestore / RTDB si besoin (multi‑magasin : `storeId` dans profils).
- UI: remplacer les panneaux "TODO" par les vraies vues.
