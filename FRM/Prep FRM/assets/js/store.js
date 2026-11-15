/* Stockage de nos données de travail : profil, étapes cochées, notes de confiance,
 * réponses aux questions, marques, historique des séries.
 *
 * Tout tient dans un seul objet, gardé dans le localStorage du navigateur et
 * exportable tel quel en fichier JSON (voir save.js). Format d'une sauvegarde :
 *
 *   {
 *     "app": "prep-frm", "version": 1, "exportedAt": "2026-09-30T14:05:00.000Z",
 *     "profile":    { "firstName": "…", "lastName": "…" } | null,        (facultatif)
 *     "progress":   { "<readingId>": { "<stepId>": true } },
 *     "confidence": { "<readingId>": { "<indice du LO>": 0..4 } },
 *     "attempts":   [ { "q": "315", "reading": 12, "choice": "B", "correct": false,
 *                       "ms": 83000 | null, "at": 1759240000000, "session": "s…" | null } ],
 *     "flags":      { "<questionId>": { "review": true, "unreadable": true } },
 *     "treated":    { "<questionId>": { "at": 1759240000000, "reading": 12 } },   (facultatif)
 *     "sessions":   [ { "id", "mode": "training" | "exam", "label", "startedAt", "finishedAt",
 *                       "total", "answered", "correct", "ms", "timeLimit" } ]
 *   }
 *
 * Le profil n'est qu'un repère (à qui est cette progression) : pas de comptes.
 * La série en cours vit à part (ACTIVE_KEY) : elle n'est pas exportée. */
(function (FRM) {
  "use strict";

  const APP = "prep-frm";
  const VERSION = 1;
  const MAX_SCORE = 4;
  const STORAGE_KEY = "frm-part1.state.v1";
  const ACTIVE_KEY = "frm-part1.session.v1";
  const LEGACY_KEY = "frm-part1.progress.v1"; // première version : progression seule
  const NAME_LENGTH = 40;
  const FLAG_KINDS = ["review", "unreadable"];
  const MODES = ["training", "exam"];

  const emptyState = () => ({
    profile: null,
    progress: {},
    confidence: {},
    attempts: [],
    flags: {},
    treated: {},
    sessions: [],
    lastExport: null,
  });

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) return { ...emptyState(), ...saved };
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      return { ...emptyState(), progress: legacy || {} };
    } catch (e) {
      return emptyState();
    }
  }

  let state = load();
  let revision = 0; // change à chaque écriture : permet aux calculs de se mettre en cache

  function persist() {
    revision += 1;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* stockage indisponible ou plein : les données valent pour la session */
    }
  }

  /** Écrit ou efface state[slice][readingId][key], sans laisser d'entrée vide. */
  function write(slice, readingId, key, value) {
    const entry = state[slice][readingId] || (state[slice][readingId] = {});
    if (value === null || value === false) delete entry[key];
    else entry[key] = value;
    if (!Object.keys(entry).length) delete state[slice][readingId];
    persist();
  }

  // ------------------------------------------------------------------ nettoyage (lecture de fichiers)

  /** { firstName, lastName } nettoyé, ou null si les deux sont vides. */
  function cleanProfile(value) {
    if (!value || typeof value !== "object") return null;
    const field = (v) => (typeof v === "string" ? v.trim().slice(0, NAME_LENGTH) : "");
    const profile = { firstName: field(value.firstName), lastName: field(value.lastName) };
    return profile.firstName || profile.lastName ? profile : null;
  }

  const isCount = (v) => Number.isFinite(v) && v >= 0;

  function cleanAttempt(a) {
    if (!a || typeof a.q !== "string" || !/^\d+$/.test(a.q)) return null;
    if (!Number.isInteger(a.reading) || !"ABCD".includes(a.choice) || a.choice.length !== 1) return null;
    if (typeof a.correct !== "boolean" || !isCount(a.at)) return null;
    return {
      q: a.q,
      reading: a.reading,
      choice: a.choice,
      correct: a.correct,
      ms: isCount(a.ms) ? a.ms : null,
      at: a.at,
      session: typeof a.session === "string" ? a.session : null,
    };
  }

  function cleanSession(s) {
    if (!s || typeof s.id !== "string" || !MODES.includes(s.mode)) return null;
    if (!["startedAt", "finishedAt", "total", "answered", "correct"].every((k) => isCount(s[k]))) return null;
    return {
      id: s.id,
      mode: s.mode,
      label: typeof s.label === "string" ? s.label.slice(0, 200) : "",
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      total: s.total,
      answered: s.answered,
      correct: s.correct,
      ms: isCount(s.ms) ? s.ms : null,
      timeLimit: isCount(s.timeLimit) ? s.timeLimit : null,
    };
  }

  function cleanFlags(flags) {
    const entries = Object.entries(flags && typeof flags === "object" ? flags : {})
      .filter(([id]) => /^\d+$/.test(id))
      .map(([id, f]) => [id, Object.fromEntries(FLAG_KINDS.filter((k) => f && f[k] === true).map((k) => [k, true]))])
      .filter(([, f]) => Object.keys(f).length);
    return Object.fromEntries(entries);
  }

  /** { "<questionId>": { at, reading } } : identifiants numériques, date et reading valides. */
  function cleanTreated(treated) {
    const entries = Object.entries(treated && typeof treated === "object" ? treated : {});
    const valid = ([id, t]) => /^\d+$/.test(id) && t && isCount(t.at) && Number.isInteger(t.reading);
    return Object.fromEntries(entries.filter(valid).map(([id, t]) => [id, { at: t.at, reading: t.reading }]));
  }

  const cleanList = (list, clean) => (Array.isArray(list) ? list.map(clean).filter(Boolean) : []);

  // ------------------------------------------------------------------ API

  const profile = {
    get: () => state.profile,
    set(value) {
      state.profile = cleanProfile(value);
      persist();
    },
    /** « Prénom Nom », ou "" sans profil. */
    displayName: (value = state.profile) => (value ? `${value.firstName} ${value.lastName}`.trim() : ""),
    /** Initials shown in the journals of the notes and entries ("Baptiste Durand" -> "BD"), "" without a profile. */
    initials: (value = state.profile) =>
      value ? [value.firstName, value.lastName].map((part) => part.trim().charAt(0)).join("").toUpperCase() : "",
    /** Slug identifying the person in the journals ("Baptiste" -> "baptiste"), "" without a profile. */
    authorSlug(value = state.profile) {
      const name = value ? value.firstName || value.lastName : "";
      return name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    },
    /** Who writes, sent with every write to the server for the journal of the note or entry
     *  (backend/journal.py): { author, name, initials }, or null without a profile. */
    contributor(value = state.profile) {
      const author = profile.authorSlug(value);
      return author ? { author, name: profile.displayName(value), initials: profile.initials(value) } : null;
    },
  };

  const progress = {
    isDone: (readingId, stepId) => Boolean(state.progress[readingId] && state.progress[readingId][stepId]),
    set: (readingId, stepId, done) => write("progress", readingId, stepId, Boolean(done)),
  };

  const confidence = {
    /** Note 0..4, ou null si le LO n'est pas encore noté. */
    get(readingId, index) {
      const entry = state.confidence[readingId];
      return entry && Number.isInteger(entry[index]) ? entry[index] : null;
    },
    set: (readingId, index, score) => write("confidence", readingId, index, score),
  };

  const attempts = {
    all: () => state.attempts,
    add(list) {
      state.attempts.push(...list);
      persist();
    },
  };

  const flags = {
    KINDS: FLAG_KINDS,
    get: (questionId) => state.flags[questionId] || {},
    toggle(questionId, kind) {
      const current = { ...state.flags[questionId] };
      if (current[kind]) delete current[kind];
      else current[kind] = true;
      if (Object.keys(current).length) state.flags[questionId] = current;
      else delete state.flags[questionId];
      persist();
    },
    all: () => state.flags,
  };

  /** Questions « traitées » : déjà exploitées (fiche, corpus). À part des marques 🚩 et ⚠,
   *  qui signalent un problème : une question traitée n'est pas une question marquée.
   *  Le reading est gardé pour compter par reading sans charger le texte des questions. */
  const treated = {
    has: (questionId) => Boolean(state.treated[questionId]),
    at: (questionId) => (state.treated[questionId] ? state.treated[questionId].at : null),
    toggle(questionId, readingId) {
      if (state.treated[questionId]) delete state.treated[questionId];
      else state.treated[questionId] = { at: Date.now(), reading: Number(readingId) };
      persist();
    },
    all: () => state.treated,
  };

  const sessions = {
    all: () => state.sessions,
    add(session) {
      state.sessions.push(session);
      persist();
    },
  };

  /** Série en cours (reprise après rechargement), hors sauvegarde. */
  const activeSession = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(ACTIVE_KEY));
      } catch (e) {
        return null;
      }
    },
    set(session) {
      try {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
      } catch (e) {
        /* sans stockage, la série ne se reprendra pas après rechargement */
      }
    },
    clear() {
      try {
        localStorage.removeItem(ACTIVE_KEY);
      } catch (e) {
        /* rien à faire */
      }
    },
  };

  // ------------------------------------------------------------------ fichier de sauvegarde

  function snapshot() {
    return {
      app: APP,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      profile: state.profile,
      progress: state.progress,
      confidence: state.confidence,
      attempts: state.attempts,
      flags: state.flags,
      treated: state.treated,
      sessions: state.sessions,
    };
  }

  /** Valide une sauvegarde et ne garde que des valeurs bien formées : un fichier abîmé
   *  ne doit rien corrompre. profile vaut undefined si le fichier n'en contient pas. */
  function parse(data) {
    if (!data || data.app !== APP || data.version !== VERSION) {
      throw new Error("Ce fichier n'est pas une sauvegarde Prep FRM (version 1).");
    }
    const clean = (slice, keep) =>
      Object.fromEntries(
        Object.entries(data[slice] || {})
          .map(([id, entry]) => [id, Object.fromEntries(Object.entries(entry || {}).filter(([, v]) => keep(v)))])
          .filter(([, entry]) => Object.keys(entry).length)
      );
    return {
      profile: "profile" in data ? cleanProfile(data.profile) : undefined,
      progress: clean("progress", (v) => v === true),
      confidence: clean("confidence", (v) => Number.isInteger(v) && v >= 0 && v <= MAX_SCORE),
      attempts: cleanList(data.attempts, cleanAttempt),
      flags: cleanFlags(data.flags),
      treated: cleanTreated(data.treated),
      sessions: cleanList(data.sessions, cleanSession),
    };
  }

  /** Remplace l'état par la sauvegarde. Un fichier sans profil garde le profil actuel. */
  function restore(data) {
    const saved = parse(data);
    state = {
      ...state,
      ...saved,
      profile: saved.profile === undefined ? state.profile : saved.profile,
    };
    activeSession.clear(); // une série en cours n'a plus de sens sur un autre état
    persist();
  }

  /** Sauvegarde vierge : profil, étapes, notes, réponses, marques et séries effacés. */
  function reset() {
    state = emptyState();
    activeSession.clear();
    persist();
  }

  function markExported(date) {
    state.lastExport = date;
    persist();
  }

  FRM.store = {
    MAX_SCORE,
    storageKey: STORAGE_KEY,
    profile,
    progress,
    confidence,
    attempts,
    flags,
    treated,
    sessions,
    activeSession,
    snapshot,
    parse,
    restore,
    reset,
    markExported,
    lastExport: () => state.lastExport,
    revision: () => revision,
    reload() {
      state = load();
      revision += 1;
    },
  };
})(window.FRM);
