"""Contract tests for the technician points economy policy.

Points are append-only ledger entries; cosmetics never grant authority.
These tests lock purchase affordability, ownership idempotence, equip
exclusivity and ledger balance reconstruction.
"""

import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services.tech_rewards import (  # noqa: E402
    DEFAULT_CATALOG,
    LEDGER_ENTRY_KINDS,
    RARITIES,
    REWARD_KINDS,
    apply_equip,
    inventory_entry,
    ledger_entry,
    normalise_catalog_payload,
    points_summary,
    validate_grant,
    validate_purchase,
)

ACTOR = {"id": "user-1", "name": "Ada Lovelace", "email": "ada@example.com"}


class TestDefaultCatalog:
    def test_catalog_covers_pets_skins_and_titles(self):
        kinds = {item["kind"] for item in DEFAULT_CATALOG}
        assert kinds == {"pet", "skin", "title"}

    def test_catalog_ids_are_stable_and_unique(self):
        ids = [item["id"] for item in DEFAULT_CATALOG]
        assert len(ids) == len(set(ids))

    def test_catalog_rarities_and_prices_are_valid(self):
        for item in DEFAULT_CATALOG:
            assert item["rarity"] in RARITIES
            assert item["price_points"] > 0


class TestCatalogPayload:
    def test_valid_custom_item(self):
        doc = normalise_catalog_payload({
            "name": "Byte Jr", "kind": "pet", "rarity": "rare", "price_points": 400,
        })
        assert doc["kind"] == "pet"
        assert doc["custom"] is True

    def test_rejects_unknown_kind(self):
        with pytest.raises(HTTPException):
            normalise_catalog_payload({"name": "X", "kind": "weapon"})

    def test_rejects_unknown_rarity(self):
        with pytest.raises(HTTPException):
            normalise_catalog_payload({"name": "X", "kind": "pet", "rarity": "mythic"})

    def test_rejects_negative_price(self):
        with pytest.raises(HTTPException):
            normalise_catalog_payload({"name": "X", "kind": "pet", "price_points": -5})

    def test_rejects_missing_name(self):
        with pytest.raises(HTTPException):
            normalise_catalog_payload({"kind": "pet"})


class TestLedger:
    def test_entry_carries_balance_after(self):
        entry = ledger_entry(
            tenant_id="t1", user_id="u1", delta=100, kind="earn",
            reason="Checklist", actor=ACTOR, balance_after=100,
        )
        assert entry["delta"] == 100
        assert entry["balance_after"] == 100
        assert entry["kind"] in LEDGER_ENTRY_KINDS

    def test_rejects_unknown_kind(self):
        with pytest.raises(HTTPException):
            ledger_entry(
                tenant_id="t1", user_id="u1", delta=1, kind="vibes",
                reason="", actor=ACTOR, balance_after=1,
            )

    def test_summary_reconstructs_balance(self):
        ledger = [
            {"delta": 100}, {"delta": 50}, {"delta": -30},
        ]
        summary = points_summary(ledger)
        assert summary["balance"] == 120
        assert summary["lifetime_earned"] == 150
        assert summary["lifetime_spent"] == 30

    def test_grant_validation(self):
        assert validate_grant(250) == 250
        assert validate_grant(-250) == -250
        with pytest.raises(HTTPException):
            validate_grant(0)
        with pytest.raises(HTTPException):
            validate_grant(1_000_000)


class TestPurchasePolicy:
    def test_purchase_returns_cost(self):
        item = {"id": "pet-byte", "price_points": 250}
        assert validate_purchase(item, balance=300, owned_item_ids=set()) == 250

    def test_unaffordable_purchase_rejected(self):
        item = {"id": "pet-byte", "price_points": 250}
        with pytest.raises(HTTPException) as exc:
            validate_purchase(item, balance=100, owned_item_ids=set())
        assert exc.value.status_code == 402

    def test_double_purchase_rejected(self):
        item = {"id": "pet-byte", "price_points": 250}
        with pytest.raises(HTTPException) as exc:
            validate_purchase(item, balance=1000, owned_item_ids={"pet-byte"})
        assert exc.value.status_code == 409

    def test_free_items_not_purchasable(self):
        item = {"id": "gift", "price_points": 0}
        with pytest.raises(HTTPException):
            validate_purchase(item, balance=1000, owned_item_ids=set())


class TestInventoryAndEquip:
    def _inventory(self):
        pet = inventory_entry(tenant_id="t1", user_id="u1", item={"id": "pet-a", "kind": "pet", "name": "A"})
        pet2 = inventory_entry(tenant_id="t1", user_id="u1", item={"id": "pet-b", "kind": "pet", "name": "B"})
        skin = inventory_entry(tenant_id="t1", user_id="u1", item={"id": "skin-a", "kind": "skin", "name": "S"})
        return [pet, pet2, skin]

    def test_equip_is_exclusive_per_kind(self):
        inventory = self._inventory()
        apply_equip(inventory, "pet-a", equip=True)
        apply_equip(inventory, "pet-b", equip=True)
        pets = [row for row in inventory if row["kind"] == "pet"]
        assert [row["equipped"] for row in pets] == [False, True]
        skins = [row for row in inventory if row["kind"] == "skin"]
        assert all(not row["equipped"] for row in skins)

    def test_unequip(self):
        inventory = self._inventory()
        apply_equip(inventory, "pet-a", equip=True)
        apply_equip(inventory, "pet-a", equip=False)
        assert not any(row["equipped"] for row in inventory)

    def test_cannot_equip_unowned(self):
        with pytest.raises(HTTPException) as exc:
            apply_equip(self._inventory(), "pet-ghost", equip=True)
        assert exc.value.status_code == 404

    def test_inventory_entry_defaults(self):
        entry = inventory_entry(
            tenant_id="t1", user_id="u1",
            item={"id": "pet-a", "kind": "pet", "name": "A", "emoji": "🐶"},
        )
        assert entry["equipped"] is False
        assert entry["emoji"] == "🐶"
        assert REWARD_KINDS
