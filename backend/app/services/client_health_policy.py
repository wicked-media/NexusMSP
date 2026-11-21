"""One evidence policy for every per-client health score.

A missing source means "not observed", never "healthy".  Nexus only states an
overall client health score once at least two independent dimensions have real
evidence, so a freshly created account cannot inherit a flattering default.
"""

from typing import Any, Mapping

MIN_EVIDENCE_DIMENSIONS = 2

# The single platform scale. Frontend bands, the radar, the client directory
# and the canonical health scorer must all read these floors from this tuple.
HEALTH_BANDS = (
    ("thriving", 85),
    ("healthy", 70),
    ("needs_attention", 50),
    ("at_risk", 30),
    ("critical", 0),
)


def health_status(score: Any) -> str:
    """Return the platform band key for a score, or ``not_assessed``."""
    if score is None:
        return "not_assessed"
    numeric = normalise_score(score)
    if numeric is None:
        return "not_assessed"
    for key, floor in HEALTH_BANDS:
        if numeric >= floor:
            return key
    return "critical"


def normalise_score(value: Any) -> float | None:
    """Return a 0-100 score, or ``None`` when the source is absent/unusable."""
    if value is None or isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:  # NaN
        return None
    return max(0.0, min(100.0, numeric))


def composite_health(
    dimensions: Mapping[str, tuple[Any, float]],
) -> tuple[int | None, dict[str, tuple[float, float]], int]:
    """Combine dimension scores, refusing to score too little evidence.

    ``dimensions`` maps a dimension name to ``(score_0_100_or_None, weight)``.
    Returns ``(composite_or_None, assessed_dimensions, coverage_pct)``.
    """
    assessed: dict[str, tuple[float, float]] = {}
    for key, (score, weight) in dimensions.items():
        normalised = normalise_score(score)
        if normalised is not None:
            assessed[key] = (normalised, float(weight))

    coverage_pct = round(len(assessed) / max(len(dimensions), 1) * 100)
    if len(assessed) < MIN_EVIDENCE_DIMENSIONS:
        return None, assessed, coverage_pct

    total_weight = sum(weight for _, weight in assessed.values())
    if total_weight <= 0:
        return None, assessed, coverage_pct

    composite = round(sum(score * weight for score, weight in assessed.values()) / total_weight)
    return composite, assessed, coverage_pct
