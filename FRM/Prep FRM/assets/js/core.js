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
    { id: "simulation", label: "Simulation", plural: "Simulations" },
    { id: "brique", label: "Brique de code", plural: "Briques de code" },
  ];

  let corpus = {};

  let notes = {};

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
    registerNotes: (manifest) => (notes = manifest || {}),
    notesOf: (readingId) => notes[String(readingId)] || {},
    ENTRY_TYPES,
    entryType: (id) => ENTRY_TYPES.find((type) => type.id === id),
    // notes/corpus/index.js, written by the server: every entry with its versions and back-links.
    registerCorpus: (manifest) => (corpus = manifest || {}),
    corpusEntries: () => Object.values(corpus).sort((a, b) => a.titre.localeCompare(b.titre, "fr")),
    findEntry: (id) => corpus[id],
    corpusOf: (readingId) => FRM.corpusEntries().filter((entry) => entry.readings.includes(Number(readingId))),
  });
})(window.FRM);
