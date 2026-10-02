/* Questions AnalystPrep : chargement à la demande (data/questions/rN.js),
 * enregistrement des réponses, statistiques, constitution des séries.
 *
 * Les statistiques ne lisent que les essais enregistrés (store.attempts) et les
 * nombres de questions du programme : pas besoin de charger le texte des questions. */
(function (FRM) {
  "use strict";

  const { store } = FRM;

  // Rythme de l'examen Part I (100 questions en 4 heures), repère pour le chronomètre.
  const EXAM_PACE_MS = (4 * 60 * 60 * 1000) / 100;

  const SELECTIONS = [
    { id: "all", label: "Toutes" },
    { id: "unseen", label: "Jamais vues" },
    { id: "wrong", label: "Ratées au dernier essai" },
    { id: "flagged", label: "Marquées" },
  ];

  const FLAG_LABELS = { review: "À revoir", unreadable: "Formule illisible" };

  // ------------------------------------------------------------------ chargement

  const banks = new Map(); // readingId -> questions

  FRM.registerQuestions = (readingId, questions) => {
    const reading = Number(readingId);
    banks.set(reading, questions.map((q) => ({ ...q, reading })));
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement("script"), { src, onload: resolve, onerror: reject });
      document.body.appendChild(script);
    });
  }

  /** Questions des readings demandés, dans l'ordre du programme puis du PDF. */
  async function load(readingIds) {
    const missing = readingIds.filter((id) => !banks.has(id));
    await Promise.all(missing.map((id) => loadScript(`data/questions/r${id}.js`)));
    return readingIds.flatMap((id) => banks.get(id) || []);
  }

  // ------------------------------------------------------------------ index des essais (mis en cache)

  let cache = { revision: -1 };

  /** Par question : essais dans l'ordre, premier et dernier résultat, maîtrise, temps. */
  function index() {
    if (cache.revision === store.revision()) return cache;
    const byQuestion = new Map();
    for (const attempt of [...store.attempts.all()].sort((a, b) => a.at - b.at)) {
      const record = byQuestion.get(attempt.q) || { id: attempt.q, reading: attempt.reading, attempts: [] };
      record.attempts.push(attempt);
      byQuestion.set(attempt.q, record);
    }
    const byReading = new Map();
    for (const record of byQuestion.values()) {
      const list = record.attempts;
      const timed = list.filter((a) => a.ms !== null);
      Object.assign(record, {
        count: list.length,
        correctCount: list.filter((a) => a.correct).length,
        firstCorrect: list[0].correct,
        lastCorrect: list[list.length - 1].correct,
        lastChoice: list[list.length - 1].choice,
        mastered: list.length >= 2 && list.slice(-2).every((a) => a.correct),
        totalMs: timed.reduce((sum, a) => sum + a.ms, 0),
        timedCount: timed.length,
        lastAt: list[list.length - 1].at,
      });
      if (!byReading.has(record.reading)) byReading.set(record.reading, []);
      byReading.get(record.reading).push(record);
    }
    cache = { revision: store.revision(), byQuestion, byReading };
    return cache;
  }

  const recordOf = (questionId) => index().byQuestion.get(String(questionId)) || null;
  const recordsOf = (readingId) => index().byReading.get(Number(readingId)) || [];

  /** Statistiques d'une liste de readings.
   *  firstRate / lastRate : réussite au premier / dernier essai, sur les questions vues.
   *  ratio : questions justes au dernier essai / toutes les questions (non vue = 0). */
  function statsOf(readings) {
    const s = { total: 0, seen: 0, attempts: 0, correctAttempts: 0, firstOk: 0, lastOk: 0, mastered: 0, totalMs: 0, timed: 0 };
    for (const reading of readings) {
      s.total += reading.questions.count;
      for (const r of recordsOf(reading.id)) {
        s.seen += 1;
        s.attempts += r.count;
        s.correctAttempts += r.correctCount;
        s.firstOk += r.firstCorrect ? 1 : 0;
        s.lastOk += r.lastCorrect ? 1 : 0;
        s.mastered += r.mastered ? 1 : 0;
        s.totalMs += r.totalMs;
        s.timed += r.timedCount;
      }
    }
    return {
      ...s,
      unseen: s.total - s.seen,
      firstRate: s.seen ? s.firstOk / s.seen : null,
      lastRate: s.seen ? s.lastOk / s.seen : null,
      avgMs: s.timed ? s.totalMs / s.timed : null,
      ratio: s.total ? s.lastOk / s.total : 0,
    };
  }

  function statsOfScope(scope) {
    const [kind, id] = scope.split(":");
    if (kind === "all") return statsOf(FRM.readings);
    if (kind === "book") return statsOf(FRM.findBook(id).readings);
    if (kind === "reading") return statsOf([FRM.findReading(id)]);
    throw new Error(`Portée inconnue : ${scope}`);
  }

  // ------------------------------------------------------------------ enregistrement

  /** answers : [{ question, choice, ms }]. Coche l'étape ② d'un reading quand sa dernière
   *  question jamais vue vient d'être tentée (la case reste décochable à la main). */
  function recordAnswers(answers, sessionId) {
    if (!answers.length) return;
    const readingIds = [...new Set(answers.map((a) => a.question.reading))];
    const seenBefore = new Map(readingIds.map((id) => [id, recordsOf(id).length]));
    const at = Date.now();
    store.attempts.add(
      answers.map(({ question, choice, ms }) => ({
        q: question.id,
        reading: question.reading,
        choice,
        correct: choice === question.answer,
        ms: Number.isFinite(ms) ? Math.round(ms) : null,
        at,
        session: sessionId || null,
      }))
    );
    for (const id of readingIds) {
      const total = FRM.findReading(id).questions.count;
      if (seenBefore.get(id) < total && recordsOf(id).length >= total) store.progress.set(id, "questions", true);
    }
  }

  // ------------------------------------------------------------------ séries

  const isFlagged = (q) => Object.keys(store.flags.get(q.id)).length > 0;

  const FILTERS = {
    all: () => true,
    unseen: (q) => !recordOf(q.id),
    wrong: (q) => {
      const r = recordOf(q.id);
      return Boolean(r && !r.lastCorrect);
    },
    flagged: isFlagged,
  };

  const filterPool = (questions, selection) => questions.filter(FILTERS[selection] || FILTERS.all);

  function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Répartit `count` questions entre les livres selon leur poids à l'examen
   *  (plus forts restes), sans dépasser ce que chaque livre peut fournir. */
  function weightedPick(pool, count) {
    const groups = FRM.books.map((book) => ({
      book,
      questions: shuffle(pool.filter((q) => FRM.bookOf(FRM.findReading(q.reading)) === book)),
    }));
    const available = groups.filter((g) => g.questions.length);
    const totalWeight = available.reduce((sum, g) => sum + g.book.weight, 0);
    const target = Math.min(count, pool.length);
    const shares = available.map((g) => {
      const exact = (target * g.book.weight) / totalWeight;
      return { g, n: Math.min(Math.floor(exact), g.questions.length), rest: exact - Math.floor(exact) };
    });
    // Questions restantes : une à la fois, plus forts restes d'abord, puis à tour de rôle.
    const queue = [...shares].sort((a, b) => b.rest - a.rest);
    let missing = target - shares.reduce((sum, s) => sum + s.n, 0);
    while (missing > 0) {
      const next = queue.find((s) => s.n < s.g.questions.length);
      next.n += 1;
      missing -= 1;
      queue.push(queue.splice(queue.indexOf(next), 1)[0]);
    }
    return shuffle(shares.flatMap((s) => s.g.questions.slice(0, s.n)));
  }

  /** Constitue une série : filtre, ordre, nombre, répartition selon les poids d'examen. */
  function buildSeries(questions, { selection = "all", count = null, order = "pdf", weighted = false }) {
    const pool = filterPool(questions, selection);
    if (weighted) return weightedPick(pool, count || pool.length);
    const ordered = order === "random" ? shuffle(pool) : pool;
    return count ? ordered.slice(0, count) : ordered;
  }

  FRM.questions = {
    EXAM_PACE_MS,
    SELECTIONS,
    FLAG_LABELS,
    load,
    loaded: (readingId) => banks.get(Number(readingId)) || null,
    recordOf,
    recordsOf,
    statsOf,
    statsOfScope,
    recordAnswers,
    filterPool,
    buildSeries,
    isFlagged,
  };
})(window.FRM);
