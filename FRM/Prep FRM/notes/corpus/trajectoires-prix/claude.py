"""Price paths following a geometric Brownian motion."""
import numpy as np

from briques.donnees_aleatoires import generate_random_data


def gbm_paths(
    s0: float,
    mu: float,
    sigma: float,
    horizon: float,
    steps: int,
    n_paths: int,
    seed: int | None = None,
) -> np.ndarray:
    """Prices from s0 over `horizon` years in `steps` steps: one row per path, steps + 1 columns.

    mu: annual drift, sigma: annual volatility. seed: an integer gives the same paths every run.
    """
    dt = horizon / steps
    shocks = generate_random_data(n_paths * steps, seed=seed).reshape(n_paths, steps)
    log_steps = (mu - sigma**2 / 2) * dt + sigma * np.sqrt(dt) * shocks
    paths = s0 * np.exp(np.cumsum(log_steps, axis=1))
    return np.hstack([np.full((n_paths, 1), float(s0)), paths])


if __name__ == "__main__":
    import matplotlib.pyplot as plt

    prices = gbm_paths(s0=100, mu=0.05, sigma=0.2, horizon=1, steps=252, n_paths=2000, seed=1)
    print(f"final price: mean {prices[:, -1].mean():.2f} (theory {100 * np.exp(0.05):.2f})")
    plt.plot(prices[:20].T, linewidth=0.8)
    plt.title("20 price paths")
    plt.xlabel("day")
    plt.ylabel("price")
