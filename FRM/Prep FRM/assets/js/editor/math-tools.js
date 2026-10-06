// Math buttons added from the editors, shared by everyone (notes/_outils-maths.json, through the
// server): shown after the built-in ones of the "Mode maths" bar. "＋" adds one (label, Typst to
// insert, optional part to select, live preview); "×" removes one, for everyone.
import * as api from "./api.js";
import { insertSnippet } from "./toolbar.js";

const { FRM } = window;
const { esc } = FRM.ui;

const PREVIEW_DELAY = 300;
const previewSource = (typst) => `#set page(width: auto, height: auto, margin: 4pt)\n#set text(size: 14pt)\n$ ${typst} $`;

/** Element for renderToolbar's mathExtras. `view`: the editor, or a function returning it. */
export function customMathTools(view) {
  const target = typeof view === "function" ? view : () => view;
  const root = Object.assign(document.createElement("span"), { className: "custom-math" });
  root.innerHTML = `
<span class="custom-math-buttons" data-mt-buttons></span>
<span class="picker">
  <button type="button" class="tool" data-mt-open aria-expanded="false" title="Ajouter un bouton à cette barre (partagé avec tout le monde)">＋</button>
  <div class="picker-panel mt-panel" hidden>
    <label class="field">Libellé du bouton<input data-mt-label maxlength="16" placeholder="ex. Corr" autocomplete="off"></label>
    <label class="field">Typst inséré<input data-mt-typst maxlength="200" placeholder='ex. op("Corr")(X, Y)' autocomplete="off"></label>
    <label class="field">Partie à sélectionner <span class="hint">facultatif : sélectionnée après insertion pour taper par-dessus ; une sélection faite avant la remplace</span><input data-mt-select placeholder="ex. X, Y" autocomplete="off"></label>
    <div class="mt-preview" data-mt-preview><span class="small muted">Aperçu du rendu</span></div>
    <div class="form-error" data-mt-error hidden></div>
    <div class="save-actions"><button type="button" class="btn" data-mt-add>Ajouter le bouton</button>
    <span class="small muted">Rangé dans <code>notes/_outils-maths.json</code>, pour tout le monde.</span></div>
  </div>
</span>`;
  const $ = (selector) => root.querySelector(selector);
  const panel = $(".mt-panel");
  const openButton = $("[data-mt-open]");
  const fields = { label: $("[data-mt-label]"), typst: $("[data-mt-typst]"), select: $("[data-mt-select]") };
  let tools = [];
  let previewTimer = null;
  let previewSeq = 0;

  function showError(text) {
    $("[data-mt-error]").textContent = text;
    $("[data-mt-error]").hidden = !text;
  }

  function renderButtons() {
    $("[data-mt-buttons]").innerHTML = tools
      .map(
        (tool) => `<span class="mt-tool"><button type="button" class="tool" data-mt-run="${esc(tool.id)}" title="${esc(tool.typst)}">${esc(tool.label)}</button><button type="button" class="mt-remove" data-mt-remove="${esc(tool.id)}" title="Retirer ce bouton, pour tout le monde">×</button></span>`
      )
      .join("");
  }

  async function load() {
    try {
      tools = (await api.listMathTools()).data.tools;
      renderButtons();
    } catch (error) {
      /* without the list, the built-in buttons still work */
    }
  }

  async function refreshPreview() {
    const seq = ++previewSeq;
    const typst = fields.typst.value.trim();
    const box = $("[data-mt-preview]");
    if (!typst) return (box.innerHTML = `<span class="small muted">Aperçu du rendu</span>`);
    try {
      const result = await api.compile({ method: "POST", href: "/api/compile" }, previewSource(typst));
      if (seq === previewSeq) box.innerHTML = result.data.pages.join("");
    } catch (error) {
      if (seq === previewSeq) box.innerHTML = `<span class="small muted">Ne compile pas : ${esc(error.problem?.explanation || error.message)}</span>`;
    }
  }

  function open() {
    panel.hidden = false;
    openButton.setAttribute("aria-expanded", "true");
    // "＋" ends the bar: shift the panel left when it would overflow the window.
    panel.style.left = "0px";
    const overflow = panel.getBoundingClientRect().right - (document.documentElement.clientWidth - 16);
    if (overflow > 0) panel.style.left = `${-overflow}px`;
    showError("");
    fields.label.focus();
  }

  function close() {
    panel.hidden = true;
    openButton.setAttribute("aria-expanded", "false");
  }

  async function add() {
    showError("");
    try {
      const result = await api.addMathTool({ label: fields.label.value, typst: fields.typst.value, select: fields.select.value });
      tools = result.data.tools;
      renderButtons();
      Object.values(fields).forEach((field) => (field.value = ""));
      $("[data-mt-preview]").innerHTML = `<span class="small muted">Aperçu du rendu</span>`;
      close();
      target()?.focus();
    } catch (error) {
      showError(error.message);
    }
  }

  async function remove(id) {
    const tool = tools.find((t) => t.id === id);
    if (!tool || !confirm(`Retirer le bouton « ${tool.label} » de la barre, pour tout le monde ?`)) return;
    try {
      tools = (await api.deleteMathTool(id)).data.tools;
      renderButtons();
    } catch (error) {
      alert(error.message);
    }
  }

  // mousedown + preventDefault keeps the editor's selection while clicking a button.
  root.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-mt-run], [data-mt-remove], [data-mt-open]")) event.preventDefault();
  });
  root.addEventListener("click", (event) => {
    const run = event.target.closest("[data-mt-run]");
    if (run) {
      const tool = tools.find((t) => t.id === run.dataset.mtRun);
      if (tool) insertSnippet(target(), tool.typst, tool.select);
      return;
    }
    const removeButton = event.target.closest("[data-mt-remove]");
    if (removeButton) return remove(removeButton.dataset.mtRemove);
    if (event.target.closest("[data-mt-open]")) return panel.hidden ? open() : close();
    if (event.target.closest("[data-mt-add]")) add();
  });
  fields.typst.addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, PREVIEW_DELAY);
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("input")) add();
    if (event.key === "Escape") {
      close();
      target()?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) close();
  });
  load();
  return root;
}
