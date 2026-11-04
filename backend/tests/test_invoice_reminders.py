"""Focused tests for the automated invoice-reminder programme.

The schedule-matching, template and normalisation policy in
``app.services.invoice_reminders`` decides which reminders fire when and with
what copy.  These tests pin that policy without a database or mail provider.
"""

from __future__ import annotations

from datetime import date

from app.services import invoice_reminders as policy


def _invoice(**overrides):
    invoice = {
        "id": "inv-1",
        "invoice_number": "INV-100",
        "client_id": "client-1",
        "client_name": "Acme Corporation",
        "total": 165.0,
        "amount_paid": 0.0,
        "status": "sent",
        "payment_status": "unpaid",
        "due_date": "2026-10-17",
    }
    invoice.update(overrides)
    return invoice


def _settings(**overrides):
    settings, errors = policy.normalise_reminder_settings({})
    assert not errors
    # The production default is a paused programme with a weekend hold; tests
    # exercise an active programme without the hold unless they opt in.
    settings.update({"enabled": True, "weekday_only": False})
    settings.update(overrides)
    return settings


class TestParseDate:
    def test_accepts_iso_date(self):
        assert policy.parse_date("2026-10-17") == date(2026, 10, 17)

    def test_rejects_garbage(self):
        assert policy.parse_date("17/10/2026") is None
        assert policy.parse_date("") is None
        assert policy.parse_date("2026-13-40") is None


class TestNormaliseSettings:
    def test_defaults_produce_valid_programme(self):
        settings, errors = policy.normalise_reminder_settings({})
        assert errors == []
        assert settings["enabled"] is False
        assert settings["stages"], "default stages must exist"
        assert all(stage["subject"] and stage["message"] for stage in settings["stages"])

    def test_rejects_stage_without_copy(self):
        settings, errors = policy.normalise_reminder_settings({
            "stages": [{"kind": "after_due", "days": 3, "subject": "", "message": ""}],
        })
        assert errors
        assert settings["stages"] == []

    def test_rejects_invalid_kind_and_days(self):
        _, errors = policy.normalise_reminder_settings({
            "stages": [{"kind": "whenever", "days": 3, "subject": "s", "message": "m"}],
        })
        assert errors
        _, errors = policy.normalise_reminder_settings({
            "stages": [{"kind": "after_due", "days": -5, "subject": "s", "message": "m"}],
        })
        assert errors

    def test_requires_at_least_one_stage(self):
        _, errors = policy.normalise_reminder_settings({"stages": []})
        assert any("at least one" in error for error in errors)

    def test_due_date_stage_normalised_to_zero_days(self):
        settings, errors = policy.normalise_reminder_settings({
            "stages": [{"kind": "due_date", "days": 0, "subject": "s", "message": "m"}],
        })
        assert errors == []
        assert settings["stages"][0]["kind"] == "due_date"

    def test_unknown_tone_falls_back(self):
        settings, errors = policy.normalise_reminder_settings({
            "stages": [{"kind": "after_due", "days": 1, "tone": "sarcastic", "subject": "s", "message": "m"}],
        })
        assert errors == []
        assert settings["stages"][0]["tone"] == "professional"


class TestStageTriggerDate:
    def test_offsets_relative_to_due_date(self):
        due = date(2026, 10, 17)
        assert policy.stage_trigger_date({"kind": "before_due", "days": 7}, due) == date(2026, 10, 10)
        assert policy.stage_trigger_date({"kind": "due_date", "days": 0}, due) == due
        assert policy.stage_trigger_date({"kind": "after_due", "days": 3}, due) == date(2026, 10, 20)

    def test_describe_stage_labels(self):
        assert policy.describe_stage({"kind": "before_due", "days": 7}) == "7 days before due"
        assert policy.describe_stage({"kind": "due_date", "days": 0}) == "On the due date"
        assert policy.describe_stage({"kind": "after_due", "days": 1}) == "1 day overdue"


class TestPlanInvoiceReminders:
    def test_plans_future_stages_in_date_order(self):
        plan = policy.plan_invoice_reminders(_invoice(), _settings(), date(2026, 10, 3))
        assert [item["stage_id"] for item in plan] == ["before-7", "due-0", "after-1", "after-7", "after-14"]
        dates = [item["date"] for item in plan]
        assert dates == sorted(dates)

    def test_past_stages_are_not_planned(self):
        plan = policy.plan_invoice_reminders(_invoice(), _settings(), date(2026, 10, 12))
        assert [item["stage_id"] for item in plan] == ["due-0", "after-1", "after-7", "after-14"]

    def test_paid_cancelled_and_zero_balance_plan_nothing(self):
        settings = _settings()
        assert policy.plan_invoice_reminders(_invoice(payment_status="paid"), settings, date(2026, 10, 3)) == []
        assert policy.plan_invoice_reminders(_invoice(status="cancelled"), settings, date(2026, 10, 3)) == []
        assert policy.plan_invoice_reminders(_invoice(total=0), settings, date(2026, 10, 3)) == []

    def test_min_balance_filters_small_invoices(self):
        settings = _settings(min_balance=500)
        assert policy.plan_invoice_reminders(_invoice(), settings, date(2026, 10, 3)) == []

    def test_disabled_programme_plans_nothing(self):
        assert policy.plan_invoice_reminders(_invoice(), _settings(enabled=False), date(2026, 10, 3)) == []

    def test_missing_due_date_plans_nothing(self):
        assert policy.plan_invoice_reminders(_invoice(due_date=""), _settings(), date(2026, 10, 3)) == []


class TestDueStages:
    def test_only_matching_stage_fires_on_trigger_date(self):
        firing = policy.due_stages(_invoice(), _settings(), date(2026, 10, 10))
        assert [stage["id"] for stage in firing] == ["before-7"]

    def test_nothing_fires_on_a_quiet_day(self):
        assert policy.due_stages(_invoice(), _settings(), date(2026, 10, 5)) == []

    def test_due_date_stage_fires_on_due_date(self):
        firing = policy.due_stages(_invoice(), _settings(), date(2026, 10, 17))
        assert [stage["id"] for stage in firing] == ["due-0"]

    def test_weekend_hold_blocks_sending(self):
        saturday = date(2026, 10, 10)  # verified: 2026-10-10 is a Saturday
        assert saturday.weekday() == 5
        assert policy.due_stages(_invoice(), _settings(weekday_only=True), saturday) == []
        firing = policy.due_stages(_invoice(), _settings(), saturday)
        assert [stage["id"] for stage in firing] == ["before-7"]

    def test_disabled_stage_never_fires(self):
        settings = _settings()
        settings["stages"] = [{**stage, "enabled": False} for stage in settings["stages"]]
        assert policy.due_stages(_invoice(), settings, date(2026, 10, 10)) == []


class TestTemplateRendering:
    def test_context_and_rendering(self):
        context = policy.build_context(_invoice(), {"name": "Acme Corporation"}, date(2026, 10, 20), "NexusMSP")
        assert context["amount_due"] == "$165.00"
        assert context["days_overdue"] == "3"
        rendered = policy.render_reminder_copy(
            "Hi {client_name}, invoice {invoice_number} for {amount_due} is {days_overdue} days late",
            context,
        )
        assert rendered == "Hi Acme Corporation, invoice INV-100 for $165.00 is 3 days late"

    def test_unknown_variables_render_empty(self):
        assert policy.render_reminder_copy("Dear {unknown_var}", {}) == "Dear "
