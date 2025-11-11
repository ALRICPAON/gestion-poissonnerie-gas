import { read, utils } from "https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs";
import { db } from "./firebase-init.js";
import {
  collection, doc, setDoc, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

document.getElementById("importCrieeBtn").addEventListener("click", async () => {
  const file = document.getElementById("crieeFile").files[0];
  if (!file) return alert("Choisir un fichier Excel");

  const status = document.getElementById("importStatus");
  status.innerText = "Lecture fichier…";

  const rows = await readCrieeXLSX(file);
  status.innerText = `${rows.length} lignes détectées.`

  const afMap = await loadAFMap();
  status.innerText = `Mapping chargé (${Object.keys(afMap).length})`;

  await saveCrieeToFirestore(rows, afMap);
  status.innerText = "✅ Import terminé.";
});
