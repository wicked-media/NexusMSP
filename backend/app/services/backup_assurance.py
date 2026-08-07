"""Evidence-based recovery assurance for the Nexus Backup management layer.

This module deliberately does not claim to run a backup engine. It scores only
observed provider, restore-test, inventory and retention evidence, and leaves
unknown controls visibly unassessed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable


def _as_utc(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _component(component_id: str, label: str, *, score: float | None, evidence: int, detail: str, gap: str = "") -> dict[str, Any]:
    return {
        "id": component_id,
        "label": label,
        "score": round(max(0, min(100, score)), 1) if score is not None else None,
        "assessed": score is not None,
        "evidence_count": evidence,
        "detail": detail,
        "gap": gap if score is None else "",
    }


def _immutable_state(record: dict[str, Any]) -> bool | None:
    keys = ("immutable", "object_lock", "immutability_enabled", "write_once")
    for key in keys:
        if key in record:
            return bool(record.get(key))
    status = str(record.get("immutability_status") or record.get("retention_lock_status") or "").strip().lower()
    if status:
        return status in {"active", "enabled", "locked", "immutable", "protected"}
    return None


def build_backup_confidence(
    jobs: Iterable[dict[str, Any]],
    records: Iterable[dict[str, Any]],
    tests: Iterable[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build a five-domain confidence score without converting missing data to a pass."""
    jobs = list(jobs)
    records = list(records)
    tests = list(tests)
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)

    finished_jobs = [row for row in jobs if row.get("status") in {"success", "failed", "warning"}]
    successful_jobs = sum(1 for row in finished_jobs if row.get("status") == "success")
    backup_score = successful_jobs / len(finished_jobs) * 100 if finished_jobs else None

    integrity_tests = [row for row in tests if str(row.get("data_integrity_check") or "").lower() in {"passed", "failed"}]
    integrity_passed = sum(1 for row in integrity_tests if str(row.get("data_integrity_check") or "").lower() == "passed")
    integrity_score = integrity_passed / len(integrity_tests) * 100 if integrity_tests else None

    completed_tests = [row for row in tests if str(row.get("result") or "").lower() in {"pass", "fail", "failed"}]
    recovery_passed = sum(1 for row in completed_tests if str(row.get("result") or "").lower() == "pass")
    recovery_score = recovery_passed / len(completed_tests) * 100 if completed_tests else None

    immutability_states = [state for state in (_immutable_state(row) for row in records) if state is not None]
    immutable_count = sum(1 for state in immutability_states if state)
    immutability_score = immutable_count / len(immutability_states) * 100 if immutability_states else None

    completed_dates = [_as_utc(row.get("completed_at") or row.get("tested_at")) for row in completed_tests]
    completed_dates = [value for value in completed_dates if value]
    newest_test = max(completed_dates) if completed_dates else None
    verification_age_days = (now - newest_test).total_seconds() / 86400 if newest_test else None
    if verification_age_days is None:
        verification_score = None
    elif verification_age_days <= 30:
        verification_score = 100.0
    elif verification_age_days <= 60:
        verification_score = 75.0
    elif verification_age_days <= 90:
        verification_score = 40.0
    else:
        verification_score = 10.0

    components = [
        _component("backup", "Backup", score=backup_score, evidence=len(finished_jobs), detail=f"{successful_jobs}/{len(finished_jobs)} observed jobs succeeded" if finished_jobs else "No completed provider jobs supplied", gap="Connect or synchronise a backup provider."),
        _component("integrity", "Integrity", score=integrity_score, evidence=len(integrity_tests), detail=f"{integrity_passed}/{len(integrity_tests)} restore checks passed integrity validation" if integrity_tests else "No recorded integrity result", gap="Complete a restore test with an integrity result."),
        _component("recovery", "Recovery", score=recovery_score, evidence=len(completed_tests), detail=f"{recovery_passed}/{len(completed_tests)} completed recovery tests passed" if completed_tests else "No completed recovery test", gap="Run and record a customer recovery test."),
        _component("immutability", "Immutability", score=immutability_score, evidence=len(immutability_states), detail=f"{immutable_count}/{len(immutability_states)} assessed copies report retention protection" if immutability_states else "Provider retention-lock evidence is unavailable", gap="Synchronise Object Lock, immutable snapshot, or write-once retention evidence."),
        _component("verification", "Verification", score=verification_score, evidence=len(completed_dates), detail=f"Latest completed recovery proof is {round(verification_age_days)} days old" if verification_age_days is not None else "No timestamped recovery proof", gap="Complete a timestamped recovery verification."),
    ]
    assessed = [row for row in components if row["assessed"]]
    score = round(sum(row["score"] for row in assessed) / len(assessed), 1) if assessed else None
    coverage = round(len(assessed) / len(components) * 100)
    label = "Not assessed" if score is None else "Proven" if score >= 90 and coverage == 100 else "Strong" if score >= 80 else "Needs attention" if score >= 60 else "At risk"
    return {
        "score": score,
        "label": label,
        "evidence_coverage": coverage,
        "assessed_components": len(assessed),
        "total_components": len(components),
        "components": components,
        "gaps": [row["gap"] for row in components if row["gap"]],
        "last_verified_at": newest_test.isoformat() if newest_test else None,
        "principle": "Confidence measures observed recoverability evidence. Missing evidence remains Not assessed.",
    }


def simulate_recovery(
    *,
    client_id: str,
    client_name: str,
    workload: str,
    target_rto_hours: float,
    target_rpo_hours: float,
    data_size_gb: float,
    dependencies: Iterable[str],
    jobs: Iterable[dict[str, Any]],
    records: Iterable[dict[str, Any]],
    tests: Iterable[dict[str, Any]],
    now: datetime | None = None,
) -> dict[str, Any]:
    """Preview recovery readiness. This function never performs a restore."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    aliases = {client_id.strip().lower(), client_name.strip().lower()} - {""}

    def belongs(row: dict[str, Any]) -> bool:
        values = {str(row.get("client_id") or "").strip().lower(), str(row.get("client_name") or "").strip().lower()}
        return bool(aliases & values)

    client_jobs = [row for row in jobs if belongs(row)]
    client_records = [row for row in records if belongs(row)]
    client_tests = [row for row in tests if belongs(row)]
    successful_sources = [row for row in [*client_records, *client_jobs] if str(row.get("status") or "").lower() == "success"]
    source_dates = [_as_utc(row.get("completed_at") or row.get("last_run")) for row in successful_sources]
    source_dates = [value for value in source_dates if value]
    latest_restore_point = max(source_dates) if source_dates else None
    restore_point_age_hours = round((now - latest_restore_point).total_seconds() / 3600, 1) if latest_restore_point else None

    passed_tests = [row for row in client_tests if str(row.get("result") or "").lower() == "pass"]
    restore_times = [float(row["restore_time_minutes"]) for row in passed_tests if row.get("restore_time_minutes") is not None]
    measured_restore = round(sum(restore_times) / len(restore_times), 1) if restore_times else None
    immutability = [state for state in (_immutable_state(row) for row in client_records) if state is not None]
    immutable_proven = any(immutability)

    rpo_status = "not_assessed" if restore_point_age_hours is None else "met" if restore_point_age_hours <= target_rpo_hours else "missed"
    rto_status = "not_assessed" if measured_restore is None else "met" if measured_restore <= target_rto_hours * 60 else "missed"
    blockers: list[str] = []
    if latest_restore_point is None:
        blockers.append("No successful timestamped restore point is linked to this customer.")
    if measured_restore is None:
        blockers.append("No measured successful restore is available for an evidence-backed recovery-time estimate.")
    if not immutability:
        blockers.append("Immutability has not been assessed for the selected customer's backup copies.")
    elif not immutable_proven:
        blockers.append("Assessed backup copies do not currently prove immutable retention.")
    if rpo_status == "missed":
        blockers.append(f"The latest observed restore point is {restore_point_age_hours:g} hours old, outside the {target_rpo_hours:g}-hour RPO.")
    if rto_status == "missed":
        blockers.append(f"Observed restore time is {measured_restore:g} minutes, outside the {target_rto_hours:g}-hour RTO.")

    dependencies = [str(value).strip() for value in dependencies if str(value).strip()]
    readiness = "insufficient_evidence" if latest_restore_point is None or measured_restore is None else "gaps_detected" if blockers else "ready_with_evidence"
    return {
        "client_id": client_id,
        "client_name": client_name,
        "workload": workload,
        "readiness": readiness,
        "target_rto_hours": target_rto_hours,
        "target_rpo_hours": target_rpo_hours,
        "latest_restore_point": latest_restore_point.isoformat() if latest_restore_point else None,
        "restore_point_age_hours": restore_point_age_hours,
        "rpo_status": rpo_status,
        "measured_restore_minutes": measured_restore,
        "estimated_restore_range_minutes": [round(measured_restore * 0.8), round(measured_restore * 1.25)] if measured_restore is not None else None,
        "rto_status": rto_status,
        "immutability": "proven" if immutable_proven else "not_proven" if immutability else "not_assessed",
        "required_staging_storage_gb": round(data_size_gb * 1.2, 1) if data_size_gb > 0 else None,
        "restore_order": [*dependencies, workload],
        "blockers": blockers,
        "evidence": {"jobs": len(client_jobs), "backup_records": len(client_records), "completed_tests": len(client_tests), "successful_restore_tests": len(passed_tests)},
        "external_changes": False,
        "notice": "Simulation only. Nexus has not restored data, contacted a provider, or changed production systems.",
    }
