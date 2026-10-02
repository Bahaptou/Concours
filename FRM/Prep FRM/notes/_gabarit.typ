// Shared template for Prep FRM notes. Every note starts with:
//   #import "/_gabarit.typ": *
//   #show: fiche.with(reading: "QA-1", titre: "…", auteur: "…")
// "/" is the notes/ folder (the Typst root set by the server).

#let couleurs = (
  encre: rgb("#1a2744"),
  doux: rgb("#4a5573"),
  accent: rgb("#e8734a"),
  bleu: rgb("#2a78d6"),
  vert: rgb("#3f7a5c"),
  orange: rgb("#c98a1a"),
)

#let fiche(reading: "", titre: "", auteur: "", body) = {
  set document(title: titre)
  set page(width: 17cm, height: auto, margin: (x: 1.3cm, y: 1.1cm), fill: white)
  set text(lang: "fr", size: 10.5pt, fill: couleurs.encre)
  set par(justify: true, leading: 0.62em)
  set list(indent: 0.6em)
  set enum(indent: 0.6em)
  show heading.where(level: 1): it => block(above: 1.3em, below: 0.65em, width: 100%)[
    #text(size: 12.5pt, weight: "bold")[#it.body]
    #v(-0.45em)
    #line(length: 100%, stroke: 0.6pt + couleurs.accent.lighten(40%))
  ]
  show heading.where(level: 2): it => block(above: 1em, below: 0.5em)[#text(size: 11pt, weight: "bold", fill: couleurs.doux)[#it.body]]
  show math.equation.where(block: true): set block(above: 0.9em, below: 0.9em)

  block(width: 100%, below: 1em)[
    #text(size: 8.5pt, weight: "bold", fill: couleurs.accent, tracking: 0.08em)[#upper(reading)]
    #h(1fr)
    #text(size: 8.5pt, fill: couleurs.doux)[#auteur]
    #v(0.1em)
    #text(size: 17pt, weight: "bold")[#titre]
    #v(-0.3em)
    #line(length: 100%, stroke: 1.2pt + couleurs.accent)
  ]
  body
}

#let encadre(titre, couleur, body) = block(
  width: 100%,
  inset: (x: 10pt, y: 8pt),
  radius: 3pt,
  fill: couleur.lighten(90%),
  stroke: (left: 3pt + couleur),
  above: 0.9em,
  below: 0.9em,
)[
  #text(size: 8pt, weight: "bold", fill: couleur, tracking: 0.06em)[#upper(titre)]
  #v(0.15em)
  #body
]

// Callouts used by the editor's toolbar.
#let retenir(body) = encadre("À retenir", couleurs.vert, body)
#let piege(body) = encadre("Piège", couleurs.orange, body)
#let definition(terme, body) = encadre(terme, couleurs.bleu, body)

// ---------------------------------------------------------------- corpus entries
// Each type has its name and colour; used by entry boxes and by #voir references.
// Categorical palette validated with the dataviz skill's script (light surface); same order and
// colours as --etype-* in assets/css/style.css.
#let types-entree = (
  formule: (nom: "Formule", couleur: rgb("#2a78d6")),
  definition: (nom: "Définition", couleur: rgb("#eb6834")),
  propriete: (nom: "Propriété", couleur: rgb("#199e70")),
  theoreme: (nom: "Théorème", couleur: rgb("#4a3aa7")),
  simulation: (nom: "Simulation", couleur: rgb("#d55181")),
  brique: (nom: "Brique de code", couleur: rgb("#c98500")),
)

// Small block under the text of an entry (formulas: assumptions and limits). White card, border in
// the entry's colour; the dash style (not the colour) tells the two apart.
#let section-entree(titre, couleur, trait, body) = block(
  width: 100%,
  inset: (x: 8pt, y: 6pt),
  radius: 2pt,
  fill: white,
  stroke: (paint: couleur.lighten(45%), thickness: 0.8pt, dash: trait),
  above: 0.7em,
  below: 0pt,
)[
  #text(size: 7.5pt, weight: "bold", fill: couleurs.doux, tracking: 0.06em)[#upper(titre)]
  #v(0.15em)
  #text(size: 0.92em)[#body]
]

// Box of one version of an entry: type and title, author's initials as a badge.
// hypotheses / limites: optional content, shown as blocks under the body.
#let bloc-entree(type, titre, initiales, body, hypotheses: none, limites: none) = {
  let style = types-entree.at(type)
  block(
    width: 100%,
    inset: (x: 10pt, y: 8pt),
    radius: 3pt,
    fill: style.couleur.lighten(92%),
    stroke: (left: 3pt + style.couleur),
    above: 0.9em,
    below: 0.9em,
  )[
    #text(size: 8pt, weight: "bold", fill: style.couleur, tracking: 0.06em)[#upper(style.nom)]
    #h(0.4em)
    #text(weight: "bold")[#titre]
    #h(1fr)
    #box(fill: style.couleur, inset: (x: 4pt, y: 2pt), radius: 2pt)[#text(size: 7.5pt, weight: "bold", fill: white)[#initiales]]
    #v(0.2em)
    #body
    #if hypotheses != none { section-entree("Hypothèses", style.couleur, "solid", hypotheses) }
    #if limites != none { section-entree("Limites", style.couleur, "dashed", limites) }
  ]
}

// Page used to render one entry on its own (corpus page).
#let page-entree(body) = {
  set page(width: 15cm, height: auto, margin: 6pt, fill: white)
  set text(lang: "fr", size: 10.5pt, fill: couleurs.encre)
  set par(justify: true, leading: 0.62em)
  body
}
