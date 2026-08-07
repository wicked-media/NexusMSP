"""Tenant-boundary and download-safety contracts for specialist ticket records."""

import asyncio
from types import SimpleNamespace

from app.routers import field_enhanced, workshop


def _request(path: str, job_id: str | None = None):
    return SimpleNamespace(
        path_params={"job_id": job_id} if job_id else {},
        url=SimpleNamespace(path=path),
    )


def test_field_job_path_dependency_enforces_record_scope(monkeypatch):
    collection = object()
    captured = {}

    async def capture_scope(user, selected_collection, record_id, **kwargs):
        captured.update(user=user, collection=selected_collection, record_id=record_id, kwargs=kwargs)

    monkeypatch.setattr(field_enhanced, "db", SimpleNamespace(field_jobs=collection))
    monkeypatch.setattr(field_enhanced, "assert_record_scope", capture_scope)

    asyncio.run(field_enhanced._enforce_field_job_scope(
        _request("/api/field-jobs/job-1/pdf", "job-1"),
        {"id": "tech-1"},
    ))

    assert captured["collection"] is collection
    assert captured["record_id"] == "job-1"
    assert captured["kwargs"]["resource_name"] == "Field job"


def test_workshop_dependency_uses_the_correct_record_collection(monkeypatch):
    workshop_jobs = object()
    workshop_bench = object()
    selected = []

    async def capture_scope(_user, collection, record_id, **_kwargs):
        selected.append((collection, record_id))

    monkeypatch.setattr(
        workshop,
        "db",
        SimpleNamespace(workshop_jobs=workshop_jobs, workshop_bench=workshop_bench),
    )
    monkeypatch.setattr(workshop, "assert_record_scope", capture_scope)

    asyncio.run(workshop._enforce_workshop_job_scope(
        _request("/api/workshop/jobs/job-1/pdf", "job-1"),
        {"id": "tech-1"},
    ))
    asyncio.run(workshop._enforce_workshop_job_scope(
        _request("/api/workshop/bench/bench-1", "bench-1"),
        {"id": "tech-1"},
    ))

    assert selected == [(workshop_jobs, "job-1"), (workshop_bench, "bench-1")]


def test_download_names_cannot_inject_headers_or_paths():
    hostile = "../invoice\r\nX-Evil: yes"

    assert field_enhanced._download_name("FieldJob", hostile, "pdf") == "FieldJob_invoice_X-Evil_yes.pdf"
    assert workshop._download_name("QR", hostile, "png") == "QR_invoice_X-Evil_yes.png"

