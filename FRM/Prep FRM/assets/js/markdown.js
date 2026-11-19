/* Markdown rendering of the notes and corpus entries, the way Obsidian shows them (notes/ is an
 * Obsidian vault): markdown-it, KaTeX for $…$ and $$…$$, and Obsidian's own syntax:
 *   [[id]] [[id|text]]   link to a corpus entry, coloured by its type
 *   ![[id]]              the whole entry, in its box (one level: an inserted entry only links)
 *   ![[name.png|500]]    an image of notes/images/, 500 px wide at most
 *   > [!tip] Title       a callout (tip, warning, info, note…)
 *   %% … %%              a comment, hidden
 * A YAML header (--- … ---) is left out. Classic script: works from file:// pages too.
 * Needs assets/vendor/markdown-it/markdown-it.min.js and assets/vendor/katex/katex.min.js loaded
 * before it; without them the text is shown as is. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
  const IMAGE_BASE = "notes/images/";
  const MAX_DEPTH = 1;
  const CALLOUTS = { tip: "À retenir", warning: "Piège", info: "Info", note: "Note", danger: "Attention", example: "Exemple", question: "Question", success: "Réussi" };
  const CALLOUT_ALIASES = { hint: "tip", important: "tip", caution: "warning", attention: "warning", error: "danger", bug: "danger", abstract: "note", summary: "note", todo: "note", faq: "question", help: "question", check: "success", done: "success", quote: "note", cite: "note" };

  /** { header, body }: the YAML header (text between the --- lines, or "") and the rest. */
  function splitFrontmatter(source) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source || "");
    return match ? { header: match[1], body: source.slice(match[0].length) } : { header: "", body: source || "" };
  }

  /** A simple value of the header ("titre: …"), for display only: the server parses YAML for real. */
  function headerValue(header, key) {
    const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(header || "");
    if (!match) return null;
    const value = match[1].trim();
    return /^(['"]).*\1$/.test(value) ? value.slice(1, -1).replace(/''/g, "'") : value;
  }

  const stripComments = (text) => text.replace(/%%[\s\S]*?%%/g, "");

  function katex(tex, display) {
    if (!window.katex) return `<code>${esc(tex)}</code>`;
    try {
      return window.katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: false });
    } catch (error) {
      return `<code class="md-math-error" title="${esc(error.message)}">${esc(tex)}</code>`;
    }
  }

  // ------------------------------------------------------------------ markdown-it plugins

  function mathPlugin(md) {
    // $$ … $$ on lines of their own (possibly over several lines).
    md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const first = state.src.slice(start, state.eMarks[startLine]);
      if (!first.startsWith("$$")) return false;
      let content = first.slice(2);
      let line = startLine;
      let closed = content.trimEnd().endsWith("$$") && content.trim().length >= 2;
      if (closed) content = content.trimEnd().slice(0, -2);
      while (!closed && ++line < endLine) {
        const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        if (text.trimEnd().endsWith("$$")) {
          content += "\n" + text.trimEnd().slice(0, -2);
          closed = true;
        } else content += "\n" + text;
      }
      if (!closed) return false;
      if (silent) return true;
      const token = state.push("math_block", "div", 0);
      token.content = content.trim();
      token.map = [startLine, line + 1];
      state.line = line + 1;
      return true;
    });
    // $…$ and $$…$$ inside a paragraph.
    md.inline.ruler.after("escape", "math_inline", (state, silent) => {
      const src = state.src;
      const pos = state.pos;
      if (src[pos] !== "$") return false;
      const display = src[pos + 1] === "$";
      const open = display ? 2 : 1;
      if (!display && /\s/.test(src[pos + 1] || " ")) return false;
      let end = pos + open;
      while ((end = src.indexOf(display ? "$$" : "$", end)) !== -1 && src[end - 1] === "\\") end += 1;
      if (end === -1 || end === pos + open) return false;
      if (!silent) {
        const token = state.push(display ? "math_display" : "math_inline", "span", 0);
        token.content = src.slice(pos + open, end);
      }
      state.pos = end + open;
      return true;
    });
    md.renderer.rules.math_block = (tokens, i) => `<div class="md-math">${katex(tokens[i].content, true)}</div>\n`;
    md.renderer.rules.math_inline = (tokens, i) => katex(tokens[i].content, false);
    md.renderer.rules.math_display = (tokens, i) => katex(tokens[i].content, true);
  }

  function wikiPlugin(md) {
    md.inline.ruler.before("link", "wikilink", (state, silent) => {
      const src = state.src;
      const embed = src[state.pos] === "!";
      const start = state.pos + (embed ? 1 : 0);
      if (src.slice(start, start + 2) !== "[[") return false;
      const end = src.indexOf("]]", start + 2);
      if (end === -1) return false;
      const inner = src.slice(start + 2, end);
      if (!inner || inner.includes("\n")) return false;
      if (!silent) {
        const [target, alias] = inner.split("|");
        const token = state.push("wikilink", "a", 0);
        token.meta = { embed, target: target.split("#")[0].trim(), alias: alias === undefined ? null : alias.trim() };
      }
      state.pos = end + 2;
      return true;
    });
    md.renderer.rules.wikilink = (tokens, i, options, env) => wikilink(tokens[i].meta, env);
  }

  function wikilink({ embed, target, alias }, env) {
    if (IMAGE.test(target)) {
      const width = /^\d+$/.test(alias || "") ? ` style="width:${alias}px"` : "";
      const name = target.split("/").pop();
      return `<img class="md-image" src="${esc(IMAGE_BASE + name)}" alt="${esc(name)}"${width}>`;
    }
    const entry = FRM.findEntry && FRM.findEntry(target);
    if (!entry) return `<span class="wikilink is-missing" title="Entrée inconnue du corpus">${esc(alias || target)}</span>`;
    if (embed && env.depth < MAX_DEPTH && !env.seen.includes(entry.id)) {
      return `</p>${renderEntryBox(entry, { depth: env.depth + 1, seen: [...env.seen, entry.id] })}<p>`;
    }
    return `<a class="wikilink etype-${esc(entry.type)}" href="${ui.entryHref(entry)}" data-entry-preview="${esc(entry.id)}">${esc(alias || entry.titre)}</a>`;
  }

  /** "> [!tip] Title": the blockquote becomes a callout, its first line the title. */
  function calloutPlugin(md) {
    md.core.ruler.before("inline", "callout", (state) => {
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i].type !== "blockquote_open" || tokens[i + 1]?.type !== "paragraph_open") continue;
        const inline = tokens[i + 2];
        const match = /^\[!(\w+)\][+-]?[ \t]*(.*)(?:\n|$)/.exec(inline?.content || "");
        if (!match) continue;
        const kind = CALLOUT_ALIASES[match[1].toLowerCase()] || (CALLOUTS[match[1].toLowerCase()] ? match[1].toLowerCase() : "note");
        tokens[i].attrSet("class", `callout callout-${kind}`);
        inline.content = inline.content.slice(match[0].length);
        const title = new state.Token("html_block", "", 0);
        title.content = `<div class="callout-title">${esc(match[2] || CALLOUTS[kind])}</div>\n`;
        tokens.splice(i + 1, 0, title);
        if (!inline.content.trim()) tokens.splice(i + 2, 3); // a callout with a title only
      }
    });
  }

  let engine = null;
  function md() {
    if (engine || !window.markdownit) return engine;
    engine = window.markdownit({ html: false, breaks: true, linkify: false, typographer: false });
    engine.use(mathPlugin).use(wikiPlugin).use(calloutPlugin);
    return engine;
  }

  // ------------------------------------------------------------------ public functions

  /** HTML of a Markdown text (a note or an entry). `depth` and `seen`: inside an inserted entry. */
  function renderMarkdown(source, { depth = 0, seen = [] } = {}) {
    const body = stripComments(splitFrontmatter(source).body);
    const engine = md();
    if (!engine) return `<pre class="md-raw">${esc(body)}</pre>`;
    return engine.render(body, { depth, seen }).replace(/<p>\s*<\/p>/g, "");
  }

  /** Variables of a financial product: a table when a note is written, else the names. */
  function variablesBlock(variables) {
    if (!variables || !variables.length) return "";
    const names = variables.filter((v) => v.nom);
    const body = names.some((v) => v.note)
      ? `<table class="entry-vars"><tbody>${names.map((v) => `<tr><td><code>${esc(v.nom)}</code></td><td>${esc(v.note || "")}</td></tr>`).join("")}</tbody></table>`
      : `<p>${names.map((v) => `<code>${esc(v.nom)}</code>`).join(" · ")}</p>`;
    return `<div class="entry-section"><div class="entry-section-title">Variables</div>${body}</div>`;
  }

  /** An entry in its box: type, title, text, then variables, assumptions (solid) and limits (dashed). */
  function renderEntryBox(entry, { depth = 0, seen = [entry.id] } = {}) {
    const type = FRM.entryType(entry.type) || { label: entry.type };
    const options = { depth, seen };
    const section = (title, text, dashed) =>
      text && text.trim() ? `<div class="entry-section${dashed ? " is-dashed" : ""}"><div class="entry-section-title">${title}</div><div class="md">${renderMarkdown(text, options)}</div></div>` : "";
    return `<div class="entry-box etype-${esc(entry.type)}">
<div class="entry-box-head"><span class="entry-box-type">${esc(type.label)}</span><span class="entry-box-title">${esc(entry.titre)}</span></div>
<div class="md">${entry.source && entry.source.trim() ? renderMarkdown(entry.source, options) : '<p class="muted small">Pas encore de texte.</p>'}</div>
${variablesBlock(entry.variables)}${section("Hypothèses", entry.hypotheses, false)}${section("Limites", entry.limites, true)}
</div>`;
  }

  Object.assign(FRM, { renderMarkdown, renderEntryBox, splitFrontmatter, headerValue });
})(window.FRM, window.FRM.ui);
