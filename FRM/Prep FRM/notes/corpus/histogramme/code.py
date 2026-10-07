"""Histogram with an optional quantile marker."""
import matplotlib.pyplot as plt
import numpy as np


def plot_histogram(data: np.ndarray, quantile: float | None = None, title: str = "", bins: int = 50) -> float | None:
    """Histogram of data in a new figure; marks and returns the quantile if one is asked."""
    data = np.asarray(data, dtype=float)
    plt.figure()
    plt.hist(data, bins=bins, color="#2a78d6", alpha=0.85)
    value = None
    if quantile is not None:
        value = float(np.quantile(data, quantile))
        plt.axvline(value, color="#d03b3b", linewidth=2, label=f"quantile {quantile:g}: {value:.4g}")
        plt.legend()
    plt.title(title)
    return value


if __name__ == "__main__":
    from briques.donnees_aleatoires import generate_random_data

    q = plot_histogram(generate_random_data(5_000, seed=3), quantile=0.05, title="5 000 normal draws")
    print(f"5% quantile: {q:.3f} (theory -1.645)")
