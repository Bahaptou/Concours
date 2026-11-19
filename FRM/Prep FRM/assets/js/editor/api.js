// Client for the notes and corpus API (see server.py). Successes come as {data, links};
// errors as RFC 9457 problem details, raised here as ApiProblem. Notes and entries are shared;
// who changed what is read from git (backend/history.py), not sent by the site.

export class ApiProblem extends Error {
  constructor(problem) {
    super(problem.detail || problem.title);
    this.problem = problem;
    this.title = problem.title; // stable error code, e.g. ENTRY_CONFLICT
  }
}

export class ServerUnreachable extends Error {}

async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ServerUnreachable("Serveur injoignable : relance « Lancer Prep FRM.bat ».");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiProblem(payload || { title: `HTTP_${response.status}`, detail: response.statusText, status: response.status });
  }
  return payload;
}

// The only URLs built by the client; the others come from the resources' links.
export const noteUrl = (reading) => `/api/notes/${reading}`;
export const CORPUS_URL = "/api/corpus";
export const entryUrl = (id) => `${CORPUS_URL}/${encodeURIComponent(id)}`;
export const textUrl = (id) => `${entryUrl(id)}/texte`;
export const IMAGES_URL = "/api/images";

export const getNote = (reading) => request("GET", noteUrl(reading));
export const save = (link, source) => request(link.method, link.href, { source });

// Corpus. Bodies follow backend/http/payload.py.
export const listCorpus = () => request("GET", CORPUS_URL);
export const getEntry = (id) => request("GET", entryUrl(id));
export const getText = (id) => request("GET", textUrl(id));
/** meta: { id, type, titre }; link: the corpus' "create" link. */
export const createEntry = (link, meta) => request(link.method, link.href, meta);
/** meta: { type, titre } */
export const updateEntry = (link, meta) => request(link.method, link.href, meta);
/** Deletes an entry and removes its references from notes and entries. */
export const deleteEntry = (id) => request("DELETE", entryUrl(id), {});
/** Links an AnalystPrep question to an entry, or removes the link (both idempotent). */
export const questionLinkUrl = (id, question) => `${entryUrl(id)}/questions/${encodeURIComponent(question)}`;
export const linkQuestion = (id, question, reading) => request("PUT", questionLinkUrl(id, question), { reading });
export const unlinkQuestion = (id, question) => request("DELETE", questionLinkUrl(id, question), {});
/** Attaches (`add`) and detaches (`remove`) readings by hand on one or many entries, in one
 *  request. The answer lists the changed entries, in `data.entries`. */
export const changeReadings = (ids, add, remove) => request("POST", `${CORPUS_URL}/readings`, { entries: ids, add, remove });
/** text: { source, code?, hypotheses?, limites?, variables? } (hypotheses, limites: formulas;
 *  variables: financial products, [{ nom, note }]) */
export const saveText = (link, text) => request(link.method, link.href, text);

// Math buttons added from the editors (notes/_outils-maths.json), shared by everyone.
export const MATH_TOOLS_URL = "/api/math-tools";
export const listMathTools = () => request("GET", MATH_TOOLS_URL);
/** tool: { label, latex, select? } */
export const addMathTool = (tool) => request("POST", MATH_TOOLS_URL, tool);
export const deleteMathTool = (id) => request("DELETE", `${MATH_TOOLS_URL}/${encodeURIComponent(id)}`, {});

// Shared images (notes/images/).
export const listImages = () => request("GET", IMAGES_URL);
/** image: { name, format, data } with data in base64 */
export const addImage = (image) => request("POST", IMAGES_URL, image);

/** Last-chance save when the page closes: keepalive lets the request outlive the page. */
export function saveOnExit(link, source) {
  fetch(link.href, {
    method: link.method,
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  }).catch(() => {});
}
