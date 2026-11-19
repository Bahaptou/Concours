// Starting point of a new note (Markdown, shared with Obsidian): a YAML header with the reading,
// the sections, and the reading's learning objectives as comments (%% … %%: visible in the
// editor and in Obsidian's source view, hidden in the rendering).

/** A YAML string, quoted only when it has to be. */
const yamlString = (text) => (/^[\w À-ÿ()',.-]+$/.test(text) && !/^[\d-]/.test(text) && !text.includes(": ") ? text : JSON.stringify(text));

export const SECTIONS = ["Intuition", "Formules", "Exemple chiffré", "Pièges", "Lien avec les learning objectives"];

export function noteTemplate(reading) {
  const objectives = reading.objectives.items.map((item, index) => `%% LO ${index + 1} : ${item.text} %%`);
  const sections = SECTIONS.map((title) => `## ${title}\n`);
  sections[sections.length - 1] += objectives.join("\n") + "\n";
  return ["---", `reading: ${reading.id}`, `titre: ${yamlString(reading.title)}`, "---", "", sections.join("\n")].join("\n");
}
