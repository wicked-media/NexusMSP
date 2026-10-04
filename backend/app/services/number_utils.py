"""Canonical numeric coercion helpers (Stage 1 remainder refactor).

Two router-local ``_number`` implementations were byte-identical across files;
they are preserved here as two named variants because their contracts differ in
subtle, load-bearing ways:

- ``float_or_blank_default`` treats empty strings like None and coerces the
  default with ``float()``.
- ``float_or_default`` passes anything unparseable straight to the default
  without coercing it.

Call sites import under the historical local name:

    from app.services.number_utils import float_or_blank_default as _number
"""

from typing import Any


def float_or_blank_default(value: Any, default: float = 0.0) -> float:
    """Coerce to float; None and "" fall back to the (float-coerced) default."""
    try:
        return float(value if value not in (None, "") else default)
    except (TypeError, ValueError):
        return float(default)


def float_or_default(value: Any, default: float = 0.0):
    """Coerce to float; any failure (including None) returns the default as-is."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def float_or_zero(value: Any) -> float:
    """Coerce to float treating falsy input as 0; failures give 0.0."""
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def float_or_none(value: Any) -> float | None:
    """Coerce to float; None, "" and bools (and anything unparseable) are None."""
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def float_or_default_no_bool(value: Any, default: float = 0.0) -> float:
    """Coerce to float; bools and anything unparseable return the default."""
    if isinstance(value, bool):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def bounded_number(
    value: Any, *, minimum: float = 0, maximum: float = 100
) -> float | None:
    """Return a bounded observed number, never an implicit zero."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric < minimum or numeric > maximum:
        return None
    return round(numeric, 2)
