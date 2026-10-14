"""Validate the editable account-plan content without trusting stored metadata."""

from math import isfinite
from fastapi import HTTPException

TEXT_FIELDS = ("goals", "risks", "people", "next_actions")


def editable_account_plan(data: dict) -> dict:
    """Return only editable content; IDs, tenant and provenance are server owned."""
    result = {}
    for field in (*TEXT_FIELDS, "opportunities"):
        if field not in data:
            continue
        values = data[field]
        if not isinstance(values, list) or len(values) > 100:
            raise HTTPException(422, f"{field} must contain at most 100 items")
        if field in TEXT_FIELDS:
            if any(not isinstance(value, str) or len(value) > 4000 for value in values):
                raise HTTPException(422, f"{field} items must be text of at most 4000 characters")
            result[field] = values
            continue
        opportunities = []
        for value in values:
            if not isinstance(value, dict) or not isinstance(value.get("title"), str) or len(value["title"]) > 4000:
                raise HTTPException(422, "Every opportunity needs a text title of at most 4000 characters")
            amount = value.get("value")
            if amount is not None and (isinstance(amount, bool) or not isinstance(amount, (int, float)) or not isfinite(amount) or amount < 0):
                raise HTTPException(422, "Opportunity value must be a finite, non-negative number or null")
            opportunities.append({"title": value["title"], "value": amount})
        result[field] = opportunities
    if not result:
        raise HTTPException(422, "Include at least one editable account-plan section")
    return result
