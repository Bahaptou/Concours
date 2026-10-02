// Corpus entry editor: entree.html creates an entry (optionally ?type=… to prefill),
// entree.html?id=bayes edits one. On top, the metadata shared by every version (identifier,
// type, title); below, the current profile's version in CodeMirror with a live preview in its
// box, and the Python code of a simulation. Readings are not chosen here: they come from the
// notes citing or inserting the entry.
// Saved on demand (button or Ctrl+S), not while typing: a saved version is shared at once and
// recompiles the notes that insert it, so it should be a deliberate act.
// Loaded as an ES module after the classic scripts, which provide window.FRM.
import { EditorState, EditorView } from "../../vendor/codemirror/codemirror.js";
import { isInMath } from "../editor/typst-language.js";
import { baseExtensions, showProblem } from "../editor/setup.js";
import { renderToolbar, formattingKeys, insert, ENTRY_TOOLS } from "../editor/toolbar.js";
import { corpusPicker, ensureImport } from "../editor/corpus-picker.js";
import * as api from "../editor/api.js";

const { FRM } = window;
const { ui, store } = FRM;
const { esc } = ui;

const PREVIEW_DELAY = 400;
const params = new URLSearchParams(location.search);
const NEW_VERSION = "// Ta version de cette entrée. Pour citer une autre entrée : menu « 📚 Corpus », puis Citer.\n";
// Starting code of a new version, by type. A brick's demo runs with ▶ Exécuter on the brick
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
const moduleName = (entryId) => entryId.replace(/-/g, "_");

/** Line importing a brick into Python code: its public functions, from the given author's
 *  version if there is one (the one the run will use). */
function brickImportLine(brick, author) {
  const version = brick.versions.find((v) => v.author === author && v.code) || brick.versions.find((v) => v.code);
  const names = version ? [...version.code.matchAll(/^def ([A-Za-z]\w*)\(/gm)].map((m) => m[1]) : [];
  const module = `briques.${moduleName(brick.id)}`;
  return names.length ? `from ${module} import ${names.join(", ")}` : `import ${module}`;
}

/** Adds the import line after the last import at the top of the code (or first), unless present. */
function addBrickImport(view, brick, author) {
  const { doc } = view.state;
  const module = `briques.${moduleName(brick.id)}`;
  if (new RegExp(`^\\s*(from|import)\\s+${module.replace(".", "\\.")}\\b`, "m").test(doc.toString())) return view.focus();
  let after = null;
  for (let number = 1; number <= doc.lines; number += 1) {
    if (/^(import|from)\s/.test(doc.line(number).text)) after = doc.line(number);
  }
  const line = brickImportLine(brick, author);
  view.dispatch({ changes: after ? { from: after.to, insert: `\n${line}` } : { from: 0, insert: `${line}\n` } });
  view.focus();
}

/** Readable identifier from a title: "Règle de Bayes" -> "regle-de-bayes". */
const slugify = (text) => ui.fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 50).replace(/-+$/, "");

/** "notes/r12/fiche-baptiste" -> "Fiche QA-1 de Baptiste"; "corpus/bayes/marie" -> "« Bayes », version de marie". */
function targetLabel(target) {
  const note = /^notes\/r(\d+)\/fiche-(.+)$/.exec(target);
  if (note) {
    const reading = FRM.findReading(note[1]);
    return `Fiche ${reading ? reading.tag : `R${note[1]}`} de ${note[2].charAt(0).toUpperCase()}${note[2].slice(1)}`;
  }
  const [, entryId, author] = target.split("/");
  return `Entrée « ${entryId} », version de ${author}`;
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

/** Readings of an entry, read-only: those of the notes using it. */
function readingsLine(entry) {
  const uses = entry ? entry.data.usedBy : [];
  if (!uses.length) return "Readings : aucun pour l'instant. Cite ou insère l'entrée dans une fiche (menu « 📚 Corpus ») pour la rattacher au reading de cette fiche.";
  const items = uses.map((use) => {
    const reading = FRM.findReading(use.reading);
    return `${reading ? reading.tag : `R${use.reading}`} (fiche de ${use.author.charAt(0).toUpperCase()}${use.author.slice(1)})`;
  });
  return `Readings, d'après les fiches qui l'utilisent : ${items.join(", ")}`;
}

function layout({ creating, meta, author }) {
  return `
<div class="editor-head">
  <div><div class="kicker">Corpus · <span data-kicker>${creating ? "Nouvelle entrée" : esc(FRM.entryType(meta.type).label)}</span> · version de ${esc(store.profile.displayName())}</div><h2 data-heading>${esc(meta.titre || "Nouvelle entrée")}</h2></div>
  <div class="editor-actions">
    <span class="save-status" data-save-status></span>
    <a class="btn ghost" data-entry-link href="corpus.html"${creating ? " hidden" : ""}>Voir dans le corpus</a>
    <button type="button" class="btn" data-save title="Ctrl+S">${creating ? "Créer l'entrée" : "Enregistrer"}</button>
  </div>
</div>
<div class="card">
  <form class="meta-form" data-meta novalidate>
    <label class="field" data-field="titre">Titre<input name="titre" maxlength="120" placeholder="ex. Règle de Bayes" value="${esc(meta.titre)}"></label>
    <label class="field" data-field="type">Type<select name="type">${typeOptions(meta.type)}</select></label>
    <label class="field" data-field="id">Identifiant <span class="hint">pour citer : #voir("…") · fixé à la création</span><input name="id" maxlength="50" value="${esc(meta.id)}"${creating ? "" : " readonly"}></label>
  </form>
  <p class="small" data-readings></p>
  <p class="small muted">Titre et type sont communs à toutes les versions de l'entrée. Le texte ci-dessous est ta version, signée ${esc(store.profile.initials())}.</p>
  <div class="small muted" data-others></div>
  <div class="form-error" data-form-error hidden></div>
  <div class="rebuild-report" data-report hidden></div>
</div>
<div class="toolbar" data-text-tools></div>
<div class="toolbar math" data-math-tools hidden></div>
<div class="editor-grid">
  <div>
    <div class="cm-host" data-editor></div>
    <div class="code-pane" data-code-pane hidden>
      <h3 data-code-title>Code Python</h3>
      <div class="toolbar" data-code-tools></div>
      <div class="cm-host code" data-code></div>
      <div data-run></div>
    </div>
  </div>
  <div class="preview-pane">
    <div class="editor-error" data-error hidden></div>
    <div class="preview-pages" data-preview></div>
  </div>
</div>
<p class="src">Fichier : <code data-file>notes/corpus/${esc(meta.id || "…")}/${author}.typ</code> · Ctrl+S pour enregistrer.</p>`;
}

// ---------------------------------------------------------------- editor

async function start() {
  const title = params.has("id") ? "Entrée du corpus" : "Nouvelle entrée";
  if (location.protocol === "file:") {
    return mountPage(title, notice("L'éditeur a besoin du serveur", "Lance <code>Lancer Prep FRM.bat</code> (double-clic), puis rouvre cette page depuis le navigateur qui s'ouvre."));
  }
  const author = store.profile.authorSlug();
  if (!author) {
    mountPage(title, notice("Qui écrit cette version ?", `Chaque version est signée de tes initiales, tirées de ton profil. <button type="button" class="btn" data-profile>Indiquer mon prénom et mon nom</button>`));
    document.addEventListener("frm:change", () => store.profile.authorSlug() && location.reload(), { once: true });
    return;
  }

  // ---------------------------------------------------------- loading

  let corpus;
  let entry = null; // the entry resource ({data, links}) once it exists on the server
  let version = null;
  try {
    corpus = await api.listCorpus();
    if (params.has("id")) {
      entry = await api.getEntry(params.get("id"));
      version = await api.getVersion(entry.data.id, author);
    }
  } catch (error) {
    if (error instanceof api.ApiProblem && error.title === "ENTRY_NOT_FOUND") return ui.mountNotFound(`L'entrée « ${params.get("id")} » du corpus`);
    return mountPage(title, notice("Chargement impossible", esc(error.message)));
  }

  const prefillType = FRM.entryType(params.get("type")) ? params.get("type") : "formule";
  const initialMeta = entry
    ? { id: entry.data.id, type: entry.data.type, titre: entry.data.titre }
    : { id: "", type: prefillType, titre: "" };
  mountPage(entry ? entry.data.titre : title, layout({ creating: !entry, meta: initialMeta, author }));
  document.body.classList.add("wide");

  const $ = (selector) => document.querySelector(selector);
  const form = $("[data-meta]");

  // What the server has: to know what to send on save, and to warn before leaving.
  let savedMeta = entry ? JSON.stringify(metaOf()) : null;
  let savedSource = version && version.data.exists ? version.data.source : null;
  let savedCode = version ? version.data.code : null;

  // ---------------------------------------------------------- metadata form

  function metaOf() {
    return { type: form.type.value, titre: form.titre.value.trim() };
  }

  const hasCode = () => CODE_TYPES.includes(form.type.value);

  function refreshMetaDisplay() {
    const meta = metaOf();
    $("[data-heading]").textContent = meta.titre || "Nouvelle entrée";
    if (entry) $("[data-kicker]").textContent = FRM.entryType(meta.type).label;
    $("[data-readings]").textContent = readingsLine(entry);
    $("[data-code-pane]").hidden = !hasCode();
    $("[data-code-title]").textContent = form.type.value === "brique"
      ? `Code de la brique · une simulation l'importe avec : from briques.${moduleName(form.id.value || "identifiant")} import …`
      : "Code Python de la simulation";
    $("[data-file]").textContent = `notes/corpus/${form.id.value || "…"}/${author}.${hasCode() ? "typ + .py" : "typ"}`;
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

  function showOthers() {
    const others = entry ? entry.data.versions.filter((v) => v.author !== author) : [];
    $("[data-others]").innerHTML = others.length
      ? `Autres versions : ${others.map((v) => `<span class="initials" title="${esc(v.name)}">${esc(v.initials)}</span> ${esc(v.name)}`).join(" · ")} · <a href="${ui.entryHref(entry.data)}">les voir</a>`
      : "";
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

  function showReport(rebuild) {
    const box = $("[data-report]");
    if (!rebuild || (!rebuild.failed.length && !rebuild.skipped.length)) {
      box.hidden = true;
      return;
    }
    const failed = rebuild.failed.map((f) => `<li>${esc(targetLabel(f.target))} : <code>${esc(f.message)}</code></li>`).join("");
    const skipped = rebuild.skipped.map((t) => `<li>${esc(targetLabel(t))}</li>`).join("");
    box.innerHTML = `
${failed ? `<strong>Ne compilent plus après ce changement</strong> (leur dernier rendu reste affiché) :<ul>${failed}</ul>` : ""}
${skipped ? `<strong>Pas recompilées tout de suite</strong> (trop nombreuses) : elles le seront à leur prochain enregistrement.<ul>${skipped}</ul>` : ""}`;
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
      case "CORPUS_IMPORT_FORBIDDEN":
        return showProblem($("[data-error]"), view, { explanation: "Import interdit dans une entrée", detail: reason }, "Une entrée cite les autres avec #voir, jamais en les insérant : ça évite les boucles.");
      case "INVALID_REQUEST_PAYLOAD":
        if (problem.field === "name" || problem.field === "initials") return formError(`Profil incomplet pour signer ta version (${esc(reason)}). <button type="button" class="link-btn" data-profile>Modifier le profil</button>`);
        return formError(`${esc(reason)}`, problem.field);
      default:
        return formError(esc(problem.detail || error.message));
    }
  }

  // ---------------------------------------------------------- preview

  let previewSeq = 0;
  let previewTimer = null;

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, PREVIEW_DELAY);
  }

  async function refreshPreview() {
    const seq = ++previewSeq;
    const meta = metaOf();
    try {
      const result = await api.previewEntry(corpus.links.preview, {
        type: meta.type,
        titre: meta.titre || "Sans titre",
        initials: store.profile.initials(),
        source: view.state.doc.toString(),
      });
      if (seq !== previewSeq) return; // an older request answered late: ignore it
      $("[data-preview]").innerHTML = result.data.pages.join("");
      showProblem($("[data-error]"), view, null);
    } catch (error) {
      if (seq !== previewSeq) return;
      if (error instanceof api.ApiProblem && error.title === "TYPST_COMPILE_ERROR") showProblem($("[data-error]"), view, error.problem);
      else if (error instanceof api.ApiProblem) explainFailure(error);
      else showProblem($("[data-error]"), view, { detail: error.message, explanation: "Aperçu indisponible" });
    }
  }

  // ---------------------------------------------------------- save

  let saving = false;
  const status = (text, kind = "") => {
    const el = $("[data-save-status]");
    el.textContent = text;
    el.dataset.kind = kind;
  };

  // Without a version yet, the starting text counts as "nothing written": no empty version is created.
  const sourceChanged = () => view.state.doc.toString() !== (savedSource ?? NEW_VERSION);
  const codeChanged = () => hasCode() && codeView.state.doc.toString() !== (savedCode ?? codeTemplate(form.type.value));
  const metaChanged = () => JSON.stringify(metaOf()) !== savedMeta;
  const isDirty = () => (entry ? metaChanged() : Boolean(form.titre.value.trim())) || sourceChanged() || codeChanged();

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
    const link = $("[data-entry-link]");
    link.href = ui.entryHref(entry.data);
    link.hidden = false;
    showOthers();
    refreshMetaDisplay();
  }

  /** Recompiled notes and other entries; the entry's own versions re-rendered do not count. */
  const dependentsIn = (rebuild) => rebuild.rebuilt.filter((target) => !target.startsWith(`corpus/${entry.data.id}/`)).length;

  const savedAt = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  async function saveNow() {
    if (saving) return;
    saving = true;
    clearFieldErrors();
    status("Enregistrement…");
    let rebuilt = 0;
    try {
      if (!entry) {
        const created = await api.createEntry(corpus.links.create, { id: form.id.value.trim(), ...metaOf() });
        adopt(created);
      } else if (metaChanged()) {
        const updated = await api.updateEntry(entry.links.update, metaOf());
        adopt(updated);
        showReport(updated.data.rebuild);
        rebuilt += dependentsIn(updated.data.rebuild);
      }
      if (sourceChanged() || codeChanged()) {
        const source = view.state.doc.toString();
        const code = hasCode() ? codeView.state.doc.toString() : undefined;
        const written = () => {
          savedSource = source;
          if (code !== undefined) savedCode = code;
        };
        const href = api.versionUrl(entry.data.id, author);
        try {
          const saved = await api.saveVersion({ method: "PUT", href }, { source, name: store.profile.displayName(), initials: store.profile.initials(), code });
          written();
          adopt(saved);
          showReport(saved.data.rebuild);
          rebuilt += dependentsIn(saved.data.rebuild);
        } catch (error) {
          // Written even when it does not compile (the server says so): nothing typed is lost.
          if (error instanceof api.ApiProblem && error.problem.saved) written();
          throw error;
        }
      }
      showProblem($("[data-error]"), view, null);
      saving = false;
      const s = rebuilt > 1 ? "s" : "";
      status(`✓ Enregistré à ${savedAt()}${rebuilt ? ` · ${rebuilt} fiche${s} ou entrée${s} liée${s} recompilée${s}` : ""}`, "ok");
    } catch (error) {
      saving = false;
      if (error instanceof api.ApiProblem && error.title === "TYPST_COMPILE_ERROR" && error.problem.saved) {
        status(`✓ Texte enregistré à ${savedAt()} · ne compile pas : ta version est absente des fiches jusqu'à correction`, "warn");
        showProblem($("[data-error]"), view, error.problem, "Corrige puis enregistre : ta version reviendra dans les fiches.");
        showReport(error.problem.rebuild);
        api.getEntry(entry.data.id).then(adopt, () => {});
        return;
      }
      if (error instanceof api.ApiProblem && error.title === "TYPST_COMPILE_ERROR") {
        // Not saved: only the version's source can fail to compile before being written.
        showProblem($("[data-error]"), view, error.problem);
      } else {
        explainFailure(error);
      }
      status("⚠ Non enregistré", "error");
    }
  }

  // ---------------------------------------------------------- CodeMirror

  const saveKey = { key: "Mod-s", preventDefault: true, run: () => (saveNow(), true) };
  let toggleMath = () => {};
  const view = new EditorView({
    parent: $("[data-editor]"),
    state: EditorState.create({
      doc: savedSource ?? NEW_VERSION,
      extensions: baseExtensions({
        keys: [saveKey, ...formattingKeys],
        onUpdate(update) {
          if (update.docChanged) {
            markDirty();
            schedulePreview();
          }
          if (update.docChanged || update.selectionSet) {
            toggleMath(isInMath(update.state.doc.toString(), update.state.selection.main.head));
          }
        },
      }),
    }),
  });

  const codeView = new EditorView({
    parent: $("[data-code]"),
    state: EditorState.create({
      doc: savedCode ?? codeTemplate(initialMeta.type),
      extensions: baseExtensions({ typst: false, keys: [saveKey], onUpdate: (update) => update.docChanged && markDirty() }),
    }),
  });

  // An entry cites others by title only (#voir from _corpus-titres.typ): no cycle possible.
  const picker = corpusPicker(view, {
    load: async () => (await api.listCorpus()).data.entries,
    actions: [
      {
        label: "Citer",
        title: "Le titre de l'entrée, en couleur : #voir(\"id\")",
        run: (v, other) => (ensureImport(v, "/_corpus-titres.typ", ["voir"]), insert(v, `#voir("${other.id}")`)),
      },
    ],
    exclude: () => (entry ? entry.data.id : null),
  });
  toggleMath = renderToolbar({ textRow: $("[data-text-tools]"), mathRow: $("[data-math-tools]") }, view, { tools: ENTRY_TOOLS, extras: [picker] });

  // Python pane: import a brick, run the code being written (with this author's bricks).
  const brickPicker = corpusPicker(codeView, {
    load: async () => (await api.listCorpus()).data.entries.filter((e) => e.type === "brique"),
    actions: [{ label: "Importer", title: "Ajoute la ligne from briques.… import … en tête du code", run: (v, brick) => addBrickImport(v, brick, author) }],
    exclude: () => (entry ? entry.data.id : null),
    label: "🧱 Briques",
    title: "Importer une brique de code du corpus",
  });
  $("[data-code-tools]").replaceChildren(brickPicker);
  $("[data-run]").replaceChildren(
    FRM.runner.panel({ code: () => codeView.state.doc.toString(), author, readings: () => (entry ? entry.data.readings : []) })
  );

  $("[data-save]").addEventListener("click", saveNow);
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = ""; // the browser asks before leaving: nothing is saved behind your back here
  });

  refreshMetaDisplay();
  showOthers();
  status(entry ? (savedSource === null ? "Pas encore de version de toi : écris-la puis enregistre" : "✓ À jour") : "Nouvelle entrée : titre, type, puis ta version", entry && savedSource !== null ? "ok" : "");
  refreshPreview();
  (entry ? view : form.titre).focus();
}

start();
