// Client for the notes and corpus API (see server.py). Successes come as {data, links};
// errors as RFC 9457 problem details, raised here as ApiProblem.

export class ApiProblem extends Error {
  constructor(problem) {
    super(problem.detail || problem.title);
    this.problem = problem;
    this.title = problem.title; // stable error code, e.g. TYPST_COMPILE_ERROR
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
export const noteUrl = (reading, author) => `/api/notes/${reading}/${author}`;
export const CORPUS_URL = "/api/corpus";
export const entryUrl = (id) => `${CORPUS_URL}/${encodeURIComponent(id)}`;
export const versionUrl = (id, author) => `${entryUrl(id)}/${author}`;
export const IMAGES_URL = "/api/images";

export const getNote = (reading, author) => request("GET", noteUrl(reading, author));
export const compile = (link, source) => request(link.method, link.href, { source });
export const save = (link, source) => request(link.method, link.href, { source });

// Corpus. Bodies follow backend/http/payload.py.
export const listCorpus = () => request("GET", CORPUS_URL);
export const getEntry = (id) => request("GET", entryUrl(id));
export const getVersion = (id, author) => request("GET", versionUrl(id, author));
/** meta: { id, type, titre, readings }; link: the corpus' "create" link. */
export const createEntry = (link, meta) => request(link.method, link.href, meta);
/** meta: { type, titre, readings } */
export const updateEntry = (link, meta) => request(link.method, link.href, meta);
/** Deletes an entry and removes its references from notes and entries. The server wants JSON
 *  for every write, hence the empty body. */
export const deleteEntry = (id) => request("DELETE", entryUrl(id), {});
/** Links an AnalystPrep question to an entry, or removes the link (both idempotent). */
export const questionLinkUrl = (id, question) => `${entryUrl(id)}/questions/${encodeURIComponent(question)}`;
export const linkQuestion = (id, question, reading) => request("PUT", questionLinkUrl(id, question), { reading });
export const unlinkQuestion = (id, question) => request("DELETE", questionLinkUrl(id, question), {});
/** version: { source, name, initials, code?, hypotheses?, limites? } (the last two: formulas only) */
export const saveVersion = (link, version) => request(link.method, link.href, version);
/** draft: { type, titre, initials, source, hypotheses?, limites? } */
export const previewEntry = (link, draft) => request(link.method, link.href, draft);

// Math buttons added from the editors (notes/_outils-maths.json), shared by everyone.
export const MATH_TOOLS_URL = "/api/math-tools";
export const listMathTools = () => request("GET", MATH_TOOLS_URL);
/** tool: { label, typst, select? } */
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
