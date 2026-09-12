import math

from wassily.maths.stats import (
    beta_cdf,
    beta_inv,
    clamp,
    gaussian,
    hex_string,
    mean,
    median,
    normal_cdf,
    normal_inv,
    percentile_sorted,
    pick,
    rng_from_seed,
    std,
)


def test_mean_and_population_std():
    assert mean([1, 2, 3, 4]) == 2.5
    assert mean([]) == 0
    assert std([2, 4, 4, 4, 5, 5, 7, 9]) == 2.0
    assert std([]) == 0


def test_percentile_matches_numpy_linear():
    xs = [1, 2, 3, 4]
    assert percentile_sorted(xs, 0) == 1
    assert percentile_sorted(xs, 50) == 2.5
    assert percentile_sorted(xs, 100) == 4
    assert math.isclose(percentile_sorted(xs, 2.5), 1.075)
    assert math.isnan(percentile_sorted([], 50))


def test_median_is_the_upper_middle():
    assert median([4, 1, 3, 2]) == 3
    assert median([5]) == 5
    assert median([]) == 0


def test_clamp():
    assert clamp(2, 0, 1) == 1
    assert clamp(-1, 0, 1) == 0
    assert clamp(0.4, 0, 1) == 0.4


def test_normal_inverse_round_trips():
    for p in (0.001, 0.01, 0.05, 0.3, 0.5, 0.8, 0.975, 0.999):
        assert abs(normal_cdf(normal_inv(p)) - p) < 1e-6
    assert abs(normal_inv(0.95) - 1.6448536) < 1e-6
    assert normal_inv(0) == -math.inf
    assert normal_inv(1) == math.inf


def test_beta_distribution():
    assert math.isclose(beta_cdf(0.3, 1, 1), 0.3, rel_tol=1e-9)
    assert math.isclose(beta_cdf(0.5, 2, 2), 0.5, rel_tol=1e-9)
    assert abs(beta_inv(0.5, 3, 3) - 0.5) < 1e-9
    assert abs(beta_inv(beta_cdf(0.37, 4.5, 2.2), 4.5, 2.2) - 0.37) < 1e-9
    assert beta_cdf(0, 2, 3) == 0 and beta_cdf(1, 2, 3) == 1


def test_seeded_rng_is_deterministic_and_uniform():
    a, b = rng_from_seed(7), rng_from_seed(7)
    xs = [a() for _ in range(5000)]
    assert xs == [b() for _ in range(5000)]
    assert all(0 <= x < 1 for x in xs)
    assert abs(mean(xs) - 0.5) < 0.02
    assert rng_from_seed(8)() != xs[0]


def test_gaussian_moments():
    rng = rng_from_seed(1)
    zs = [gaussian(rng) for _ in range(20_000)]
    assert abs(mean(zs)) < 0.03
    assert abs(std(zs) - 1) < 0.03


def test_pick_and_hex_string():
    rng = rng_from_seed(3)
    assert pick(rng, ["only"]) == "only"
    h = hex_string(rng, 40)
    assert len(h) == 40 and all(c in "0123456789abcdef" for c in h)
