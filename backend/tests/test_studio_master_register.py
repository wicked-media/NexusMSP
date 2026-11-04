"""Contracts for the source-controlled 210-item Studio master register."""

from __future__ import annotations

from app.services import studio_master_register, studio_proposals, studio_registry


def test_master_register_contains_each_numbered_requirement_once():
    rows = studio_master_register.MASTER_STUDIOS

    assert len(rows) == 210
    assert {row["number"] for row in rows} == set(range(1, 211))
    assert all(row["name"] and row["domain"] and row["scope"] for row in rows)


def test_reconciliation_accounts_for_every_requirement_without_promoting_parent_mapping():
    rows = studio_master_register.reconcile(
        studio_registry.STUDIOS.values(), studio_proposals.PROPOSALS.values()
    )

    assert len(rows) == 210
    assert all(row["source"] == f"master-register #{row['number']}" for row in rows)
    parent_mapped = [row for row in rows if row["canonical_kind"] == "portfolio_parent"]
    assert parent_mapped
    assert all(row["canonical_id"] for row in parent_mapped)
    assert all(row["implementation_status"] == "Portfolio mapped; capability delivery pending" for row in parent_mapped)
    assert all("does not admit a new capability" in row["blocker"] for row in parent_mapped)


def test_summary_is_derived_from_the_same_rows_the_api_will_serve():
    rows = studio_master_register.reconcile(
        studio_registry.STUDIOS.values(), studio_proposals.PROPOSALS.values()
    )
    summary = studio_master_register.summary(
        studio_registry.STUDIOS.values(), studio_proposals.PROPOSALS.values()
    )

    assert summary["total"] == len(rows) == 210
    assert summary["canonical_matches"] + summary["unmapped_requirements"] == 210
    assert summary["evidence_backed_matches"] + summary["portfolio_parent_decisions"] == 210
    assert summary["portfolio_parent_decisions"] > 0
    assert summary["unmapped_requirements"] == 0
    assert "not claimed delivery" in summary["disclosure"]
