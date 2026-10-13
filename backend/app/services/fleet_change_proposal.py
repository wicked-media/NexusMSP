"""Turning a recurring deviation shape into proposed work — never into a repair.

The Windows and Endpoint Performance studios explain an estate; this module is
the boundary where an explanation becomes *proposed work*. It executes nothing.
It derives, from the same recurrence projection those studios read, the change
request a shape would raise, and hands it to the change-management owner
(``change_requests``), which already carries the approval, verification and
rollback lifecycle Nexus has. So a deviation keeps one owner — the projection —
and a change record keeps one owner — Change Management. This module owns
neither, and adds no collection.

Three refusals are the point of the module, and each is disclosed with its reason
rather than smoothed over:

* a shape the recurrence projection does not report cannot become work, because a
  proposal may only cite evidence the studios can already show;
* a cohort without an established baseline produces no shapes, so it produces no
  proposals either — a proposal from a cohort too small to define a baseline
  would be work raised from a number that means nothing;
* a shape that already has an open change is not proposed twice, so one symptom
  keeps one piece of work.

Nothing here measures, repairs or rolls back an endpoint. A derived proposal says
what would prove the repair (re-measuring the same metric against the same
cohort) and what would undo it (nothing, because Nexus has executed nothing), and
it carries the shape's own basis verbatim so the request can be checked against
the deviation view it came from.
"""

from __future__ import annotations

from typing import Any, Iterable

from app.services.fleet_baseline import NOTABLE_DEVIATION_RATIO, STRONG_DEVIATION_RATIO

# The identity a shape is written with, so a proposal is traceable to the exact
# deviation evidence that produced it rather than to a metric name alone.
SOURCE_KIND = "fleet_baseline_shape"

# A change request is not a second owner of the shape: it cites it.
EVIDENCE_SOURCE = "app.services.fleet_baseline.recurrence"

# A shape is only proposable while the recurrence projection still reports it in
# the strong/notable vocabulary the deviation view grades with.
PROPOSABLE_VERDICTS = ("strong", "notable")

# A proposed change is "open" until Change Management closes it, so these are the
# statuses that make a second proposal for the same shape a duplicate.
OPEN_CHANGE_STATUSES = ("pending_review", "approved", "implementing")

BOUNDARY = (
    "A proposal is a request for work, not work: Nexus has executed nothing on any "
    "endpoint, and the change request is the only record this read created. Approval, "
    "implementation and rollback all happen through Change Management, where the "
    "technician who raised a change cannot also approve it."
)


def _cohort_label(report: dict) -> str:
    cohort = report.get("cohort") or {}
    return str(cohort.get("label") or cohort.get("platform") or "the cohort")


def _threshold(shape: dict) -> str:
    """The percentage the shape's own verdict was measured against.

    Read from the projection rather than restated, so a proposal cannot quote a
    threshold the deviation view no longer grades with.
    """
    ratios = {"strong": STRONG_DEVIATION_RATIO, "notable": NOTABLE_DEVIATION_RATIO}
    ratio = ratios.get(str(shape.get("verdict")), NOTABLE_DEVIATION_RATIO)
    return f"{int(ratio * 100)}%"


def shape_by_id(report: dict, shape_id: str) -> dict | None:
    """The shape the recurrence projection reports, or ``None``.

    The lookup is against the projection's own output, so a caller cannot propose
    work from a shape, a device list or a number the deviation view does not
    already return.
    """
    wanted = str(shape_id or "").strip()
    if not wanted:
        return None
    for shape in report.get("shapes") or []:
        if str(shape.get("id")) == wanted:
            return shape
    return None


def risk_level(shape: dict) -> str:
    """A strong deviation is a higher-risk request than a notable one."""
    return "high" if shape.get("verdict") == "strong" else "medium"


def devices_affected(shape: dict) -> list[str]:
    return [str(value) for value in (shape.get("device_ids") or []) if str(value)]


def change_payload(report: dict, shape: dict) -> dict:
    """The change request a shape raises — derived, never invented.

    Every sentence is computed from the shape the recurrence view returns, so the
    request and the studio cannot tell different stories. It is ``normal`` rather
    than ``standard`` because nobody has approved a procedure for it yet, which is
    why Change Management will require an impact assessment and a rollback plan
    before it can be approved.
    """
    count = int(shape.get("device_count") or 0)
    direction = str(shape.get("direction") or "")
    label = str(shape.get("label") or shape.get("metric") or "the metric")
    label_lower = label.lower()
    unit = str(shape.get("unit") or "")
    median = shape.get("cohort_median")
    median_text = "not available" if median is None else f"{median}{unit}"
    basis = str(shape.get("basis") or "")
    threshold = _threshold(shape)

    return {
        "title": (
            f"{label_lower.capitalize()} is {direction} the {_cohort_label(report)} "
            f"cohort median on {count} endpoints"
        ),
        "description": (
            f"{count} endpoints in the {_cohort_label(report)} cohort "
            f"{'share' if count != 1 else 'shows'} a {shape.get('verdict')} deviation "
            f"in {label_lower}. {basis} The cohort median is {median_text}. Nexus has "
            "not changed anything: this is a request to investigate and repair the "
            "shared cause."
        ),
        "category": "normal",
        "risk_level": risk_level(shape),
        "impact": (
            f"{count} managed endpoints carry this shape. The expectation to measure is "
            f"that they stop sitting more than {threshold} {direction} the cohort "
            f"median for {label_lower}; it is not yet known whether the cause is "
            "shared, so the impact is stated as the endpoints affected and the "
            "measurement that would confirm a repair rather than as a stated outcome."
        ),
        "rollback_plan": (
            "No Nexus rollback is required, because Nexus has executed nothing: this "
            "is a proposal only. Any repair a technician performs afterwards is undone "
            "by the owning surface's own reversal, and the deviation re-measurement "
            "below is what shows whether the repair held."
        ),
        "verification": (
            f"Re-read GET /api/fleet-baseline/cohorts/{report.get('platform') or ''}"
            f"/deviations after the repair and check {label_lower} on the {count} named "
            f"endpoints: the shape is resolved when none of them still sits more than "
            f"{threshold} {direction} the cohort median."
        ),
        "devices_affected": devices_affected(shape),
        "source": {
            "kind": SOURCE_KIND,
            "shape_id": str(shape.get("id") or ""),
            "platform": report.get("platform"),
            "metric": shape.get("metric"),
            "direction": direction,
            "verdict": shape.get("verdict"),
            "device_count": count,
            "device_ids": devices_affected(shape),
            "cohort_median": median,
            "basis": basis,
            "evidence": EVIDENCE_SOURCE,
        },
    }


def existing_change(open_changes: Iterable[dict], shape_id: str) -> dict | None:
    """The open change already raised from this shape, if any.

    Idempotency here is about the symptom, not the request: a shape that is still
    open is not raised again, so a technician pressing the button twice — or two
    technicians pressing it at once — cannot produce two pieces of work for one
    deviation.
    """
    wanted = str(shape_id or "").strip()
    if not wanted:
        return None
    for change in open_changes:
        source = change.get("source") or {}
        if str(source.get("kind") or "") != SOURCE_KIND:
            continue
        if str(source.get("shape_id") or "") != wanted:
            continue
        # The status is checked here as well as in the query, so a caller that
        # passes an unfiltered set of changes cannot turn a closed change into a
        # duplicate and permanently block the shape.
        if str(change.get("status") or "") not in OPEN_CHANGE_STATUSES:
            continue
        return change
    return None


def proposal(report: dict, shape_id: str, *, open_changes: Iterable[dict] = ()) -> dict:
    """Either the change request a shape raises, or why it raises none.

    Returns ``{"proposed": True, "change": {...}}`` or
    ``{"proposed": False, "reason": ..., "detail": ...}``; the router turns the
    reason into a status code, so the refusal is decided here rather than twice.
    """
    open_changes = list(open_changes)
    if report.get("cohort") is None:
        return {
            "proposed": False,
            "reason": "cohort_not_established",
            "detail": str(report.get("note") or "No endpoint in scope belongs to this cohort."),
        }
    shape = shape_by_id(report, shape_id)
    if shape is None:
        return {
            "proposed": False,
            "reason": "shape_not_reported",
            "detail": (
                "The recurrence view does not report this shape for this cohort, so "
                "there is no evidence to raise work from."
            ),
        }
    duplicate = existing_change(open_changes, shape["id"])
    if duplicate is not None:
        return {
            "proposed": False,
            "reason": "already_open",
            "detail": (
                f"Change {duplicate.get('id')} is already open for this shape "
                f"(status {duplicate.get('status')})."
            ),
            "existing_change_id": duplicate.get("id"),
        }
    return {"proposed": True, "change": change_payload(report, shape)}


def previews(report: dict, *, open_changes: Iterable[dict] = ()) -> dict:
    """Every shape in one cohort and the change each would raise.

    Read-only and disclosed: the same refusals the POST decides are shown here, so
    a surface can render what would happen before anyone asks it to.
    """
    open_changes = list(open_changes)
    shapes = []
    for shape in report.get("shapes") or []:
        decision = proposal(report, shape.get("id"), open_changes=open_changes)
        row: dict[str, Any] = {
            "shape_id": shape.get("id"),
            "metric": shape.get("metric"),
            "label": shape.get("label"),
            "direction": shape.get("direction"),
            "verdict": shape.get("verdict"),
            "device_count": shape.get("device_count"),
            "device_names": shape.get("device_names"),
            "basis": shape.get("basis"),
            "proposed": decision["proposed"],
            "reason": decision.get("reason"),
            "detail": decision.get("detail"),
        }
        if decision["proposed"]:
            row["change"] = decision["change"]
        else:
            row["existing_change_id"] = decision.get("existing_change_id")
        shapes.append(row)
    return {
        "platform": report.get("platform"),
        "cohort": report.get("cohort"),
        "minimum_devices": report.get("minimum_devices"),
        "shapes": shapes,
        "proposable_count": sum(1 for row in shapes if row["proposed"]),
        "open_change_count": sum(1 for row in shapes if row["reason"] == "already_open"),
        "note": (
            "Each row is the change request a shape would raise. A shape the "
            "recurrence view does not report has no row, a shape with an open change "
            "names it instead of proposing a second, and raising one matches the "
            "shape's evidence exactly."
        ),
        "boundary": BOUNDARY,
    }


__all__ = [
    "BOUNDARY",
    "EVIDENCE_SOURCE",
    "OPEN_CHANGE_STATUSES",
    "PROPOSABLE_VERDICTS",
    "SOURCE_KIND",
    "change_payload",
    "devices_affected",
    "existing_change",
    "previews",
    "proposal",
    "risk_level",
    "shape_by_id",
]
