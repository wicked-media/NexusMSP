"""Fleet baseline — what the estate's own endpoints say a device should look like.

Batch 5 left one capability unbuilt and named the gate for it: the Nexus Agent
learns a performance baseline **per endpoint** (`agent/internal/selfheal/perf.go`
reports a band, a score, a sample count and named signals), and nothing compared a
device against the rest of the estate. That is the gate recorded as
`fleet-baseline` in `app/services/studio_proposals.py`, and this module is the
projection that closes it.

It reads records Nexus already stores — the device row's reported usage metrics
and its agent-reported self-heal performance band — so it adds no collection, no
replica and no new datum. It is a pure policy module: the router owns scope,
validation and HTTP, exactly as `docs/NEXUS_STUDIO_FLEET.md` requires.

Four rules, each of which the tests pin:

1. **A cohort is only a baseline once enough of it was measured.** Below
   ``MINIMUM_COHORT_DEVICES`` measured devices a metric has no median, and a
   device compared against it is reported ``cohort_not_established`` rather than
   being graded against a number that means nothing.
2. **A metric nobody reported is ``None`` with its reason.** Never ``0``, never
   ``healthy``. A device that has not reported disk usage is not a device with an
   empty disk.
3. **A deviation is a difference from the estate's own median, not a fault.**
   The response says so verbatim, because the honest product claim is *"this
   device differs from its peers, here is by how much and against what"*.
4. **Recurrence is counted from those same deviations**, so a "recurring problem"
   can never disagree with the per-device evidence it was counted from, and a
   shape needs at least two endpoints before it is shared rather than one
   machine's bad day.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

# The metrics the agent reports today, in disclosure order.
METRICS: tuple[tuple[str, str, str], ...] = (
    ("cpu_usage", "CPU", "%"),
    ("memory_usage", "Memory", "%"),
    ("disk_usage", "Disk", "%"),
)

# A cohort smaller than this cannot define what the estate looks like.
MINIMUM_COHORT_DEVICES = 5

# A shape is shared once a second endpoint shows it — the rule the Wish Engine
# uses for a shared need, applied to a shared symptom.
MINIMUM_RECURRING_DEVICES = 2

# How far from the cohort median a value has to sit before it is worth a
# technician's attention. Disclosed in the response so no UI can invent its own.
STRONG_DEVIATION_RATIO = 0.5
NOTABLE_DEVIATION_RATIO = 0.2

# Bounded work: the projection is a read, and a read has to finish.
MAX_DEVICES = 5000

BOUNDARY = (
    "A deviation is a difference from the estate's own measured median, never a "
    "fault, a cause or a prediction. Nexus compares records it already stores; it "
    "does not collect anything new, and it does not change a device record."
)

COHORT_NOTE = (
    "A cohort is the caller's own scoped estate, grouped by operating system. It "
    "is a peer group, not a vendor profile: minimum cohort size, the deviation "
    "thresholds and the metric list are disclosed here so a verdict can be "
    "reproduced rather than trusted."
)

PLATFORM_LABELS = {
    "windows": "Windows",
    "linux": "Linux",
    "macos": "macOS",
    "unknown": "Unclassified",
}

PLATFORM_ORDER = ("windows", "linux", "macos", "unknown")

# Reported self-heal performance bands, worst first, so a cohort can be read at a
# glance without inventing a score Nexus did not compute.
BAND_ORDER = ("critical", "degraded", "watch", "healthy", "unknown")


# ============== READING A DEVICE ==============


def normalise_platform(device: dict) -> str:
    """Which operating-system cohort a device belongs to, or ``unknown``.

    The ingest writes the platform to ``os_platform``, ``os`` or ``platform``
    depending on the agent version and the path that reported it, so all three are
    read. A device whose platform cannot be read is grouped as ``unknown`` and
    disclosed there rather than being guessed into Windows.
    """
    raw = " ".join(
        str(device.get(key) or "") for key in ("os_platform", "os", "platform")
    ).lower()
    if not raw.strip():
        return "unknown"
    if "windows" in raw or raw.startswith("win"):
        return "windows"
    if "macos" in raw or "darwin" in raw or "mac os" in raw or "os x" in raw:
        return "macos"
    if "linux" in raw or "ubuntu" in raw or "debian" in raw:
        return "linux"
    return "unknown"


def _number(value: Any) -> float | None:
    """A finite number, or ``None``. Booleans and blanks are not measurements."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def device_metric(device: dict, key: str) -> float | None:
    """One reported metric for a device.

    The heartbeat spreads the snapshot's telemetry onto the device record, so the
    metric is normally a top-level field; older records keep it under
    ``telemetry``. Both are read and nothing is derived: an absent metric stays
    absent.
    """
    direct = _number(device.get(key))
    if direct is not None:
        return direct
    for container in ("telemetry", "snapshot", "metrics"):
        nested = device.get(container)
        if isinstance(nested, dict):
            found = _number(nested.get(key))
            if found is not None:
                return found
    return None


def device_band(device: dict) -> str:
    """The agent's own self-heal performance band, or ``unknown``.

    Reported, never computed: this module does not score a device. ``unknown`` is
    a real answer — it means the agent has not assessed this endpoint yet.
    """
    self_heal = device.get("self_heal")
    performance = self_heal.get("performance") if isinstance(self_heal, dict) else None
    band = str((performance or {}).get("band") or "").strip().lower()
    return band if band in BAND_ORDER else "unknown"


def device_score(device: dict) -> float | None:
    self_heal = device.get("self_heal")
    performance = self_heal.get("performance") if isinstance(self_heal, dict) else None
    return _number((performance or {}).get("score"))


def device_samples(device: dict) -> int | None:
    self_heal = device.get("self_heal")
    performance = self_heal.get("performance") if isinstance(self_heal, dict) else None
    raw = (performance or {}).get("samples")
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        return max(int(raw), 0)
    except (TypeError, ValueError):
        return None


def device_row(device: dict) -> dict:
    """The disclosure-safe identity of a device: stable ids, never free text."""
    return {
        "device_id": device.get("id"),
        "client_id": device.get("client_id"),
        "name": device.get("name") or device.get("hostname") or "Unnamed endpoint",
        "hostname": device.get("hostname") or "",
        "platform": normalise_platform(device),
        "status": str(device.get("status") or "unknown"),
        "band": device_band(device),
        "score": device_score(device),
        "samples": device_samples(device),
        "last_seen": device.get("last_seen") or device.get("last_heartbeat"),
    }


# ============== THE COHORT BASELINE ==============


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _percentile(values: list[float], fraction: float) -> float:
    """Linear-interpolated percentile, so a spread is computed, not eyeballed."""
    ordered = sorted(values)
    if len(ordered) == 1:
        return 0.0
    position = fraction * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return 0.0
    weight = position - lower
    return (ordered[upper] - ordered[lower]) * weight


def _metric_summary(values: list[float], unit: str) -> dict:
    measured = len(values)
    if measured == 0:
        return {
            "measured_count": 0,
            "median": None,
            "spread": None,
            "unit": unit,
            "established": False,
            "reason": "No endpoint in this cohort reported this metric.",
        }
    median = _median(values)
    established = measured >= MINIMUM_COHORT_DEVICES
    return {
        "measured_count": measured,
        "median": round(median, 2),
        "spread": round(_percentile([abs(value - median) for value in values], 0.75), 2),
        "unit": unit,
        "established": established,
        "reason": None if established else (
            f"Only {measured} of the {MINIMUM_COHORT_DEVICES} measured endpoints needed "
            "to define this baseline reported it."
        ),
    }


def cohort_row(platform: str, devices: list[dict]) -> dict:
    """One cohort: what its measured endpoints say a device looks like."""
    metrics: dict[str, dict] = {}
    for key, label, unit in METRICS:
        values = [value for value in (device_metric(d, key) for d in devices)
                  if value is not None]
        metrics[key] = {"label": label, **_metric_summary(values, unit)}

    bands = {band: 0 for band in BAND_ORDER}
    for device in devices:
        bands[device_band(device)] += 1

    measured_devices = sum(
        1 for device in devices
        if any(device_metric(device, key) is not None for key, _, _ in METRICS)
    )
    established = measured_devices >= MINIMUM_COHORT_DEVICES
    return {
        "platform": platform,
        "label": PLATFORM_LABELS.get(platform, platform),
        "device_count": len(devices),
        "measured_device_count": measured_devices,
        "baseline_established": established,
        "minimum_devices": MINIMUM_COHORT_DEVICES,
        "unestablished_reason": None if established else (
            f"{measured_devices} of {len(devices)} endpoints reported a metric; "
            f"{MINIMUM_COHORT_DEVICES} measured endpoints are needed before a cohort "
            "baseline exists."
        ),
        "metrics": metrics,
        "bands": bands,
    }


def group_by_platform(devices: Iterable[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for device in devices:
        grouped.setdefault(normalise_platform(device), []).append(device)
    return grouped


def cohorts(devices: Iterable[dict]) -> list[dict]:
    """Every cohort, largest first, so the one that can speak comes first."""
    grouped = group_by_platform(devices)
    rows = [cohort_row(platform, grouped[platform]) for platform in grouped]
    rows.sort(key=lambda row: (-row["device_count"], PLATFORM_ORDER.index(row["platform"])
                               if row["platform"] in PLATFORM_ORDER else len(PLATFORM_ORDER)))
    return rows


def find_cohort(devices: Iterable[dict], platform: str) -> dict | None:
    wanted = str(platform or "").strip().lower()
    for row in cohorts(devices):
        if row["platform"] == wanted:
            return row
    return None


def contract(devices: Iterable[dict]) -> dict:
    """The disclosure record: what a baseline is, and what this estate has."""
    scoped = list(devices)[:MAX_DEVICES]
    rows = cohorts(scoped)
    return {
        "cohorts": rows,
        "metrics": [{"key": key, "label": label, "unit": unit} for key, label, unit in METRICS],
        "minimum_cohort_devices": MINIMUM_COHORT_DEVICES,
        "minimum_recurring_devices": MINIMUM_RECURRING_DEVICES,
        "strong_deviation_ratio": STRONG_DEVIATION_RATIO,
        "notable_deviation_ratio": NOTABLE_DEVIATION_RATIO,
        "device_count": len(scoped),
        "note": COHORT_NOTE,
        "boundary": BOUNDARY,
    }


# ============== DEVIATION ==============


def _verdict(ratio: float) -> str:
    if ratio >= STRONG_DEVIATION_RATIO:
        return "strong"
    if ratio >= NOTABLE_DEVIATION_RATIO:
        return "notable"
    return "within_baseline"


def _basis(device_value: float, summary: dict, platform: str, label: str) -> str:
    unit = summary.get("unit") or ""
    return (
        f"{device_value}{unit} against a cohort median of {summary['median']}{unit} "
        f"across {summary['measured_count']} measured {PLATFORM_LABELS.get(platform, platform)} "
        f"endpoints ({label})."
    )


def device_deviation(device: dict, cohort: dict) -> dict:
    """One device against its cohort, with every non-answer named."""
    deviations: list[dict] = []
    unmeasured: list[dict] = []
    for key, label, unit in METRICS:
        summary = cohort["metrics"][key]
        value = device_metric(device, key)
        if value is None:
            unmeasured.append({
                "metric": key,
                "label": label,
                "reason": "This endpoint has not reported this metric.",
            })
            continue
        if not summary["established"]:
            deviations.append({
                "metric": key,
                "label": label,
                "value": value,
                "cohort_median": None,
                "delta": None,
                "verdict": "cohort_not_established",
                "basis": summary["reason"],
            })
            continue
        median = float(summary["median"])
        delta = round(value - median, 2)
        ratio = abs(delta) / median if median else (math.inf if delta else 0.0)
        deviations.append({
            "metric": key,
            "label": label,
            "unit": unit,
            "value": value,
            "cohort_median": median,
            "delta": delta,
            "verdict": _verdict(ratio),
            "basis": _basis(value, summary, cohort["platform"], label),
        })
    row = device_row(device)
    return {
        **row,
        "cohort": cohort["platform"],
        "cohort_established": cohort["baseline_established"],
        "deviations": deviations,
        "unmeasured": unmeasured,
        "verdict": _device_verdict(deviations),
    }


def _device_verdict(deviations: list[dict]) -> str:
    """The worst honest verdict: unmeasured is not the same as healthy."""
    ranked = {"strong": 3, "notable": 2, "cohort_not_established": 1, "within_baseline": 0}
    if not deviations:
        return "not_measured"
    return max(deviations, key=lambda row: ranked.get(row["verdict"], 0))["verdict"]


def deviations(devices: Iterable[dict], platform: str) -> dict:
    """Every device in one cohort against that cohort's baseline."""
    scoped = list(devices)[:MAX_DEVICES]
    cohort = find_cohort(scoped, platform)
    if cohort is None:
        return {
            "platform": str(platform or "").strip().lower() or None,
            "cohort": None,
            "devices": [],
            "note": "No endpoint in scope belongs to this cohort.",
            "boundary": BOUNDARY,
        }
    members = [d for d in scoped if normalise_platform(d) == cohort["platform"]]
    rows = [device_deviation(device, cohort) for device in members]
    ranked = {"strong": 3, "notable": 2, "cohort_not_established": 1, "within_baseline": 0}
    rows.sort(key=lambda row: (-ranked.get(row["verdict"], 0), row["name"]))
    return {
        "platform": cohort["platform"],
        "cohort": cohort,
        "devices": rows,
        "note": (
            "Devices are ordered by the worst verdict they carry. A device with no "
            "reported metric is not_measured rather than healthy."
        ),
        "boundary": BOUNDARY,
    }


# ============== RECURRENCE ==============


def recurrence(devices: Iterable[dict], platform: str) -> dict:
    """Deviation shapes shared by more than one endpoint in a cohort.

    The shape is the identity of the symptom — platform, metric, direction and
    verdict — counted from the same deviations the per-device view returns, so the
    two can never tell different stories.
    """
    scoped = list(devices)[:MAX_DEVICES]
    reported = deviations(scoped, platform)
    cohort = reported["cohort"]
    if cohort is None:
        return {
            "platform": reported["platform"],
            "cohort": None,
            "shapes": [],
            "note": reported["note"],
            "boundary": BOUNDARY,
        }

    buckets: dict[tuple, dict] = {}
    for device in reported["devices"]:
        for row in device["deviations"]:
            if row["verdict"] not in {"strong", "notable"}:
                continue
            delta = row["delta"]
            if delta is None:
                continue
            key = (row["metric"], "above" if delta > 0 else "below", row["verdict"])
            bucket = buckets.setdefault(key, {
                "metric": row["metric"],
                "label": row["label"],
                "unit": row.get("unit"),
                "direction": key[1],
                "verdict": row["verdict"],
                "cohort_median": row["cohort_median"],
                "device_ids": [],
                "device_names": [],
            })
            bucket["device_ids"].append(device["device_id"])
            bucket["device_names"].append(device["name"])

    shapes = []
    for bucket in buckets.values():
        count = len(bucket["device_ids"])
        if count < MINIMUM_RECURRING_DEVICES:
            continue
        unit = bucket["unit"] or ""
        direction = "above" if bucket["direction"] == "above" else "below"
        threshold = (STRONG_DEVIATION_RATIO if bucket["verdict"] == "strong"
                     else NOTABLE_DEVIATION_RATIO)
        shapes.append({
            "id": f"{cohort['platform']}|{bucket['metric']}|{direction}|{bucket['verdict']}",
            "platform": cohort["platform"],
            "metric": bucket["metric"],
            "label": bucket["label"],
            "direction": direction,
            "verdict": bucket["verdict"],
            "device_count": count,
            "device_ids": bucket["device_ids"],
            "device_names": bucket["device_names"],
            "cohort_median": bucket["cohort_median"],
            "basis": (
                f"{count} of {cohort['metrics'][bucket['metric']]['measured_count']} "
                f"measured {cohort['label']} endpoints sit more than "
                f"{int(threshold * 100)}% {direction} the cohort median of "
                f"{bucket['cohort_median']}{unit} for {bucket['label']}."
            ),
        })
    shapes.sort(key=lambda row: (-row["device_count"], row["metric"], row["direction"]))
    return {
        "platform": cohort["platform"],
        "cohort": cohort,
        "shapes": shapes,
        "minimum_devices": MINIMUM_RECURRING_DEVICES,
        "note": (
            "A shape needs at least two endpoints before it is reported as shared: "
            "one machine's bad day is not a recurring problem."
        ),
        "boundary": BOUNDARY,
    }


__all__ = [
    "BAND_ORDER",
    "BOUNDARY",
    "COHORT_NOTE",
    "MAX_DEVICES",
    "METRICS",
    "MINIMUM_COHORT_DEVICES",
    "MINIMUM_RECURRING_DEVICES",
    "NOTABLE_DEVIATION_RATIO",
    "PLATFORM_ORDER",
    "STRONG_DEVIATION_RATIO",
    "cohort_row",
    "cohorts",
    "contract",
    "device_band",
    "device_deviation",
    "device_metric",
    "device_row",
    "deviations",
    "find_cohort",
    "group_by_platform",
    "normalise_platform",
    "recurrence",
]
