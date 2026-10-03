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
