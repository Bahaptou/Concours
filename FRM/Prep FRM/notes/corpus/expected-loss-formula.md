---
type: formule
titre: Expected Loss
readings: [1]
---
$E_{l} = \text{PD} \times \text{LGD} \times \text{EAD}$ 

PD : [[probability-of-default]]
LGD : [[loss-given-default]]
EAD : [[exposure-at-default]]

## Hypothèses

[[expected-loss]] se base sur l'idée qu'au global d'un portefeuille, en cumulant les pertes attendues de chaque titre soumis à une probabilté de défaut, on obtient en moyenne ce que ce portefeuille va perdre avec quelques événements de défaut.

## Limites

Dans les faits l'EL correspond à la précision du calcul de la PD.  Une subtilité supplémentaire avec la PD dans le cadre du calcul de l'Expected Loss est son caractère dit [[point-in-time]].

La LGD utilisée est généralement celle correspondantes aux indications des autorités de régulation.

L'EAD est simplement le montant de l'exposition (du prêt/crédit), rien de débatable sur ce point.
