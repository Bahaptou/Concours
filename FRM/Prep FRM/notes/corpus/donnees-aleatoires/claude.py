"""Random draws: the base brick, the other bricks take their randomness here."""
import numpy as np


def generate_random_data(
    n: int,
    distribution: str = "normal",
    mean: float = 0.0,
    std: float = 1.0,
    df: int = 5,
    seed: int | None = None,
) -> np.ndarray:
    """n random draws with the given mean and standard deviation.

    distribution: "normal", or "student" (df degrees of freedom, more than 2) for fatter tails.
    seed: an integer gives the same draws on every run.
    """
    rng = np.random.default_rng(seed)
    if distribution == "normal":
        return rng.normal(mean, std, size=n)
    if distribution == "student":
        if df <= 2:
            raise ValueError("df must be greater than 2 for a finite standard deviation")
        draws = rng.standard_t(df, size=n)
        return mean + std * draws / np.sqrt(df / (df - 2))  # rescaled to the requested std
    raise ValueError(f"unknown distribution: {distribution!r} (normal or student)")


if __name__ == "__main__":
    normal = generate_random_data(10_000, seed=42)
    student = generate_random_data(10_000, distribution="student", df=4, seed=42)
    print(f"normal  : mean {normal.mean():.3f}, std {normal.std():.3f}, worst {normal.min():.2f}")
    print(f"student : mean {student.mean():.3f}, std {student.std():.3f}, worst {student.min():.2f}")
