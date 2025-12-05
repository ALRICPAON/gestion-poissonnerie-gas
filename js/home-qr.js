// js/home-qr.js
(() => {
  const QR_TARGET_URL = 'https://gestion-poissonnerie-gas.netlify.app/pages/home.html';

  /**
   * Génère un QR hors-écran et renvoie un dataURL PNG.
   * Utilise QRCode.js (qrcode.min.js) pour générer un <img> ou <canvas>.
   */
  async function createQRCodeDataURL(url) {
    // wrapper hors écran
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.left = '-9999px';
    wrapper.style.top = '-9999px';
    wrapper.style.width = '1px';
    wrapper.style.height = '1px';
    document.body.appendChild(wrapper);

    if (typeof QRCode === 'undefined') {
      console.error('[home-qr] QRCode lib non chargée');
      document.body.removeChild(wrapper);
      return null;
    }

    // créer le QR (256x256)
    try {
      new QRCode(wrapper, {
        text: url,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (e) {
      console.error('[home-qr] Erreur création QR', e);
      document.body.removeChild(wrapper);
      return null;
    }

    // attendre un court instant pour que la librairie ait inséré l'élément
    await new Promise(r => setTimeout(r, 50));

    // rechercher img ou canvas
    let dataUrl = null;
    const img = wrapper.querySelector('img');
    const canvas = wrapper.querySelector('canvas');

    if (img && img.src) {
      dataUrl = img.src;
    } else if (canvas) {
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch (e) {
        console.warn('[home-qr] canvas.toDataURL failed', e);
      }
    } else {
      // fallback : essayer de serialiser le wrapper en svg/png n'est pas trivial
      console.warn('[home-qr] aucun img ni canvas trouvé dans wrapper');
    }

    // cleanup
    document.body.removeChild(wrapper);
    return dataUrl;
  }

  /** force le téléchargement d'un dataURL */
  function downloadDataURL(dataUrl, filename = 'qr-gestion-poissonnerie.png') {
    if (!dataUrl) {
      alert("Impossible de générer le QR pour téléchargement.");
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    // Some browsers require it be in DOM
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** Handler principal : génère & télécharge */
  async function handleGenerateAndDownload(e) {
    try {
      e && e.preventDefault && e.preventDefault();
      const btn = e && e.currentTarget;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Génération en cours…";
      }

      const dataUrl = await createQRCodeDataURL(QR_TARGET_URL);
      if (!dataUrl) {
        alert("Erreur lors de la génération du QR.");
      } else {
        // téléchargement automatique
        downloadDataURL(dataUrl);
      }
    } catch (err) {
      console.error("Erreur génération/téléchargement QR:", err);
      alert("Erreur lors du téléchargement du QR. Regarde la console.");
    } finally {
      if (e && e.currentTarget) {
        e.currentTarget.disabled = false;
        e.currentTarget.textContent = "📱 Générer QR d'accès Entrepôt";
      }
    }
  }

  function init() {
    const btn = document.getElementById('btnGenQR');
    if (!btn) {
      console.warn('[home-qr] btnGenQR introuvable');
      return;
    }

    // event : au clic, on génère et télécharge sans afficher le QR
    btn.addEventListener('click', handleGenerateAndDownload);

    // optionnel : bouton "Copier URL" si tu le veux
    const copyBtn = document.getElementById('qr-copy');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(QR_TARGET_URL);
        alert('URL copiée dans le presse-papier !');
      } catch (e) {
        prompt('Copie manuelle : Ctrl+C puis Entrée', QR_TARGET_URL);
      }
    });

    // si tu conserves le lien d'ouverture
    const openLink = document.getElementById('qr-open');
    if (openLink) openLink.href = QR_TARGET_URL;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();
