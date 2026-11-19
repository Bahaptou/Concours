// Corpus entry editor: entree.html creates an entry (optionally ?type=… to prefill),
// entree.html?id=bayes edits one. An entry belongs to everyone: on top its metadata (identifier,
// type, title) and who created and changed it (git); below, its one shared text in CodeMirror
// with a live preview in its box, the assumptions and limits of a formula, and the Python code of
// a simulation. All of it is one Markdown file, notes/corpus/<id>.md, that Obsidian edits too.
// Readings can be attached
// by hand here (several, applied at once, also while creating); the entry also belongs to those of
// the notes citing or inserting it and of the questions linked to it, shown beside them.
// Saved on demand (button or Ctrl+S), not while typing: a saved text replaces everyone's at once
// and shows in the notes that insert it, so it should be a deliberate act.
// Loaded as an ES module after the classic scripts, which provide window.FRM.
import { EditorState, EditorView } from "../../vendor/codemirror/codemirror.js";
import { isInMath } from "../editor/markdown-language.js";
import { baseExtensions } from "../editor/setup.js";
import { renderToolbar, formattingKeys, insert, ENTRY_TOOLS } from "../editor/toolbar.js";
import { corpusPicker } from "../editor/corpus-picker.js";
import { imageMenu, attachImageInput } from "../editor/images.js";
import { customMathTools } from "../editor/math-tools.js";
import * as api from "../editor/api.js";

const { FRM } = window;
const { ui } = FRM;
const { esc } = ui;

const PREVIEW_DELAY = 150;
const params = new URLSearchParams(location.search);
const NEW_TEXT = "";
// Starting code of a new entry, by type. A brick's demo runs with ▶ Exécuter on the brick
// itself, never when a simulation imports it.
const CODE_TEMPLATES = {
  simulation: "# Simulation : importe des briques (menu « 🧱 Briques »), puis ▶ Exécuter.\n",
  brique: [
    "# Brique de code : des fonctions que les simulations importent.",
    "",
    "def ma_fonction(x):",
    '    """Ce que fait la fonction."""',
    "    return x",
    "",
    "",
    'if __name__ == "__main__":',
    "    # Démonstration : lancée par ▶ Exécuter sur cette brique, pas quand une simulation l'importe.",
    "    print(ma_fonction(1))",
    "",
  ].join("\n"),
};
const CODE_TYPES = Object.keys(CODE_TEMPLATES);
const codeTemplate = (type) => CODE_TEMPLATES[type] || CODE_TEMPLATES.simulation;
// Texts a formula carries under its formula: small blocks in its box, on the corpus page and in
// the notes inserting it. Markdown like the rest (formulas allowed), written in their own fields
// and stored as the sections ## Hypothèses and ## Limites at the end of the file.
// Keep the types in step with SECTION_TYPES in backend/corpus.py.
const SECTIONS = [
  { id: "hypotheses", label: "Hypothèses", hint: "Conditions pour que la formule soit valable. Une puce par hypothèse (bouton Liste)." },
  { id: "limites", label: "Limites", hint: "Quand la formule trompe ou ne s'applique plus. Une puce par limite." },
];
const SECTION_TYPES = ["formule"];
// A financial product declares the variables it needs (a name, an optional note): no values here,
// the code fills them (produit("id") gives an object whose attributes are these names, all None).
// Keep in step with VARIABLE_TYPES in backend/corpus.py.
const VARIABLE_TYPES = ["produit"];
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const moduleName = (entryId) => entryId.replace(/-/g, "_");

function variableRow(v = { nom: "", note: "" }) {
  const input = (field, current, placeholder, extra = "") =>
    `<input data-var="${field}" value="${esc(current ?? "")}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"${extra}>`;
  return `<tr data-variable-row>
  <td>${input("nom", v.nom, "nom, ex. fixed_rate", ' spellcheck="false" autocomplete="off"')}</td>
  <td>${input("note", v.note, "note (facultative), ex. taux fixe annuel")}</td>
  <td><button type="button" class="pick-remove" data-remove-variable title="Retirer cette variable" aria-label="Retirer cette variable">×</button></td>
</tr>`;
}

/** The lines to start from in the code: the product and its variables to fill. */
function variablesSnippet(entryId, names) {
  const lines = ["from produits import produit", `p = produit("${entryId || "identifiant"}")`, ...names.map((name) => `p.${name} = ...`)];
  return lines.join("\n");
}

/** Line importing a brick into Python code: its public functions. */
function brickImportLine(brick) {
  const names = brick.code ? [...brick.code.matchAll(/^def ([A-Za-z]\w*)\(/gm)].map((m) => m[1]) : [];
  const module = `briques.${moduleName(brick.id)}`;
  return names.length ? `from ${module} import ${names.join(", ")}` : `import ${module}`;
}

/** Adds the import line after the last import at the top of the code (or first), unless present. */
function addBrickImport(view, brick) {
  const { doc } = view.state;
  const module = `briques.${moduleName(brick.id)}`;
  if (new RegExp(`^\\s*(from|import)\\s+${module.replace(".", "\\.")}\\b`, "m").test(doc.toString())) return view.focus();
  let after = null;
  for (let number = 1; number <= doc.lines; number += 1) {
    if (/^(import|from)\s/.test(doc.line(number).text)) after = doc.line(number);
  }
  const line = brickImportLine(brick);
  view.dispatch({ changes: after ? { from: after.to, insert: `\n${line}` } : { from: 0, insert: `${line}\n` } });
  view.focus();
}

/** Readable identifier from a title: "Règle de Bayes" -> "regle-de-bayes". */
const slugify = (text) => ui.fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 50).replace(/-+$/, "");

/** "notes/fiches/r12" -> "Fiche QA-1"; "corpus/bayes" -> "Entrée « bayes »". */
function targetLabel(target) {
  const note = /^notes\/fiches\/r(\d+)$/.exec(target);
  if (note) {
    const reading = FRM.findReading(note[1]);
    return `Fiche ${reading ? reading.tag : `R${note[1]}`}`;
  }
  return `Entrée « ${target.split("/")[1]} »`;
}

// ---------------------------------------------------------------- page skeleton

function mountPage(title, body) {
  ui.mount({
    active: "corpus",
    title,
    trail: [
      { label: "Accueil", href: "index.html" },
      { label: "Corpus", href: "corpus.html" },
      { label: title },
    ],
    body,
  });
}

const notice = (title, text) => `<div class="card"><h2>${title}</h2><p>${text}</p></div>`;

function typeOptions(selected) {
  return FRM.ENTRY_TYPES.map((t) => `<option value="${t.id}"${t.id === selected ? " selected" : ""}>${esc(t.label)}</option>`).join("");
}

function layout({ creating, meta }) {
  return `
<div class="editor-head">
  <div><div class="kicker">Corpus · <span data-kicker>${creating ? "Nouvelle entrée" : esc(FRM.entryType(meta.type).label)}</span> · entrée commune</div><h2 data-heading>${esc(meta.titre || "Nouvelle entrée")}</h2></div>
  <div class="editor-actions">
    <span class="save-status" data-save-status></span>
    <button type="button" class="btn ghost danger" data-delete${creating ? " hidden" : ""} title="Supprime l'entrée (son fichier) et retire ses références des fiches et des autres entrées">Supprimer l'entrée</button>
    <a class="btn ghost" data-entry-link href="corpus.html"${creating ? " hidden" : ""}>Voir dans le corpus</a>
    <button type="button" class="btn" data-save title="Ctrl+S">${creating ? "Créer l'entrée" : "Enregistrer"}</button>
  </div>
</div>
<div class="card">
  <form class="meta-form" data-meta novalidate>
    <label class="field" data-field="titre">Titre<input name="titre" maxlength="120" placeholder="ex. Règle de Bayes" value="${esc(meta.titre)}"></label>
    <label class="field" data-field="type">Type<select name="type">${typeOptions(meta.type)}</select></label>
    <label class="field" data-field="id">Identifiant <span class="hint">pour citer : [[…]] · fixé à la création</span><input name="id" maxlength="50" value="${esc(meta.id)}"${creating ? "" : " readonly"}></label>
  </form>
  <div class="variables-pane" data-variables-pane hidden>
    <h3>Variables</h3>
    <p class="small muted">Les variables dont le produit a besoin, sans valeur : on les remplit dans le code. Un même produit peut en déclarer plusieurs sortes (<code>fixed_rate</code>, <code>variable_rate</code>…), la fonction choisit celle qu'elle utilise.</p>
    <table class="variables-table">
      <thead><tr><th>Nom (pour le code)</th><th>Note</th><th></th></tr></thead>
      <tbody data-variables></tbody>
    </table>
    <button type="button" class="btn ghost" data-add-variable>＋ Ajouter une variable</button>
    <div class="variables-code"><span class="small muted">Dans le code :</span><div data-variables-code></div></div>
  </div>
  <div class="readings-line" data-readings></div>
  <p class="small muted"><span data-journal></span> Le texte est commun : ce que tu enregistres remplace celui de tout le monde (git garde les anciens textes).</p>
  <div class="form-error" data-form-error hidden></div>
</div>
<div class="toolbar" data-text-tools></div>
<div class="toolbar math" data-math-tools hidden></div>
<div class="editor-grid">
  <div>
    <div class="cm-host" data-editor></div>
${SECTIONS.map(
  (section) => `    <div class="section-pane" data-section-pane="${section.id}" hidden>
      <h3>${section.label}</h3>
      <p class="small muted">${section.hint}</p>
      <div class="cm-host section" data-section="${section.id}"></div>
    </div>`
).join("\n")}
    <div class="code-pane" data-code-pane hidden>
      <h3 data-code-title>Code Python</h3>
      <div class="toolbar" data-code-tools></div>
      <div class="cm-host code" data-code></div>
      <div data-run></div>
    </div>
  </div>
  <div class="preview-pane">
    <div class="preview-md" data-preview></div>
  </div>
</div>
<p class="src">Fichier : <code data-file>notes/corpus/${esc(meta.id || "…")}.md</code> (aussi ouvrable dans Obsidian) · Ctrl+S pour enregistrer.</p>`;
}

// ---------------------------------------------------------------- editor

async function start() {
  const title = params.has("id") ? "Entrée du corpus" : "Nouvelle entrée";
  if (location.protocol === "file:") {
    return mountPage(title, notice("L'éditeur a besoin du serveur", "Lance <code>Lancer Prep FRM.bat</code> (double-clic), puis rouvre cette page depuis le navigateur qui s'ouvre."));
  }

  // ---------------------------------------------------------- loading

  let corpus;
  let entry = null; // the entry resource ({data, links}) once it exists on the server
  let text = null; // the entry's shared text ({data, links})
  try {
    corpus = await api.listCorpus();
    FRM.mergeCorpusEntries(corpus.data.entries); // the preview shows the titles of cited entries
    if (params.has("id")) {
      entry = await api.getEntry(params.get("id"));
      text = await api.getText(entry.data.id);
    }
  } catch (error) {
    if (error instanceof api.ApiProblem && error.title === "ENTRY_NOT_FOUND") return ui.mountNotFound(`L'entrée « ${params.get("id")} » du corpus`);
    return mountPage(title, notice("Chargement impossible", esc(error.message)));
  }

  const prefillType = FRM.entryType(params.get("type")) ? params.get("type") : "formule";
  const initialMeta = entry
    ? { id: entry.data.id, type: entry.data.type, titre: entry.data.titre }
    : { id: "", type: prefillType, titre: "" };
  mountPage(entry ? entry.data.titre : title, layout({ creating: !entry, meta: initialMeta }));
  document.body.classList.add("wide");

  const $ = (selector) => document.querySelector(selector);
  const form = $("[data-meta]");

  // What the server has: to know what to send on save, and to warn before leaving.
  let savedMeta = entry ? JSON.stringify(metaOf()) : null;
  let savedSource = text ? text.data.source : null;
  let savedCode = text ? text.data.code : null;
  const savedSections = Object.fromEntries(SECTIONS.map((section) => [section.id, (text && text.data[section.id]) || ""]));
  let savedVariables = (text && text.data.variables) || [];

  // ---------------------------------------------------------- metadata form

  function metaOf() {
    return { type: form.type.value, titre: form.titre.value.trim() };
  }

  const hasCode = () => CODE_TYPES.includes(form.type.value);
  const hasSections = () => SECTION_TYPES.includes(form.type.value);
  const hasVariables = () => VARIABLE_TYPES.includes(form.type.value);

  // ---------------------------------------------------------- variables of a financial product

  const variablesBody = $("[data-variables]");
  variablesBody.innerHTML = savedVariables.map(variableRow).join("");

  /** The table as the server takes it: [{ nom, note }], blank rows skipped. */
  function readVariables() {
    return [...variablesBody.querySelectorAll("[data-variable-row]")]
      .map((row) => Object.fromEntries([...row.querySelectorAll("[data-var]")].map((input) => [input.dataset.var, input.value.trim()])))
      .filter((v) => v.nom || v.note)
      .map((v) => ({ nom: v.nom, note: v.note }));
  }

  /** The example to copy into the code, following the table and the identifier. */
  function showVariablesCode() {
    const names = readVariables().map((v) => v.nom).filter((name) => VARIABLE_NAME.test(name));
    $("[data-variables-code]").innerHTML = ui.codeBlock(variablesSnippet(form.id.value, names));
  }

  function markVariableNames() {
    variablesBody.querySelectorAll('[data-var="nom"]').forEach((input) => {
      input.classList.toggle("is-invalid", Boolean(input.value.trim()) && !VARIABLE_NAME.test(input.value.trim()));
      input.title = input.classList.contains("is-invalid") ? "Lettres sans accent, chiffres et _, sans commencer par un chiffre (le code l'utilise tel quel)" : "";
    });
  }

  $("[data-add-variable]").addEventListener("click", () => {
    variablesBody.insertAdjacentHTML("beforeend", variableRow());
    variablesBody.querySelector("[data-variable-row]:last-child [data-var='nom']").focus();
  });
  variablesBody.addEventListener("click", (event) => {
    if (!event.target.closest("[data-remove-variable]")) return;
    event.target.closest("[data-variable-row]").remove();
    showVariablesCode();
    markDirty();
    schedulePreview();
  });
  variablesBody.addEventListener("input", () => {
    markVariableNames();
    showVariablesCode();
    markDirty();
    schedulePreview();
  });

  // ---------------------------------------------------------- readings
  // Attached by hand (several at once, applied as soon as chosen once the entry exists; kept
  // until the first save while creating), beside the readings the entry gets from the notes using
  // it and from its linked questions, which are not chosen here.

  const pendingReadings = new Set(!entry && FRM.findReading(params.get("reading")) ? [Number(params.get("reading"))] : []);
  const directReadings = () => (entry ? entry.data.directReadings : [...pendingReadings].sort((a, b) => a - b));

  function renderReadings() {
    const direct = directReadings();
    const fromNotes = entry ? entry.data.noteReadings || [] : [];
    const fromQuestions = entry ? entry.data.questionReadings || [] : [];
    const tag = (id) => FRM.findReading(id)?.tag || `R${id}`;
    const chip = (id) => {
      const origin = [direct.includes(id) && "direct", fromNotes.includes(id) && "fiche", fromQuestions.includes(id) && "questions"].filter(Boolean).join(" · ");
      const detach = direct.includes(id)
        ? `<button type="button" class="tag-remove" data-detach-reading="${id}" title="Détacher de ${esc(tag(id))} (ce que lui donnent les fiches et les questions reste)" aria-label="Détacher de ${esc(tag(id))}">×</button>`
        : "";
      return `<span class="tag" title="${esc(FRM.findReading(id)?.title || "")}">${esc(tag(id))} <span class="tag-src">${esc(origin)}</span>${detach}</span>`;
    };
    const ids = [...new Set([...direct, ...fromNotes, ...fromQuestions])].sort((a, b) => a - b);
    $("[data-readings]").innerHTML = `<span class="small muted">Readings :</span>${ids.map(chip).join("")}${ids.length ? "" : `<span class="small muted">aucun pour l'instant.</span>`}<button type="button" class="btn ghost" data-attach-readings title="Rattacher l'entrée à un ou plusieurs readings, sans passer par une fiche ni une question">＋ Rattacher à des readings</button>`;
  }

  /** Attaches and detaches readings: on the server once the entry exists, else kept for the first save. */
  async function changeReadings(add, remove) {
    if (!entry) {
      add.forEach((id) => pendingReadings.add(id));
      remove.forEach((id) => pendingReadings.delete(id));
    } else {
      await api.changeReadings([entry.data.id], add, remove);
      entry = await api.getEntry(entry.data.id);
    }
    renderReadings();
  }

  $("[data-readings]").addEventListener("click", (event) => {
    const detach = event.target.closest("[data-detach-reading]");
    if (detach) {
      changeReadings([], [Number(detach.dataset.detachReading)]).catch((error) => ui.flash(error.message, "error"));
      return;
    }
    if (!event.target.closest("[data-attach-readings]")) return;
    FRM.readingAttach.pick({
      title: "Rattacher l'entrée à des readings",
      entries: [{ directReadings: directReadings() }],
      onApply: changeReadings,
    });
  });

  function refreshMetaDisplay() {
    const meta = metaOf();
    $("[data-heading]").textContent = meta.titre || "Nouvelle entrée";
    if (entry) $("[data-kicker]").textContent = FRM.entryType(meta.type).label;
    renderReadings();
    $("[data-code-pane]").hidden = !hasCode();
    for (const section of SECTIONS) $(`[data-section-pane="${section.id}"]`).hidden = !hasSections();
    $("[data-variables-pane]").hidden = !hasVariables();
    showVariablesCode();
    $("[data-editor]").classList.toggle("compact", hasSections());
    $("[data-code-title]").textContent = form.type.value === "brique"
      ? `Code de la brique · une simulation l'importe avec : from briques.${moduleName(form.id.value || "identifiant")} import …`
      : "Code Python de la simulation";
    $("[data-file]").textContent = `notes/corpus/${form.id.value || "…"}.md`;
  }

  // While creating, the identifier follows the title until it is edited by hand.
  let idTouched = Boolean(entry);
  form.id.addEventListener("input", () => (idTouched = true));
  form.addEventListener("input", (event) => {
    if (event.target.name === "titre" && !idTouched) form.id.value = slugify(form.titre.value);
    clearFieldErrors();
    refreshMetaDisplay();
    markDirty();
    if (event.target.name === "titre") schedulePreview();
  });
  form.addEventListener("change", (event) => {
    if (event.target.name !== "type") return;
    schedulePreview();
    // A starting code still untouched follows the type (simulation <-> brick).
    const current = codeView.state.doc.toString();
    if (savedCode === null && Object.values(CODE_TEMPLATES).includes(current) && hasCode()) {
      codeView.dispatch({ changes: { from: 0, to: current.length, insert: codeTemplate(form.type.value) } });
    }
  });

  /** Who created and changed the entry, from git. */
  function showJournal() {
    const line = entry ? ui.historyLine(entry.data) : "";
    $("[data-journal]").textContent = "";
    $("[data-journal]").insertAdjacentHTML("beforeend", line ? `${line}.` : "");
  }

  // ---------------------------------------------------------- errors and reports

  function clearFieldErrors() {
    form.querySelectorAll(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
    $("[data-form-error]").hidden = true;
  }

  function formError(html, field = null) {
    if (field) {
      const target = form.querySelector(`[data-field="${field}"]`);
      if (target) target.classList.add("is-invalid");
    }
    const box = $("[data-form-error]");
    box.innerHTML = html;
    box.hidden = false;
  }

  /** Turns a failed save into a message next to what caused it. */
  function explainFailure(error) {
    if (!(error instanceof api.ApiProblem)) return formError(esc(error.message));
    const { problem } = error;
    const reason = problem.field ? String(problem.detail).replace(`${problem.field} : `, "") : problem.detail;
    switch (error.title) {
      case "ENTRY_CONFLICT":
        return formError(`L'identifiant « ${esc(problem.entryId)} » est déjà pris (${esc(FRM.entryType(problem.existingType).label.toLowerCase())}) : <a href="corpus.html?id=${encodeURIComponent(problem.entryId)}">voir cette entrée</a>, ou choisis-en un autre.`, "id");
      case "INVALID_REQUEST_PAYLOAD":
        return formError(`${esc(reason)}`, problem.field);
      default:
        return formError(esc(problem.detail || error.message));
    }
  }

  /** Texts of the sections, as the server takes them: only formulas have them. */
  const sectionTexts = () => (hasSections() ? Object.fromEntries(SECTIONS.map((section) => [section.id, sectionViews[section.id].state.doc.toString()])) : {});

  // ---------------------------------------------------------- preview

  let previewTimer = null;

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, PREVIEW_DELAY);
  }

  /** The entry in its box, rendered in the browser as everywhere else: nothing goes to the server. */
  function refreshPreview() {
    const meta = metaOf();
    const sections = sectionTexts();
    $("[data-preview]").innerHTML = FRM.renderEntryBox({
      id: form.id.value || "nouvelle-entree",
      type: meta.type,
      titre: meta.titre || "Sans titre",
      source: view.state.doc.toString(),
      hypotheses: sections.hypotheses || "",
      limites: sections.limites || "",
      variables: hasVariables() ? readVariables().filter((v) => VARIABLE_NAME.test(v.nom)) : [],
    });
  }

  // ---------------------------------------------------------- save

  let saving = false;
  const status = (text, kind = "") => {
    const el = $("[data-save-status]");
    el.textContent = text;
    el.dataset.kind = kind;
  };

  // Without a text yet, the starting text counts as "nothing written": no empty text is created.
  const sourceChanged = () => view.state.doc.toString() !== (savedSource ?? NEW_TEXT);
  const codeChanged = () => hasCode() && codeView.state.doc.toString() !== (savedCode ?? codeTemplate(form.type.value));
  const sectionsChanged = () => hasSections() && SECTIONS.some((section) => sectionViews[section.id].state.doc.toString() !== savedSections[section.id]);
  const variablesChanged = () => hasVariables() && JSON.stringify(readVariables()) !== JSON.stringify(savedVariables);
  const metaChanged = () => JSON.stringify(metaOf()) !== savedMeta;
  const isDirty = () => (entry ? metaChanged() : Boolean(form.titre.value.trim())) || sourceChanged() || codeChanged() || sectionsChanged() || variablesChanged();

  function markDirty() {
    if (!saving) status(isDirty() ? "Modifications non enregistrées" : "✓ À jour", isDirty() ? "warn" : "ok");
  }

  /** Takes the server's answer as the new reference: entry, links, saved metadata. */
  function adopt(resource) {
    const created = !entry;
    entry = resource;
    savedMeta = JSON.stringify({ type: entry.data.type, titre: entry.data.titre });
    if (created) {
      history.replaceState(null, "", `entree.html?id=${encodeURIComponent(entry.data.id)}`);
      document.querySelector(".crumb .here").textContent = entry.data.titre;
      form.id.readOnly = true;
      $("[data-save]").textContent = "Enregistrer";
    }
    $("[data-delete]").hidden = false;
    const link = $("[data-entry-link]");
    link.href = ui.entryHref(entry.data);
    link.hidden = false;
    showJournal();
    refreshMetaDisplay();
  }

  const savedAt = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  async function saveNow() {
    if (saving) return;
    saving = true;
    clearFieldErrors();
    status("Enregistrement…");
    try {
      if (!entry) {
        const created = await api.createEntry(corpus.links.create, { id: form.id.value.trim(), ...metaOf() });
        adopt(created);
        if (pendingReadings.size) {
          // Chosen before the entry existed: attached now that it does.
          const chosen = [...pendingReadings];
          pendingReadings.clear();
          await changeReadings(chosen, []);
        }
      } else if (metaChanged()) {
        adopt(await api.updateEntry(entry.links.update, metaOf()));
      }
      if (sourceChanged() || codeChanged() || sectionsChanged() || variablesChanged()) {
        const source = view.state.doc.toString();
        const code = hasCode() ? codeView.state.doc.toString() : undefined;
        const sections = sectionTexts();
        const variables = hasVariables() ? readVariables() : undefined;
        const saved = await api.saveText({ method: "PUT", href: api.textUrl(entry.data.id) }, { source, code, ...sections, ...(variables !== undefined ? { variables } : {}) });
        savedSource = source;
        if (code !== undefined) savedCode = code;
        Object.assign(savedSections, sections);
        if (variables !== undefined) savedVariables = variables;
        adopt(saved);
      }
      saving = false;
      status(`✓ Enregistré à ${savedAt()}`, "ok");
    } catch (error) {
      saving = false;
      explainFailure(error);
      status("⚠ Non enregistré", "error");
    }
  }

  // ---------------------------------------------------------- CodeMirror

  const saveKey = { key: "Mod-s", preventDefault: true, run: () => (saveNow(), true) };
  let toggleMath = () => {};
  // The Markdown fields (text, assumptions, limits) share one toolbar: it acts on the one last focused.
  let active = null;

  function onFieldUpdate(update) {
    if (update.docChanged) {
      markDirty();
      schedulePreview();
    }
    if (update.view === active && (update.docChanged || update.selectionSet)) {
      toggleMath(isInMath(update.state.doc.toString(), update.state.selection.main.head));
    }
  }

  const markdownField = (parent, doc) =>
    new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: baseExtensions({ keys: [saveKey, ...formattingKeys], onUpdate: onFieldUpdate }) }),
    });

  const view = markdownField($("[data-editor]"), savedSource ?? NEW_TEXT);
  active = view;
  const sectionViews = Object.fromEntries(SECTIONS.map((section) => [section.id, markdownField($(`[data-section="${section.id}"]`), savedSections[section.id])]));
  for (const field of [view, ...Object.values(sectionViews)]) {
    field.dom.addEventListener("focusin", () => {
      active = field;
      toggleMath(isInMath(field.state.doc.toString(), field.state.selection.main.head));
    });
  }

  const codeView = new EditorView({
    parent: $("[data-code]"),
    state: EditorState.create({
      doc: savedCode ?? codeTemplate(initialMeta.type),
      extensions: baseExtensions({ markdown: false, keys: [saveKey], onUpdate: (update) => update.docChanged && markDirty() }),
    }),
  });

  // An entry cites others by their title ([[id]]), as Obsidian does.
  const picker = corpusPicker(() => active, {
    load: async () => {
      const entries = (await api.listCorpus()).data.entries;
      FRM.mergeCorpusEntries(entries);
      return entries;
    },
    actions: [{ label: "Citer", title: "Le titre de l'entrée, en couleur : [[id]]", run: (v, other) => insert(v, `[[${other.id}]]`) }],
    exclude: () => (entry ? entry.data.id : null),
  });
  const images = imageMenu(() => active);
  for (const field of [view, ...Object.values(sectionViews)]) attachImageInput(field, images.open);
  toggleMath = renderToolbar({ textRow: $("[data-text-tools]"), mathRow: $("[data-math-tools]") }, () => active, { tools: ENTRY_TOOLS, extras: [picker, images.element], mathExtras: [customMathTools(() => active)] });

  // Python pane: import a brick, run the code being written.
  const brickPicker = corpusPicker(codeView, {
    load: async () => (await api.listCorpus()).data.entries.filter((e) => e.type === "brique"),
    actions: [{ label: "Importer", title: "Ajoute la ligne from briques.… import … en tête du code", run: (v, brick) => addBrickImport(v, brick) }],
    exclude: () => (entry ? entry.data.id : null),
    label: "🧱 Briques",
    title: "Importer une brique de code du corpus",
  });
  $("[data-code-tools]").replaceChildren(brickPicker);
  $("[data-run]").replaceChildren(
    FRM.runner.panel({ code: () => codeView.state.doc.toString(), readings: () => (entry ? entry.data.readings : []) })
  );

  // ---------------------------------------------------------- delete

  let deleted = false;

  /** Confirmation text: what goes, and where references are removed (the server does it). */
  function deletionSummary() {
    const { titre, usedBy, citedBy } = entry.data;
    const lines = [`Supprimer « ${titre} » pour tout le monde (son fichier notes/corpus/${entry.data.id}.md) ? C'est définitif (sauf retour par git).`];
    const places = [
      ...usedBy.map((use) => targetLabel(`notes/fiches/r${use.reading}`)),
      ...citedBy.map((id) => `Entrée « ${corpus.data.entries.find((e) => e.id === id)?.titre || id} »`),
    ];
    if (places.length) {
      lines.push("", "Ses références seront retirées ([[…]] devient le titre en texte simple, ![[…]] disparaît) :", ...places.map((place) => `• ${place}`));
    }
    return lines.join("\n");
  }

  async function deleteNow() {
    const users = entry.data.importedBy;
    if (users.length) return formError(`Cette brique est importée par : ${users.map(esc).join(", ")}. Retire l'import de leur code d'abord.`);
    if (!confirm(deletionSummary())) return;
    status("Suppression…");
    try {
      await api.deleteEntry(entry.data.id);
      deleted = true;
      location.href = "corpus.html";
    } catch (error) {
      status("⚠ Non supprimée", "error");
      if (error instanceof api.ApiProblem && error.title === "BRICK_IN_USE") {
        formError(`Cette brique est importée par : ${error.problem.importedBy.map(esc).join(", ")}. Retire l'import de leur code d'abord.`);
      } else {
        formError(esc(error.message));
      }
    }
  }

  $("[data-delete]").addEventListener("click", deleteNow);
  $("[data-save]").addEventListener("click", saveNow);
  window.addEventListener("beforeunload", (event) => {
    if (deleted || !isDirty()) return;
    event.preventDefault();
    event.returnValue = ""; // the browser asks before leaving: nothing is saved behind your back here
  });

  refreshMetaDisplay();
  showJournal();
  status(entry ? (!savedSource ? "Pas encore de texte : écris-le puis enregistre" : "✓ À jour") : "Nouvelle entrée : titre, type, puis son texte", entry && savedSource ? "ok" : "");
  refreshPreview();
  (entry ? view : form.titre).focus();
}

start();
