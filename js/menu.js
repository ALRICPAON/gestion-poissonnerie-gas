// Simple topbar menu
import { doLogout } from './auth.js';

const modules = [
  { key:'home', label:'Accueil', href:'/pages/home.html' },
  { key:'articles', label:'Articles', href:'/pages/articles.html' },
  { key:'fournisseurs', label:'Fournisseurs', href:'/pages/fournisseurs.html' },
  { key:'achats', label:'Achats', href:'/pages/achats.html' },
  { key:'stock', label:'Stock', href:'/pages/stock.html' },
  { key:'inventaire', label:'Inventaire', href:'/pages/inventaire.html' },
  { key:'tracabilite', label:'Traçabilité', href:'/pages/tracabilite.html' },
  { key:'tdb', label:'Tableau de bord', href:'/pages/tableau-de-bord.html' },
  { key:'transformations', label:'Transformations', href:'/pages/transformations.html' },
  { key:'etiquettes', label:'Étiquettes', href:'/pages/etiquettes.html' },
];

function activeKeyFromPath(){
  const p = location.pathname;
  const found = modules.find(m => p.endsWith('/' + m.href.split('/').pop()));
  return found ? found.key : 'home';
}

function renderTopbar(){
  const el = document.querySelector('#topbar');
  if (!el) return;
  const active = activeKeyFromPath();
  el.innerHTML = `
    <div class="topbar">
      <div class="brand-mini"><img src="/assets/fish.svg" alt="" /><span>Poissonnerie</span></div>
      <nav class="menu">
        ${modules.map(m => `<a class="menu-item ${m.key===active?'active':''}" href="${m.href}">${m.label}</a>`).join('')}
      </nav>
      <div class="right">
        <button class="btn ghost" id="btn-logout" title="Se déconnecter">Déconnexion</button>
      </div>
    </div>
  `;
  const btn = el.querySelector('#btn-logout');
  if (btn) btn.addEventListener('click', doLogout);
}

window.addEventListener('DOMContentLoaded', renderTopbar);
