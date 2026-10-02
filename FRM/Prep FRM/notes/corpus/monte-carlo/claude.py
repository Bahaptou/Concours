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
