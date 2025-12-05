// js/home-qr.js
(() => {
  const QR_TARGET_URL = 'https://gestion-poissonnerie-gas.netlify.app/pages/home.html';

  // Genère un QR "hors écran" à la résolution demandée et renvoie dataURL PNG
  async function createQRCodeDataURL(url, pxSize = 1024) {
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

    try {
      // Create big QR for print quality
      new QRCode(wrapper, {
        text: url,
        width: pxSize,
        height: pxSize,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (e) {
      console.error('[home-qr] Erreur création QR', e);
      document.body.removeChild(wrapper);
      return null;
    }

    // petit délai pour que la librairie insère l'élément
    await new Promise(r => setTimeout(r, 60));

    let dataUrl = null;
    const img = wrapper.querySelector('img');
    const canvas = wrapper.querySelector('canvas');

    if (img && img.src) dataUrl = img.src;
    else if (canvas) {
      try { dataUrl = canvas.toDataURL('image/png'); }
      catch (e) { console.warn('[home-qr] canvas.toDataURL failed', e); }
    } else {
      console.warn('[home-qr] aucun img ni canvas trouvé dans wrapper');
    }

    document.body.removeChild(wrapper);
    return dataUrl;
  }

  // Télécharge un dataURL
  function downloadDataURL(dataUrl, filename = 'qr-gestion-poissonnerie.pdf') {
    if (!dataUrl) {
      alert("Impossible de générer le QR.");
      return;
    }

    // Utilise jsPDF pour créer le PDF
    const jspdfGlobal = window.jspdf || window.jspdf === undefined ? window.jspdf : null;
    const jsPDF_ctor = jspdfGlobal && jspdfGlobal.jsPDF ? jspdfGlobal.jsPDF : (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);

    // fallback: si jsPDF indisponible, on télécharge l'image PNG
    if (!jsPDF_ctor && !window.jsPDF) {
      // si pas jsPDF, on propose le PNG
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'qr-gestion-poissonnerie.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    const jsPDFClass = jsPDF_ctor || window.jsPDF;

    try {
      // A4 portrait en mm
      const doc = new jsPDFClass({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = 210;
      const pageH = 297;

      // Taille du QR sur la page (mm) — tu peux ajuster (ex: 100 mm)
      const qrMm = 100;

      const x = (pageW - qrMm) / 2;
      const y = (pageH - qrMm) / 2;

      // addImage(dataUrl, format, x, y, widthMm, heightMm)
      doc.addImage(dataUrl, 'PNG', x, y, qrMm, qrMm);

      // Téléchargement
      doc.save('qr-entrepot.pdf');
    } catch (e) {
      console.error('[home-qr] Erreur création PDF', e);
      alert('Erreur lors de la génération du PDF. Voir console.');
    }
  }

  // Ouvre le PDF dans un nouvel onglet (bloburl) et déclenche print()
  function openPdfAndPrintFromDataUrl(dataUrl) {
    const jspdfGlobal = window.jspdf || window.jspdf === undefined ? window.jspdf : null;
    const jsPDF_ctor = jspdfGlobal && jspdfGlobal.jsPDF ? jspdfGlobal.jsPDF : (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
    const jsPDFClass = jsPDF_ctor || window.jsPDF;
    try {
      const doc = new jsPDFClass({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = 210;
      const pageH = 297;
      const qrMm = 100;
      const x = (pageW - qrMm) / 2;
      const y = (pageH - qrMm) / 2;
      doc.addImage(dataUrl, 'PNG', x, y, qrMm, qrMm);
      const blobUrl = doc.output('bloburl');
      const w = window.open(blobUrl);
      if (w) {
        setTimeout(() => { try { w.print(); } catch (e) { /*ignore*/ } }, 700);
      } else {
        // popup bloquée -> proposer téléchargement
        doc.save('qr-entrepot.pdf');
      }
    } catch (e) {
      console.error('[home-qr] open+print failed', e);
      alert('Impossible d\'ouvrir le PDF pour impression. Téléchargement exécuté.');
      // fallback download
      try {
        const doc2 = new jsPDFClass({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = 210, pageH = 297, qrMm = 100, x = (pageW - qrMm)/2, y = (pageH - qrMm)/2;
        doc2.addImage(dataUrl, 'PNG', x, y, qrMm, qrMm);
        doc2.save('qr-entrepot.pdf');
      } catch (err) { console.error(err); }
    }
  }

  // gestionnaire principal : clic -> pdf ou open+print si shiftKey
  async function handleGeneratePDF(e) {
    try {
      e && e.preventDefault && e.preventDefault();
      const btn = e && e.currentTarget;
      if (btn) {
        btn.disabled = true;
        btn.dataset.orig = btn.textContent;
        btn.textContent = 'Génération en cours…';
      }

      const dataUrl = await createQRCodeDataURL(QR_TARGET_URL, 1024);
      if (!dataUrl) {
        alert("Erreur lors de la génération du QR.");
        return;
      }

      if (e && e.shiftKey) {
        openPdfAndPrintFromDataUrl(dataUrl);
      } else {
        downloadDataURL(dataUrl, 'qr-entrepot.pdf');
      }
    } catch (err) {
      console.error('[home-qr] handle error', err);
      alert('Erreur lors de la génération du PDF. Regarde la console.');
    } finally {
      const btn = e && e.currentTarget;
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.orig || '📱 Générer QR d\'accès Entrepôt';
      }
    }
  }

  function init() {
    const btn = document.getElementById('btnGenQR');
    if (!btn) { console.warn('[home-qr] btnGenQR introuvable'); return; }
    btn.addEventListener('click', handleGeneratePDF);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);
})();
