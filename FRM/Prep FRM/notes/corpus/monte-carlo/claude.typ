#import "/_corpus-titres.typ": voir

Estime une espérance à partir de valeurs simulées : leur moyenne, avec son erreur-type $s / sqrt(n)$. Les valeurs viennent de #voir("donnees-aleatoires"), transformées comme on veut.

```python
from briques.donnees_aleatoires import generate_random_data
from briques.monte_carlo import monte_carlo

z = generate_random_data(100_000)
print(monte_carlo(z ** 2))      # environ 1 (E[Z²] = 1)
```

L'erreur-type diminue comme $1 / sqrt(n)$ : quatre fois plus de tirages pour la diviser par deux.