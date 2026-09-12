"""The six survival agents and the vocabulary each one writes ideas in.

Mirrors ``src/config/personas.ts``. Only what the backend needs is kept here:
identity, default bound and the idea vocabulary. Copy for the pages stays in
the site config.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class IdeaVocabulary:
    names: tuple[str, ...]
    suffixes: tuple[str, ...]
    lores: tuple[str, ...]


@dataclass(frozen=True)
class Persona:
    id: str
    mascot: str
    ticker: str
    mathematician: str
    life: str
    default_bound: str
    unit: str  # what drops into the jar
    ideas: IdeaVocabulary


# Suffixes that trip the content filter on purpose, so every cycle shows real rejections.
FILTER_BAIT = (" Guaranteed", " 100x")


def _suffixes(*extra: str) -> tuple[str, ...]:
    return ("", "", "", "", *extra, *FILTER_BAIT)


PERSONAS: tuple[Persona, ...] = (
    Persona(
        id="hoeffding",
        mascot="Wassily",
        ticker="$WASSILY",
        mathematician="Wassily Hoeffding",
        life="1914-1991",
        default_bound="hoeffding",
        unit="a coin",
        ideas=IdeaVocabulary(
            names=(
                "Bounded Sum", "Chapel Hill", "Tail Mass", "Coin Ledger", "Quiet Average", "U-Statistic",
                "Margin Keeper", "Slow Convergence", "Honest Mean", "Exponent Two", "Tarheel Tally", "Unknown Bias",
                "Fair Draw", "Sample Mean", "Pairwise", "Kernel", "Symmetric Mean", "Tail Guard", "Clean Bound",
                "Tossup", "Heads Ledger", "Even Odds", "Long Run", "Small Epsilon", "Delta Five", "Steady Hand",
                "Soft Tail", "Concentration",
            ),
            suffixes=_suffixes(" Protocol", " Index", " Fund", " Ledger"),
            lores=(
                "An average that is not allowed to wander.",
                "Every coin is counted, including the ones that landed wrong.",
                "The tail gets thinner the longer you wait.",
                "Bounded on both sides, patient in the middle.",
                "No claims, only concentration.",
                "Pairs compared, one at a time, until the number stops moving.",
                "A slow mint for people who read the footnotes.",
                "Built on inequality, spent on honesty.",
                "The bound was here before the chart.",
                "Two thousand flips and still not sure. That is the point.",
            ),
        ),
    ),
    Persona(
        id="kolmogorov",
        mascot="Andrey",
        ticker="$ANDREY",
        mathematician="Andrey Kolmogorov",
        life="1903-1987",
        default_bound="dkw",
        unit="a tally mark",
        ideas=IdeaVocabulary(
            names=(
                "Empirical Curve", "Supremum", "Sigma Algebra", "Tambov Ledger", "Axiom Six", "Measure Zero",
                "Glivenko", "Band Width", "Step Function", "Complexity", "Short Program", "Random String",
                "Martingale", "Zero-One", "Tail Event", "Strong Law", "Cantelli Clause", "Filtration",
                "Stopping Time", "Borel Set", "Uniform Band", "Sample Path", "Quiet Limit", "Converge",
                "Almost Everywhere", "Two-Sample",
            ),
            suffixes=_suffixes(" Protocol", " Index", " Archive", " Ledger"),
            lores=(
                "The curve is drawn from data, never from hope.",
                "Shortest honest description wins.",
                "Every step in the function is a token that really launched.",
                "Inside the band or not at all.",
                "Axioms first, narrative later.",
                "Two curves, one gap, no shortcuts.",
                "A record of what happened, measured against what could have.",
                "Converges slowly. Converges anyway.",
                "Nothing here is random that was not counted.",
                "Small sample, wide band. Wait.",
            ),
        ),
    ),
    Persona(
        id="bayes",
        mascot="Thomas",
        ticker="$THOMAS",
        mathematician="Thomas Bayes",
        life="c. 1701-1761",
        default_bound="bayes",
        unit="a ball",
        ideas=IdeaVocabulary(
            names=(
                "Inverse Chance", "Tunbridge", "Prior Belief", "Posterior", "Rolled Ball", "Price Essay",
                "Uniform Prior", "Succession", "Likelihood", "Credible Edge", "Evidence", "Update Rule", "Conjugate",
                "Beta Ledger", "Odds Ratio", "Marginal", "Belief Jar", "Quiet Prior", "Second Roll", "Unseen Line",
                "Minister", "Laplace Rule", "Slow Update", "Plausible", "Normalizer",
            ),
            suffixes=_suffixes(" Protocol", " Index", " Society", " Ledger"),
            lores=(
                "Every landing moves the line a little.",
                "Starts uncertain on purpose.",
                "The prior is written down so you can argue with it.",
                "Belief measured, never announced.",
                "One more roll before deciding.",
                "The posterior is published whole.",
                "Evidence in, opinion out, receipts kept.",
                "A careful guess that knows it is a guess.",
                "Updated hourly. Humbled daily.",
                "The unseen line is still unseen.",
            ),
        ),
    ),
    Persona(
        id="chebyshev",
        mascot="Pafnuty",
        ticker="$PAFNUTY",
        mathematician="Pafnuty Chebyshev",
        life="1821-1894",
        default_bound="cantelli",
        unit="a gear",
        ideas=IdeaVocabulary(
            names=(
                "Finite Variance", "Linkage", "Walking Machine", "Okatovo", "Tail Mass", "Moment Two", "Arithmometer",
                "Polynomial", "Nodes", "Minimax", "Straight Line", "Petersburg School", "Mean Value", "Loose Bound",
                "Cantelli Edge", "One Sided", "Distribution Free", "Gear Train", "Plain Promise", "Standard Error",
                "k Sigma", "Heavy Tail", "No Assumption", "Crank Rod",
            ),
            suffixes=_suffixes(" Protocol", " Works", " Fund", " Ledger"),
            lores=(
                "Assumes nothing and still promises something.",
                "Built for tails, not bells.",
                "A linkage that turns noise into a straight line.",
                "The bound is loose because the world is.",
                "Variance is finite. That is all we asked.",
                "Every gear accounted for.",
                "Pessimism, formalized.",
                "Walks slowly, never falls.",
                "k standard deviations from a story.",
                "No shape was harmed in this estimate.",
            ),
        ),
    ),
    Persona(
        id="bernstein",
        mascot="Sergei",
        ticker="$SERGEI",
        mathematician="Sergei Bernstein",
        life="1880-1968",
        default_bound="bernstein",
        unit="a bead",
        ideas=IdeaVocabulary(
            names=(
                "Bead Thread", "Odessa", "Polynomial Basis", "Weierstrass", "Low Variance", "Kharkiv Notes",
                "Smooth Curve", "Bernstein Basis", "Variance Aware", "Quiet Bead", "Tight Tail", "Approximant",
                "Control Point", "Moment Bound", "Soft Edge", "Blend", "String Theory", "Degree n", "Convex Hull",
                "Gentle Slope", "Even Beads", "Second Moment", "Small Sigma", "Knit",
            ),
            suffixes=_suffixes(" Protocol", " Index", " Guild", " Ledger"),
            lores=(
                "Low variance earns a tighter promise.",
                "One bead per outcome, strung in order.",
                "A curve approximated honestly.",
                "The quiet ones still count.",
                "Smoothness is measured, not declared.",
                "Every control point sits where the data put it.",
                "Variance first, confidence second.",
                "Threaded slowly so nothing slips.",
                "Close enough is a number here.",
                "A blend of many small truths.",
            ),
        ),
    ),
    Persona(
        id="wilcoxon",
        mascot="Frank",
        ticker="$FRANK",
        mathematician="Frank Wilcoxon",
        life="1892-1965",
        default_bound="wilcoxon",
        unit="a rank card",
        ideas=IdeaVocabulary(
            names=(
                "Rank Sum", "Signed Rank", "Mann Whitney", "Order Only", "Tie Breaker", "Pair Count", "Lab Notebook",
                "Cyanamid", "Rank Card", "Median Shift", "No Prices", "Sorted", "Nonparametric", "Placement",
                "Halfway Tie", "Row Order", "Quiet Rank", "U Statistic", "Top Half", "Ordinal", "Rank Ledger",
                "Cork Notes", "Tally Sheet", "Bench Test",
            ),
            suffixes=_suffixes(" Protocol", " Index", " Lab", " Ledger"),
            lores=(
                "Values discarded, order kept.",
                "Counts wins between pairs, nothing else.",
                "A lab notebook for a noisy market.",
                "Ties split evenly, as they should be.",
                "The rank is the receipt.",
                "Sorted before it was sold.",
                "No price ever touched this model.",
                "Survivors ranked against the stalled, every hour.",
                "Half a point for a tie, zero for a story.",
                "Order is harder to fake than price.",
            ),
        ),
    ),
)

PERSONA_BY_ID: dict[str, Persona] = {p.id: p for p in PERSONAS}


def is_persona_id(value: object) -> bool:
    return isinstance(value, str) and value in PERSONA_BY_ID
