/* Profil : prénom et nom de la personne dont c'est la progression.
 * Un simple repère, écrit dans les sauvegardes et dans le nom de leurs fichiers ;
 * n'importe quel bouton [data-profile] ouvre la fenêtre pour le modifier. */
(function (FRM, ui) {
  "use strict";

  const { store } = FRM;
  let dialog = null;

  function build() {
    dialog = Object.assign(document.createElement("dialog"), { className: "profile-dialog" });
    dialog.innerHTML = `
<form method="dialog">
  <h2>Profil</h2>
  <p class="small muted">Un repère pour savoir à qui est cette progression : il est écrit dans les sauvegardes et dans le nom de leurs fichiers.</p>
  <label class="field">Prénom<input name="firstName" autocomplete="given-name" maxlength="40"></label>
  <label class="field">Nom<input name="lastName" autocomplete="family-name" maxlength="40"></label>
  <div class="dialog-actions">
    <button type="button" class="btn ghost" data-dialog-cancel>Annuler</button>
    <button type="submit" class="btn" value="save">Enregistrer</button>
  </div>
</form>`;
    dialog.querySelector("[data-dialog-cancel]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "save") return;
      const form = dialog.querySelector("form");
      store.profile.set({ firstName: form.firstName.value, lastName: form.lastName.value });
      ui.refresh();
      const name = store.profile.displayName();
      ui.flash(name ? `Profil : ${name}` : "Profil effacé");
    });
    document.body.appendChild(dialog);
  }

  function open() {
    if (!dialog) build();
    const current = store.profile.get() || { firstName: "", lastName: "" };
    const form = dialog.querySelector("form");
    form.firstName.value = current.firstName;
    form.lastName.value = current.lastName;
    dialog.returnValue = "";
    dialog.showModal();
    form.firstName.focus();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-profile]")) open();
  });

  FRM.profile = { open };
})(window.FRM, window.FRM.ui);
