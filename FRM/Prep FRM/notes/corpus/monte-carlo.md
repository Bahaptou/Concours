---
type: brique
titre: Estimation Monte-Carlo
---
Estime une espérance à partir de valeurs simulées : leur moyenne, avec son erreur-type $\frac{s}{\sqrt{n}}$. Les valeurs viennent de [[donnees-aleatoires]], transformées comme on veut.

```python
from briques.donnees_aleatoires import generate_random_data
from briques.monte_carlo import monte_carlo

z = generate_random_data(100_000)
print(monte_carlo(z ** 2))      # environ 1 (E[Z²] = 1)
```

L'erreur-type diminue comme $\frac{1}{\sqrt{n}}$ : quatre fois plus de tirages pour la diviser par deux.

## Code

```python
"""Monte Carlo estimate of an expectation from simulated values."""
from dataclasses import dataclass

import numpy as np


@dataclass
class MonteCarloResult:
    estimate: float  # mean of the simulated values
    std_error: float  # standard error of that mean: s / sqrt(n)
    n: int  # number of values

    def __str__(self) -> str:
        return f"{self.estimate:.4f} ± {self.std_error:.4f} (n = {self.n:,})".replace(",", " ")


def monte_carlo(values: np.ndarray) -> MonteCarloResult:
    """Estimate of the expectation of the simulated values: their mean and its standard error."""
    values = np.asarray(values, dtype=float)
    n = values.size
    return MonteCarloResult(float(values.mean()), float(values.std(ddof=1) / np.sqrt(n)), n)


if __name__ == "__main__":
    from briques.donnees_aleatoires import generate_random_data

    for n in (1_000, 10_000, 100_000):
        z = generate_random_data(n, seed=0)
        print(f"E[Z^2] with n = {n:>7}: {monte_carlo(z ** 2)}  (exact 1)")
```
