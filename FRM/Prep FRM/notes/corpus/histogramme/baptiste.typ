#import "/_corpus-titres.typ": voir

Trace l'histogramme d'une série et marque un quantile (0.05 pour les 5 % les plus bas). Renvoie la valeur du quantile.

```python
from briques.histogramme import plot_histogram

seuil = plot_histogram(pnl, quantile=0.05, title="P&L simulé")
```

Va bien avec #voir("donnees-aleatoires") et #voir("trajectoires-prix").