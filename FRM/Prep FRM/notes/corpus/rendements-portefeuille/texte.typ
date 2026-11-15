#import "/_corpus-titres.typ": voir

Rendement et volatilité d'un portefeuille de poids $w$ :

$ sigma_p = sqrt(w^T Sigma w) $

```python
from briques.rendements_portefeuille import portfolio_returns, portfolio_volatility

rendements = portfolio_returns(rendements_actifs, [0.6, 0.4])
volatilite = portfolio_volatility(covariance, [0.6, 0.4])
```

La démonstration fabrique des rendements d'actifs avec #voir("donnees-aleatoires") et compare la volatilité mesurée à la formule.