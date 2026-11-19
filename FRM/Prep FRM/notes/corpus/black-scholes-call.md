---
type: formule
titre: 'Black-Scholes : call européen'
---
$$c = S_0\,N(d_1) - K e^{-rT}\,N(d_2)$$
$$d_1 = \frac{\ln(S_0/K) + \left(r + \frac{\sigma^2}{2}\right)T}{\sigma\sqrt{T}}, \quad d_2 = d_1 - \sigma\sqrt{T}$$

  $c$: European call price
  $S_0$: actual underlying price
  $K$: strike price
  $T$: time to maturity in years
  $r$: risk free rate (rfr), continuously compounded, annualized
  $\sigma$: annualized volatility of the underlying's returns
  $N(x)$: standard normal cumulative distribution function

  [[option]]
  [[risk-free-rate-rfr]]

## Hypothèses

- option européenne : exercice à maturité uniquement
  - sous-jacent sans dividende pendant la vie de l'option
  - prix lognormal (mouvement brownien géométrique), $\sigma$ constante
  - $r$ constant, le même pour toutes les maturités
  - marché sans friction : ni coûts ni taxes, vente à découvert possible, négociation continue
  - aucune opportunité d'arbitrage

## Limites

- $\sigma$ n'est pas constante : la volatilité implicite varie selon le strike et la maturité (smile / skew)
  - les mouvements extrêmes sont plus fréquents que ne le dit la loi normale (queues épaisses, sauts)
  - ne valorise pas l'exercice anticipé, ce qui compte pour un put américain ou un call américain sur actif à dividendes
  - dividendes à intégrer par l'extension de Merton
  - $\sigma$ n'est pas observable : estimée sur l'historique ou déduite d'un prix de marché, donc risque de modèle
  - couverture continue et sans coût irréaliste en pratique
