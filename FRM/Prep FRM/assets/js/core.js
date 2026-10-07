/* Noyau : accès au programme (data/curriculum.js), méthode de travail et indicateurs.
 *
 * Scripts classiques, pas de modules ES ni de fetch() : le site doit s'ouvrir
 * en double-cliquant sur index.html (file://), sans serveur. Tout passe donc
 * par l'objet global FRM, rempli dans l'ordre de chargement des <script>. */
(function (FRM) {
  "use strict";

  const curriculum = FRM.curriculum;
  const { progress, confidence, MAX_SCORE } = FRM.store;

  // ------------------------------------------------------------------ méthode (pas un contenu des PDFs)

  const STEPS = [
    { id: "objectives", n: 1, label: "Learning objectives lus", hint: "Savoir ce que GARP attend : ce qu'on doit être capable de faire." },
    { id: "questions", n: 2, label: "Questions AnalystPrep faites", hint: "Prédire la réponse avant de lire le corrigé." },
    { id: "simulation", n: 3, label: "Simulation Python", hint: "Reproduire le concept en code, court et copiable." },
    { id: "sheet", n: 4, label: "Fiche de présentation", hint: "De quoi présenter le reading : formule et intuition." },
  ];

  // Note de confiance sur 4 attribuée à chaque learning objective.
  const SCORE_LEVELS = [
    { value: 0, label: "Aucune idée" },
    { value: 1, label: "Vague" },
    { value: 2, label: "Partiel" },
    { value: 3, label: "Solide" },
    { value: 4, label: "Maîtrisé" },
  ];

  // ------------------------------------------------------------------ programme

  const books = curriculum.books;
  const readings = books.flatMap((book) => book.readings); // ordre officiel
  const bookOfReading = new Map(books.flatMap((book) => book.readings.map((r) => [r.id, book])));

  const findBook = (id) => books.find((book) => book.id === Number(id));
  const findReading = (id) => readings.find((reading) => reading.id === Number(id));

  function neighbours(reading) {
    const i = readings.indexOf(reading);
    return { previous: readings[i - 1], next: readings[i + 1] };
  }

  const questionCount = (list) => list.reduce((sum, r) => sum + r.questions.count, 0);
  const objectiveCount = (list) => list.reduce((sum, r) => sum + r.objectives.items.length, 0);

  /** Lien vers une page d'un PDF du dossier FRM/ (le viewer PDF du navigateur gère #page=). */
  function pdfHref(sourceKey, page) {
    return `../${encodeURI(curriculum.sources[sourceKey].file)}#page=${page}`;
  }

  // ------------------------------------------------------------------ indicateurs

  /** Étapes cochées sur une liste de readings. */
  function completion(list) {
    let done = 0;
    let finished = 0;
    let questionsDone = 0;
    for (const reading of list) {
      const n = STEPS.filter((s) => progress.isDone(reading.id, s.id)).length;
      done += n;
      if (n === STEPS.length) finished += 1;
      if (progress.isDone(reading.id, "questions")) questionsDone += reading.questions.count;
    }
    const total = list.length * STEPS.length;
    return { done, total, finished, count: list.length, questionsDone, ratio: total ? done / total : 0 };
  }

  /** Notes de confiance sur une liste de readings.
   *  ratio : somme des notes / (4 × nombre de LOs), un LO non noté compte 0.
   *  mean  : moyenne des seuls LOs notés (null si aucun). */
  function confidenceOf(list) {
    const histogram = SCORE_LEVELS.map(() => 0);
    let total = 0;
    let rated = 0;
    let sum = 0;
    for (const reading of list) {
      reading.objectives.items.forEach((_, index) => {
        total += 1;
        const score = confidence.get(reading.id, index);
        if (score === null) return;
        rated += 1;
        sum += score;
        histogram[score] += 1;
      });
    }
    return {
      total,
      rated,
      unrated: total - rated,
      histogram,
      mean: rated ? sum / rated : null,
      ratio: total ? sum / (MAX_SCORE * total) : 0,
    };
  }

  /** Mesure pondérée par le poids de chaque livre à l'examen (study guide). */
  function weighted(list, measure) {
    const totalWeight = list.reduce((sum, b) => sum + b.weight, 0);
    return list.reduce((sum, b) => sum + b.weight * measure(b.readings).ratio, 0) / totalWeight;
  }

  /** Portée d'un indicateur : "all", "book:2" ou "reading:12". "all" est pondéré par livre. */
  function scoped(measure) {
    return (scope) => {
      const [kind, id] = scope.split(":");
      if (kind === "all") return { ...measure(readings), ratio: weighted(books, measure) };
      if (kind === "book") return measure(findBook(id).readings);
      if (kind === "reading") return measure([findReading(id)]);
      throw new Error(`Portée inconnue : ${scope}`);
    };
  }

  /** Première étape non cochée, dans l'ordre officiel. */
  function nextStep() {
    for (const reading of readings) {
      const step = STEPS.find((s) => !progress.isDone(reading.id, s.id));
      if (step) return { reading, step, book: bookOfReading.get(reading.id) };
    }
    return null;
  }

  // ------------------------------------------------------------------ corpus (notes/corpus/index.js)

  // Same order and colours as types-entree in notes/_gabarit.typ (colours live in style.css).
  const ENTRY_TYPES = [
    { id: "formule", label: "Formule", plural: "Formules" },
    { id: "definition", label: "Définition", plural: "Définitions" },
    { id: "propriete", label: "Propriété", plural: "Propriétés" },
    { id: "theoreme", label: "Théorème", plural: "Théorèmes" },
    { id: "produit", label: "Produit financier", plural: "Produits financiers" },
    { id: "simulation", label: "Simulation", plural: "Simulations" },
    { id: "brique", label: "Brique de code", plural: "Briques de code" },
  ];

  let corpus = {};

  let notes = {};

  // ------------------------------------------------------------------ attachment of an entry to readings
  // An entry belongs to the readings of the notes citing it and of the questions linked to it; the
  // two origins stay apart (noteReadings, questionReadings) for the "Rattachement" filters, which
  // look at a scope: the chosen reading, else the chosen book, else any reading.

  // unscoped: only meaningful when no reading or book is chosen. With one, every entry shown is in
  // it, so "Fiche ou questions" would be everything and "Ni fiche ni question" nothing.
  const ATTACHMENTS = [
    { id: "all", label: "Tout", title: "Aucun filtre de rattachement" },
    { id: "any", label: "Fiche ou questions", title: "Citée dans une fiche, liée à des questions, ou les deux", unscoped: true },
    { id: "both", label: "Fiche et questions", title: "Citée dans une fiche et liée à des questions" },
    { id: "noQuestion", label: "Pas encore dans une question", title: "Citée dans une fiche, liée à aucune question" },
    { id: "noNote", label: "Pas encore dans une fiche", title: "Liée à des questions, citée dans aucune fiche" },
    { id: "none", label: "Ni fiche ni question", title: "Rattachée à aucun reading", unscoped: true },
  ];

  /** Readings the "Rattachement" filters look at: [the chosen reading], else the chosen books'
   *  readings, else null (any reading). `books`: a book id, a Set of ids (multi-select, see
   *  toggleChoice) or null; "all", null and "Sans reading" count as not chosen. */
  function attachmentScope(readingId, books) {
    const reading = findReading(readingId);
    if (reading) return [reading.id];
    const ids = books === null || books === undefined || books === "all" ? [] : typeof books === "object" ? [...books] : [books];
    const chosen = ids.map(findBook).filter(Boolean);
    return chosen.length ? chosen.flatMap((book) => book.readings.map((r) => r.id)) : null;
  }

  /** { note, question }: is the entry used by a note, linked to a question, within scope — a
   *  reading id, a list of reading ids, or null for any reading. A manifest written before
   *  2026-10-07 has no origins. */
  function attachmentOf(entry, scope = null) {
    const noteReadings = entry.noteReadings || entry.readings || [];
    const questionReadings = entry.questionReadings || [];
    if (scope === null || scope === undefined || scope === "all") {
      return { note: noteReadings.length > 0, question: questionReadings.length > 0 };
    }
    const ids = new Set([].concat(scope).map(Number));
    return { note: noteReadings.some((r) => ids.has(r)), question: questionReadings.some((r) => ids.has(r)) };
  }

  /** {option id: how many of `entries` it keeps within `scope`}: the counts shown on the options. */
  const attachmentCounts = (entries, scope = null) =>
    Object.fromEntries(ATTACHMENTS.map((a) => [a.id, entries.filter((entry) => matchesAttachment(entry, a.id, scope)).length]));

  function matchesAttachment(entry, filter, scope = null) {
    if (!filter || filter === "all") return true;
    const { note, question } = attachmentOf(entry, scope);
    if (filter === "any") return note || question;
    if (filter === "both") return note && question;
    if (filter === "noQuestion") return note && !question;
    if (filter === "noNote") return question && !note;
    return !note && !question; // none
  }

  // ------------------------------------------------------------------ journals of the shared notes and entries
  // Notes and entries belong to everyone; their journal (backend/journal.py) lists sessions:
  // { author, name, initials, start, end, saves, creation }.

  /** { creator: {author, name, initials, at} | null, contributors, last }: who created a note or
   *  an entry, and everyone who changed it (creator included) with { author, name, initials,
   *  sessions, saves, last, creator }; the creator first, then the most recent. */
  function journalSummary(journal = []) {
    const sessions = [...journal].sort((a, b) => a.start - b.start);
    const first = sessions.find((s) => s.creation) || sessions[0];
    const byAuthor = new Map();
    for (const s of sessions) {
      const c = byAuthor.get(s.author) || { author: s.author, sessions: 0, saves: 0, last: 0, creator: false };
      Object.assign(c, { name: s.name, initials: s.initials, sessions: c.sessions + 1, saves: c.saves + s.saves, last: Math.max(c.last, s.end) });
      byAuthor.set(s.author, c);
    }
    if (first) byAuthor.get(first.author).creator = true;
    return {
      creator: first ? { author: first.author, name: first.name, initials: first.initials, at: first.start } : null,
      contributors: [...byAuthor.values()].sort((a, b) => b.creator - a.creator || b.last - a.last),
      last: sessions.length ? Math.max(...sessions.map((s) => s.end)) : null,
    };
  }

  /** Author slugs of everyone who created or changed a note or an entry (the "Contributeur" filters). */
  const contributorsOf = (journal = []) => [...new Set(journal.map((s) => s.author))];

  // ------------------------------------------------------------------ multi-select filters (types, books, authors)
  // A selection is null (everything, the "Tous" button) or a Set of string values.

  /** Selection after a click on `value` among the `available` values: "all" selects everything; a
   *  value clicked while everything is selected becomes the only one; otherwise it is toggled, and
   *  an empty or complete selection is everything again. */
  function toggleChoice(selection, value, available) {
    const clicked = String(value);
    if (clicked === "all") return null;
    if (selection === null) return available.length > 1 ? new Set([clicked]) : null;
    const next = new Set(selection);
    if (next.has(clicked)) next.delete(clicked);
    else next.add(clicked);
    return next.size === 0 || available.every((v) => next.has(String(v))) ? null : next;
  }

  const isChosen = (selection, value) => selection === null || selection.has(String(value));

  // ------------------------------------------------------------------ entries linked to search results
  // "Entrées liées" adds the entries linked to the results: citations (#voir) and code imports, both
  // ways, up to a depth (0: none, 1: direct neighbours, Infinity: the whole chain). They are shown
  // pale, like the graph's neighbours. The control itself is ui.linkedControl.

  /** Entries of `pool` linked to `results` but not among them, in the order reached, at most
   *  `depth` steps away (through any entry of the pool). Only `accept`ed ones are returned: the
   *  control widens where to look, not what to show (type, author). Each comes with `via`, the ids
   *  it was reached from. Links are rebuilt from `cites` and `imports`, which API entries have too
   *  (unlike `citedBy`). */
  function linkedTo(results, depth, pool, accept = () => true) {
    if (!(depth > 0)) return [];
    const byId = new Map(pool.map((entry) => [entry.id, entry]));
    const neighbours = new Map(pool.map((entry) => [entry.id, new Set()]));
    for (const entry of pool) {
      for (const id of [...(entry.cites || []), ...(entry.imports || [])]) {
        if (id === entry.id || !neighbours.has(id)) continue;
        neighbours.get(entry.id).add(id);
        neighbours.get(id).add(entry.id);
      }
    }
    const via = new Map(results.map((entry) => [entry.id, null])); // null: a result
    let frontier = results.map((entry) => entry.id).filter((id) => neighbours.has(id));
    for (let level = 0; frontier.length && level < depth; level += 1) {
      const step = new Map();
      for (const from of frontier) {
        for (const id of neighbours.get(from)) {
          if (via.has(id)) continue;
          if (!step.has(id)) step.set(id, []);
          step.get(id).push(from);
        }
      }
      step.forEach((sources, id) => via.set(id, sources));
      frontier = [...step.keys()];
    }
    return [...via]
      .filter(([, sources]) => sources)
      .map(([id, sources]) => ({ entry: byId.get(id), via: sources }))
      .filter(({ entry }) => accept(entry));
  }

  /** "liée à Expected Loss, Credit Risk et 2 autres": what brought a linked entry. */
  function linkedLabel(via, pool) {
    const titles = via.map((id) => pool.find((entry) => entry.id === id)?.titre).filter(Boolean);
    const more = titles.length - 2;
    return `liée à ${titles.slice(0, 2).join(", ")}${more > 0 ? ` et ${more === 1 ? "une autre" : `${more} autres`}` : ""}`;
  }

  Object.assign(FRM, {
    STEPS,
    SCORE_LEVELS,
    books,
    readings,
    sources: curriculum.sources,
    examApproach: curriculum.examApproach,
    findBook,
    findReading,
    bookOf: (reading) => bookOfReading.get(reading.id),
    neighbours,
    questionCount,
    objectiveCount,
    pdfHref,
    completion,
    confidenceOf,
    weighted,
    completionOf: scoped(completion),
    confidenceOfScope: scoped(confidenceOf),
    nextStep,
    // notes/index.js, written by the server: compiled notes by reading then author.
    // notes/index.js, written by the server: the shared note of each reading ({ pages, pdf, updatedAt, journal }).
    registerNotes: (manifest) => (notes = manifest || {}),
    noteOf: (readingId) => notes[String(readingId)] || null,
    ENTRY_TYPES,
    entryType: (id) => ENTRY_TYPES.find((type) => type.id === id),
    // notes/corpus/index.js, written by the server: every entry with its rendering, journal and back-links.
    registerCorpus: (manifest) => (corpus = manifest || {}),
    corpusEntries: () => Object.values(corpus).sort((a, b) => a.titre.localeCompare(b.titre, "fr")),
    findEntry: (id) => corpus[id],
    corpusOf: (readingId) => FRM.corpusEntries().filter((entry) => entry.readings.includes(Number(readingId))),
    ATTACHMENTS,
    attachmentScope,
    attachmentOf,
    matchesAttachment,
    attachmentCounts,
    linkedTo,
    linkedLabel,
    toggleChoice,
    isChosen,
    journalSummary,
    contributorsOf,
  });
})(window.FRM);
