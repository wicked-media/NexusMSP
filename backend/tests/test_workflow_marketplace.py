from app.routers.workflow_automation import AUTOMATION_PACKS, _pack_manifest


def test_every_marketplace_pack_declares_governed_components():
    assert len(AUTOMATION_PACKS) >= 10
    for source in AUTOMATION_PACKS:
        pack = _pack_manifest(source)
        assert pack["version"] == "1.0.0"
        assert pack["component_total"] == len(pack["artifacts"])
        assert pack["component_counts"]["workflow"] == 1
        assert pack["component_counts"]["ticket_blueprint"] == 1
        assert pack["component_counts"]["documentation_template"] == 2
        assert pack["trust"]["external_changes"] is False
        assert pack["trust"]["simulation_required"] is True
        assert pack["trust"]["independent_approval"] is True
        assert pack["required_connections"]
        assert pack["permissions"]


def test_industry_blueprints_include_security_and_recovery_baselines():
    industry_packs = [_pack_manifest(pack) for pack in AUTOMATION_PACKS if pack.get("industry")]
    assert {pack["industry"] for pack in industry_packs} == {
        "Accounting",
        "Construction",
        "Dental",
        "Education",
        "Legal",
        "Manufacturing",
    }
    for pack in industry_packs:
        kinds = {artifact["kind"] for artifact in pack["artifacts"]}
        assert {"security_baseline", "backup_policy", "alert_rule", "policy"} <= kinds
        assert pack["component_total"] == 8
