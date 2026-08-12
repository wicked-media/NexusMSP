import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("validate_gateway_policy.py")
SPEC = importlib.util.spec_from_file_location("validate_gateway_policy", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def valid_policy():
    return {
        "gateway_id": "nexus-jump-lab-au-01",
        "display_name": "Nexus Jump lab",
        "environment": "lab",
        "endpoint": "jump-lab.example.net:51820",
        "public_key": "A" * 44,
        "allowed_resource_cidrs": ["10.42.10.0/24"],
        "allowed_protocols": ["https", "ssh"],
        "maximum_session_minutes": 60,
        "approval_required": True,
        "ticket_required": True,
    }


def test_valid_policy_passes():
    assert MODULE.validate(valid_policy()) == []


def test_broad_route_is_rejected():
    policy = valid_policy()
    policy["allowed_resource_cidrs"] = ["0.0.0.0/0"]
    assert any("least-privilege" in error for error in MODULE.validate(policy))


def test_policy_requires_ticket_and_approval():
    policy = valid_policy()
    policy["ticket_required"] = False
    policy["approval_required"] = False
    errors = MODULE.validate(policy)
    assert any("ticket_required" in error for error in errors)
    assert any("approval_required" in error for error in errors)
