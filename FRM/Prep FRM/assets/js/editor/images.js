// "Images" menu of the editors: add an image to the shared folder notes/images/ (chosen file,
// pasted screenshot or dropped file), or pick one already there, then insert
// #image("/images/…") at the cursor. The path starts at the Typst root, so it works in a note,
// in an entry and in a note inserting that entry.
// Images are compressed here, before sending: the server only checks what it receives.
import * as api from "./api.js";
import { insertBlock } from "./toolbar.js";
import { keepCursorBelowHeader } from "./corpus-picker.js";

const { FRM } = window;
const { esc, fold } = FRM.ui;

const MAX_SIDE = 1600; // px: enough for a page 17 cm wide
const PNG_UP_TO = 400_000; // bytes: below this a PNG (sharp text, lossless) is kept as is
const JPEG_QUALITY = 0.85;
const MAX_BYTES = 4_000_000; // same bound as backend/images.py
const NAME = /^[a-z0-9][a-z0-9-]{1,59}$/; // same rule as backend/images.py
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";

/** Line inserted in the source; the width is easy to change by hand. */
export const imageLine = (typstPath) => `#image("${typstPath}", width: 70%)`;

/** Readable file name: "Courbe des taux.png" -> "courbe-des-taux". */
const slugify = (text) => fold(text).replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 60).replace(/-+$/, "");

const kilobytes = (bytes) => `${Math.max(1, Math.round(bytes / 1000))} Ko`;

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * What the server takes: { format, data (base64), bytes, width, height }. A bitmap is shrunk to
 * MAX_SIDE and re-encoded: PNG when small enough, otherwise the lighter of PNG and JPEG (JPEG on
 * white, having no transparency). An SVG is sent as it is.
 */
export async function compress(blob) {
  if (blob.type === "image/svg+xml") return { format: "svg", data: await readBase64(blob), bytes: blob.size, width: null, height: null };
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    throw new Error("Ce fichier n'est pas une image lisible (PNG, JPEG, GIF, WebP ou SVG).");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement("canvas"), {
    width: Math.round(bitmap.width * scale),
    height: Math.round(bitmap.height * scale),
  });
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let chosen = { blob: await canvasBlob(canvas, "image/png"), format: "png" };
  if (chosen.blob.size > PNG_UP_TO) {
    context.globalCompositeOperation = "destination-over"; // white goes under what is drawn
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const jpeg = await canvasBlob(canvas, "image/jpeg", JPEG_QUALITY);
    if (jpeg.size < chosen.blob.size) chosen = { blob: jpeg, format: "jpg" };
  }
  return { format: chosen.format, data: await readBase64(chosen.blob), bytes: chosen.blob.size, width: canvas.width, height: canvas.height };
}

/**
 * Builds the menu. `view`: the editor to write into, or a function returning it (editors with
 * several fields). Returns { element, open(file) }: `open` shows the panel with a file to add
 * (used by paste and drop, see attachImageInput).
 */
export function imageMenu(view) {
  const target = typeof view === "function" ? view : () => view;
  const root = Object.assign(document.createElement("div"), { className: "picker" });
  root.innerHTML = `
<button type="button" class="tool" aria-expanded="false" title="Ajouter une image (ou coller une capture avec Ctrl+V dans le texte), ou insérer une image existante">🖼 Images</button>
<div class="picker-panel image-panel" hidden>
  <div class="image-drop" data-img-drop>
    <div data-img-preview>Colle une capture (Ctrl+V), glisse un fichier ici, ou <button type="button" class="link-btn" data-img-choose>choisis un fichier</button>.</div>
  </div>
  <input type="file" accept="${ACCEPT}" hidden data-img-file>
  <div class="image-add" data-img-add-form hidden>
    <label class="field">Nom de l'image <span class="hint">commun à tous : sois précis (ex. « courbe-des-taux-normale »)</span><input data-img-name maxlength="60" autocomplete="off"></label>
    <div class="form-error" data-img-error hidden></div>
    <div><button type="button" class="btn" data-img-add disabled>Ajouter et insérer</button></div>
  </div>
  <input type="search" class="search" placeholder="Chercher une image déjà ajoutée…" aria-label="Chercher une image">
  <ul class="picker-list image-list"></ul>
  <div class="picker-foot"><span data-img-status></span><span>Dossier commun : <code>notes/images/</code></span></div>
</div>`;
  const $ = (selector) => root.querySelector(selector);
  const button = root.querySelector("button");
  const panel = $(".picker-panel");
  const nameInput = $("[data-img-name]");
  const addButton = $("[data-img-add]");
  const errorBox = $("[data-img-error]");
  const search = $(".search");
  let images = [];
  let pending = null; // compressed image waiting for a name

  function insertPath(typstPath) {
    resetAdd(); // an image waiting for a name is dropped: the panel opens clean next time
    close();
    const editor = target();
    keepCursorBelowHeader(editor);
    insertBlock(editor, imageLine(typstPath));
  }

  function showError(html) {
    errorBox.innerHTML = html;
    errorBox.hidden = !html;
  }

  function renderList() {
    const query = fold(search.value.trim());
    const shown = images.filter((image) => !query || fold(image.name).includes(query));
    $(".image-list").innerHTML =
      shown
        .map(
          (image) => `
<li class="picker-item">
  <img src="${esc(image.url)}" alt="" loading="lazy">
  <span class="ptitle">${esc(image.name)} <span class="entry-id">${esc(image.format)} · ${kilobytes(image.size)}</span></span>
  <button type="button" class="tool" data-img-insert="${esc(image.typstPath)}">Insérer</button>
</li>`
        )
        .join("") || `<li class="picker-item muted">${images.length ? "Aucune image ne correspond." : "Aucune image pour l'instant."}</li>`;
    $("[data-img-status]").textContent = `${shown.length} / ${images.length}`;
  }

  async function loadList() {
    $("[data-img-status]").textContent = "Chargement…";
    try {
      images = (await api.listImages()).data.images;
      renderList();
    } catch (error) {
      $("[data-img-status]").textContent = `⚠ ${error.message}`;
    }
  }

  function resetAdd() {
    pending = null;
    $("[data-img-preview]").innerHTML = `Colle une capture (Ctrl+V), glisse un fichier ici, ou <button type="button" class="link-btn" data-img-choose>choisis un fichier</button>.`;
    $("[data-img-add-form]").hidden = true;
    nameInput.value = "";
    showError("");
  }

  function refreshAddButton() {
    addButton.disabled = !pending || !NAME.test(nameInput.value);
  }

  /** Opens the panel with a file to add: compressed, previewed, waiting for its name. */
  async function open(file) {
    if (panel.hidden) show();
    showError("");
    pending = null;
    $("[data-img-add-form]").hidden = true;
    $("[data-img-preview]").textContent = "Compression…";
    try {
      pending = await compress(file);
    } catch (error) {
      resetAdd();
      return showError(esc(error.message));
    }
    const mime = pending.format === "svg" ? "image/svg+xml" : pending.format === "jpg" ? "image/jpeg" : "image/png";
    const size = pending.width ? `${pending.width}×${pending.height} px · ` : "";
    $("[data-img-preview]").innerHTML = `<img src="data:${mime};base64,${pending.data}" alt="Aperçu"><div class="small muted">${size}${pending.format.toUpperCase()} · ${kilobytes(pending.bytes)}</div>`;
    $("[data-img-add-form]").hidden = false;
    if (pending.bytes > MAX_BYTES) {
      showError(`Image trop lourde même compressée (${kilobytes(pending.bytes)}, maximum ${MAX_BYTES / 1_000_000} Mo).`);
      pending = null;
    }
    // A pasted screenshot is called "image.png": no name worth keeping.
    nameInput.value = file.name && !/^image\.\w+$/i.test(file.name) ? slugify(file.name) : "";
    refreshAddButton();
    nameInput.focus();
  }

  async function add() {
    if (addButton.disabled) return;
    addButton.disabled = true;
    showError("");
    try {
      const saved = await api.addImage({ name: nameInput.value, format: pending.format, data: pending.data });
      insertPath(saved.data.typstPath);
    } catch (error) {
      if (error instanceof api.ApiProblem && error.title === "IMAGE_CONFLICT") {
        showError(`Une image s'appelle déjà « ${esc(error.problem.name)} ». Choisis un autre nom, ou <button type="button" class="link-btn" data-img-insert="${esc(error.problem.typstPath)}">insère l'image existante</button>.`);
      } else {
        showError(esc(error.message));
      }
      refreshAddButton();
    }
  }

  function show() {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    loadList();
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  button.addEventListener("click", () => (panel.hidden ? show() : close()));
  panel.addEventListener("mousedown", (event) => {
    // Keep the editor's selection when clicking buttons of the panel (not its text fields).
    if (event.target.closest("button")) event.preventDefault();
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-img-choose]")) return $("[data-img-file]").click();
    const insertButton = event.target.closest("[data-img-insert]");
    if (insertButton) insertPath(insertButton.dataset.imgInsert);
  });
  $("[data-img-file]").addEventListener("change", (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (file) open(file);
  });
  const drop = $("[data-img-drop]");
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const file = imageFile(event.dataTransfer);
    if (file) open(file);
  });
  nameInput.addEventListener("input", () => {
    showError("");
    refreshAddButton();
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") add();
  });
  addButton.addEventListener("click", add);
  search.addEventListener("input", renderList);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      target().focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) close();
  });
  return { element: root, open };
}

/** First image file of a paste or a drop, or null. */
function imageFile(transfer) {
  return transfer ? [...transfer.files].find((file) => file.type.startsWith("image/")) || null : null;
}

/** Paste a screenshot or drop an image file in an editor: the Images menu opens with it.
 *  Anything else (text) goes to CodeMirror as usual. */
export function attachImageInput(view, open) {
  view.dom.addEventListener(
    "paste",
    (event) => {
      const file = imageFile(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      open(file);
    },
    true
  );
  view.dom.addEventListener(
    "dragover",
    (event) => {
      if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === "file")) event.preventDefault();
    },
    true
  );
  view.dom.addEventListener(
    "drop",
    (event) => {
      const file = imageFile(event.dataTransfer);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      // Insert where the file was dropped.
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position !== null) view.dispatch({ selection: { anchor: position } });
      view.focus();
      open(file);
    },
    true
  );
}
