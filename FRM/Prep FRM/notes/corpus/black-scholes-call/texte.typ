#import "/_corpus-titres.typ": voir
$ c = S_0 N(d_1) - K e^(-r T) N(d_2) $
$ d_1 = (ln(S_0 / K) + (r + sigma^2 / 2) T) / (sigma sqrt(T)), quad d_2 = d_1 - sigma sqrt(T) $

#text(size: 0.85em)[
  $c$: European call price \
  $S_0$: actual underlying price \
  $K$: strike price \
  $T$: time to maturity in years \
  $r$: risk free rate (rfr), continuously compounded, annualized \
  $sigma$: annualized volatility of the underlying's returns \
  $N(x)$: standard normal cumulative distribution function
  ]


#text(size: 0.85em)[
  #voir("option") \
  #voir("risk-free-rate-rfr")
]