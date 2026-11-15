#import "/_corpus-titres.typ": voir

Des trajectoires de prix selon un mouvement brownien géométrique, avec les chocs de #voir("donnees-aleatoires") :

$ S_(t + Delta t) = S_t exp((mu - sigma^2 / 2) Delta t + sigma sqrt(Delta t) Z) $

```python
from briques.trajectoires_prix import gbm_paths

prix = gbm_paths(s0=100, mu=0.05, sigma=0.2, horizon=1, steps=252, n_paths=1000)
prix_finaux = prix[:, -1]       # prix dans un an
```

Une ligne par trajectoire, `steps + 1` colonnes ; la première vaut `s0`.