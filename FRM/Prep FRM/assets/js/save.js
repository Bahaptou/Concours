/* Sauvegarde : export de nos données en fichier JSON daté (dossier save/) et chargement.
 *
 * Chrome et Edge ouvrent des fenêtres « Enregistrer sous » / « Ouvrir » qui partagent
 * le même identifiant, donc le même dossier mémorisé : save/ après le premier export.
 * Ailleurs, ou si le navigateur refuse : téléchargement classique et champ fichier. */
(function (FRM, ui) {
  "use strict";

  const { store } = FRM;
  const PICKER_ID = "prep-frm-save"; // le navigateur rouvre le dernier dossier utilisé avec cet id
  const JSON_TYPE = [{ description: "Sauvegarde Prep FRM", accept: { "application/json": [".json"] } }];

  const pad = (n) => String(n).padStart(2, "0");

  /** « Baptiste Durand » -> « baptiste-durand ». */
  function slug(text) {
    return text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  /** prep-frm_baptiste-durand_2026-09-30_14h05.json (sans profil : prep-frm_2026-09-30_14h05.json) */
  function fileName(date, profile) {
    const who = slug(store.profile.displayName(profile));
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return ["prep-frm", who, `${day}_${pad(date.getHours())}h${pad(date.getMinutes())}`].filter(Boolean).join("_") + ".json";
  }

  // ------------------------------------------------------------------ export

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function writeWithPicker(name, text) {
    const handle = await window.showSaveFilePicker({ id: PICKER_ID, suggestedName: name, types: JSON_TYPE });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return handle.name;
  }

  /** Renvoie { name, downloaded } ou null si l'export a été annulé. */
  async function exportSave() {
    const data = store.snapshot();
    const text = JSON.stringify(data, null, 2);
    const name = fileName(new Date(data.exportedAt), data.profile);
    let result = { name, downloaded: true };

    if (window.showSaveFilePicker) {
      try {
        result = { name: await writeWithPicker(name, text), downloaded: false };
      } catch (error) {
        if (error.name === "AbortError") return null;
        download(name, text);
      }
    } else {
      download(name, text);
    }
    store.markExported(data.exportedAt);
    ui.refresh();
    return result;
  }

  // ------------------------------------------------------------------ chargement

  /** Fichier choisi par l'utilisateur, ou null s'il annule. */
  async function pickFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ id: PICKER_ID, types: JSON_TYPE, multiple: false });
        return handle.getFile();
      } catch (error) {
        if (error.name === "AbortError") return null;
        /* fenêtre refusée par le navigateur : repli sur le champ fichier */
      }
    }
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
      input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
  }

  async function readSave(file) {
    try {
      return JSON.parse(await file.text());
    } catch (e) {
      throw new Error("Ce fichier n'est pas un JSON valide.");
    }
  }

  /** Charge une sauvegarde après confirmation ; renvoie le texte du message, ou null si annulé. */
  async function loadSave(file) {
    const data = await readSave(file);
    const saved = store.parse(data); // valide avant de demander quoi que ce soit
    const who = saved.profile === undefined ? "sans profil" : store.profile.displayName(saved.profile) || "sans nom";
    const when = data.exportedAt ? ` · export du ${ui.dateTime(data.exportedAt)}` : "";
    const ok = window.confirm(
      `Charger « ${file.name} » ?\n\nProfil : ${who}${when}\n\n` +
        "Cela remplace le profil, les étapes et les notes de ce navigateur. Exporte-les d'abord si tu veux les garder."
    );
    if (!ok) return null;
    store.restore(data);
    ui.refresh();
    return `Sauvegarde chargée : ${file.name}`;
  }

  async function chooseAndLoad() {
    const file = await pickFile();
    return file ? loadSave(file) : null;
  }

  // ------------------------------------------------------------------ boutons

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-export]")) {
      exportSave()
        .then((result) => {
          if (!result) return;
          const where = result.downloaded ? " (dans Téléchargements : à ranger dans save/)" : "";
          ui.flash(`Sauvegardé : ${result.name}${where}`);
        })
        .catch((error) => ui.flash(`Échec de l'export : ${error.message}`, "error"));
    } else if (event.target.closest("[data-import]")) {
      chooseAndLoad()
        .then((message) => message && ui.flash(message))
        .catch((error) => ui.flash(`Chargement impossible : ${error.message}`, "error"));
    }
  });

  // Sauvegarde vierge : on efface tout, puis on propose de saisir le profil du nouveau départ.
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-reset]")) return;
    const ok = window.confirm(
      "Créer une sauvegarde vierge ?\n\nProfil, étapes, notes, réponses aux questions, marques et historique " +
        "de ce navigateur seront effacés. Exporte-les d'abord si tu veux les garder."
    );
    if (!ok) return;
    store.reset();
    ui.refresh();
    ui.flash("Sauvegarde vierge créée.");
    if (FRM.profile) FRM.profile.open();
  });

  FRM.save = { exportSave, loadSave, fileName };
})(window.FRM, window.FRM.ui);
