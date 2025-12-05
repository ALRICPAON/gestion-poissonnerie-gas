// js/home-qr.js
(() => {
  const QR_TARGET_URL = 'https://gestion-poissonnerie-gas.netlify.app/pages/home.html';

  function createQRCodeIn(containerId, url) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn('[home-qr] container introuvable:', containerId);
      return;
    }
    container.innerHTML = "";
    if (typeof QRCode === "undefined") {
      container.textContent = "Erreur: librairie QR introuvable.";
      return;
    }
    // création
    try {
      new QRCode(container, {
        text: url,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (e) {
      console.error('[home-qr] create QR failed', e);
      container.textContent = "Erreur génération QR.";
    }
  }

  function showModal() {
    const modal = document.getElementById('qr-modal');
    if (!modal) {
      alert("Modal QR introuvable (ajoute le HTML de la modal).");
      return;
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    // lock scroll
    document.documentElement.style.overflow = 'hidden';
  }

  function hideModal() {
    const modal = document.getElementById('qr-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
  }

  function downloadQR() {
    const container = document.getElementById('qr-container');
    if (!container) return;
    const img = container.querySelector('img');
    const canvas = container.querySelector('canvas');

    if (img && img.src) {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = 'qr-gestion-poissonnerie.png';
      a.click();
      return;
    }
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qr-gestion-poissonnerie.png';
      a.click();
      return;
    }
    alert("Impossible de générer le QR pour téléchargement.");
  }

  async function copyURLToClipboard() {
    try {
      await navigator.clipboard.writeText(QR_TARGET_URL);
      alert("URL copiée dans le presse-papier !");
    } catch (e) {
      console.warn("Copy failed:", e);
      prompt("Copie manuelle : Ctrl+C puis Entrée", QR_TARGET_URL);
    }
  }

  function initQR() {
    const btn = document.getElementById('btnGenQR');
    if (!btn) {
      console.warn('[home-qr] btnGenQR introuvable');
      return;
    }
    btn.addEventListener('click', () => {
      createQRCodeIn('qr-container', QR_TARGET_URL);
      showModal();
    });

    const close = document.getElementById('qr-close');
    close && close.addEventListener('click', hideModal);

    const modal = document.getElementById('qr-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) hideModal();
      });
    }

    const down = document.getElementById('qr-download');
    down && down.addEventListener('click', downloadQR);

    const copy = document.getElementById('qr-copy');
    copy && copy.addEventListener('click', copyURLToClipboard);

    const openLink = document.getElementById('qr-open');
    if (openLink) openLink.href = QR_TARGET_URL;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideModal();
    });
  }

  // si DOMContentLoaded déjà passé, init tout de suite
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQR);
  } else {
    // déjà chargé -> init immédiatement
    setTimeout(initQR, 0);
  }
})();
