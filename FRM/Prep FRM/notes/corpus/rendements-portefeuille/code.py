"""Portfolio returns and volatility."""
import numpy as np


def portfolio_returns(asset_returns: np.ndarray, weights: list[float]) -> np.ndarray:
    """Portfolio return per period: asset_returns has one row per period and one column per asset."""
    asset_returns = np.asarray(asset_returns, dtype=float)
    if asset_returns.shape[-1] != len(weights):
        raise ValueError(f"{asset_returns.shape[-1]} assets but {len(weights)} weights")
    return asset_returns @ np.asarray(weights, dtype=float)


def portfolio_volatility(covariance: np.ndarray, weights: list[float]) -> float:
    """Standard deviation of the portfolio: sqrt(w' Σ w)."""
    w = np.asarray(weights, dtype=float)
    return float(np.sqrt(w @ np.asarray(covariance, dtype=float) @ w))


if __name__ == "__main__":
    from briques.donnees_aleatoires import generate_random_data

    # Two independent assets, 20 % and 10 % volatility, 100 000 periods.
    returns = np.column_stack([
        generate_random_data(100_000, std=0.20, seed=1),
        generate_random_data(100_000, std=0.10, seed=2),
    ])
    weights = [0.5, 0.5]
    measured = portfolio_returns(returns, weights).std()
    covariance = np.diag([0.20**2, 0.10**2])
    print(f"measured volatility {measured:.4f}, formula {portfolio_volatility(covariance, weights):.4f}")
