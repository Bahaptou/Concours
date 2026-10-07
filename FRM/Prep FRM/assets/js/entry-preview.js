/* Preview card of a corpus entry: the start of its rendering (the last one that compiled) and a link to it, shown when the pointer rests on an element naming the
 * entry. Slow to come (SHOW_DELAY), quick to go (HIDE_DELAY: just the time to reach the card);
 * placed above the element (below when the window has no room above), never over it, so the
 * element stays clickable. Fixed height (style.css), so the position holds before the image loads.
 * Used by the corpus graph (its boxes) and the corpus stats (names, data-entry-preview="<id>"). */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const SHOW_DELAY = 600;
  const HIDE_DELAY = 150;

  /**
   * A preview card positioned in `host`. Returns:
   * hover(el, id): at each pointer move, `el` the element under the pointer naming entry `id`, or null;
   * silence(id): closes the card, none for `id` until the pointer leaves it (after a click);
   * hide(): closes the card (scroll, drag).
   */
  function create(host) {
    host.classList.add("preview-host");
    const card = Object.assign(document.createElement("div"), { className: "entry-preview", hidden: true });
    let shown = null; // id on the card
    let pending = null; // id waiting for SHOW_DELAY
    let silenced = null;
    let showTimer = null;
    let hideTimer = null;

    const visible = () => card.isConnected && !card.hidden;
    function cancelShow() {
      clearTimeout(showTimer);
      pending = null;
    }
    function closeCard() {
      clearTimeout(hideTimer);
      card.hidden = true;
      shown = null;
    }
    function hide() {
      cancelShow();
      closeCard();
    }
    /** Closes the card shortly; a preview waiting for another element still comes. */
    function hideSoon() {
      clearTimeout(hideTimer);
      if (visible()) hideTimer = setTimeout(closeCard, HIDE_DELAY);
    }

    function show(el, id) {
      cancelShow();
      clearTimeout(hideTimer);
      const entry = FRM.findEntry(id);
      if (!entry || !el.isConnected) return;
      card.innerHTML = `
<div class="ep-head">${ui.typeTag(entry.type)}<strong>${esc(entry.titre)}</strong></div>
${entry.pages.length ? `<div class="ep-render"><img src="${esc(`${entry.pages[0]}?v=${entry.updatedAt}`)}" alt="${esc(`Début de « ${entry.titre} »`)}"></div>` : `<div class="ep-render ep-empty muted small">Pas encore de rendu.</div>`}
<div class="ep-foot"><span class="eauthors">${ui.contributorBadges(entry.journal)}</span><a class="btn" href="${ui.entryHref(entry)}">Ouvrir l'entrée →</a></div>`;
      if (!card.isConnected) host.appendChild(card); // the host's content may have been re-rendered
      card.hidden = false;
      shown = id;
      const box = el.getBoundingClientRect();
      const frame = host.getBoundingClientRect();
      const gap = 8;
      const left = Math.min(Math.max(box.left + box.width / 2 - card.offsetWidth / 2 - frame.left, 0), Math.max(frame.width - card.offsetWidth, 0));
      const above = box.top - card.offsetHeight - gap >= 0;
      card.style.left = `${left}px`;
      card.style.top = `${(above ? box.top - card.offsetHeight - gap : box.bottom + gap) - frame.top}px`;
    }

    function hover(el, id) {
      if (!el) id = null;
      if (id !== silenced) silenced = null;
      if (!visible()) shown = null;
      if (id && id === shown) return clearTimeout(hideTimer); // back on the element shown
      hideSoon(); // left it: for another element, or toward the card
      if (!id || id === silenced) return cancelShow();
      if (id === pending) return; // moving within the element does not restart the delay
      cancelShow();
      pending = id;
      showTimer = setTimeout(() => show(el, id), SHOW_DELAY);
    }

    card.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    card.addEventListener("pointerleave", hideSoon);
    return {
      hover,
      hide,
      silence(id) {
        hide();
        silenced = id;
      },
    };
  }

  /** Previews for the elements carrying data-entry-preview="<id>" inside `root` (wired once per root). */
  function watch(root) {
    if (root.entryPreview) return root.entryPreview;
    const preview = create(root);
    root.addEventListener("pointermove", (event) => {
      if (event.target.closest(".entry-preview")) return; // on the card itself
      const el = event.target.closest("[data-entry-preview]");
      preview.hover(el, el && el.dataset.entryPreview);
    });
    root.addEventListener("pointerleave", () => preview.hover(null));
    root.addEventListener("click", (event) => {
      const el = event.target.closest("[data-entry-preview]");
      if (el) preview.silence(el.dataset.entryPreview);
    });
    root.entryPreview = preview;
    return preview;
  }

  FRM.entryPreview = { create, watch };
})(window.FRM, window.FRM.ui);
