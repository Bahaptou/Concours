// Starting point of a new note: shared template, reading header, sections, and the reading's
// learning objectives as comments (visible in the editor, not in the rendering).

const typstString = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const SECTIONS = ["Intuition", "Formules", "Exemple chiffré", "Pièges", "Lien avec les learning objectives"];

export function noteTemplate(reading, authorName) {
  const objectives = reading.objectives.items.map((item, index) => `// LO ${index + 1} : ${item.text}`);
  const sections = SECTIONS.map((title) => `= ${title}\n`);
  sections[sections.length - 1] += objectives.join("\n") + "\n";
  return [
    '#import "/_gabarit.typ": *',
    '#import "/_corpus.typ": voir, entree',
    "#show: fiche.with(",
    `  reading: ${typstString(reading.tag)},`,
    `  titre: ${typstString(reading.title)},`,
    `  auteur: ${typstString(authorName)},`,
    ")",
    "",
    sections.join("\n"),
  ].join("\n");
}
