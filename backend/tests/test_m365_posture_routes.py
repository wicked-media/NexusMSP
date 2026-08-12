from app.routers.m365 import router


def test_microsoft_mail_and_intune_posture_routes_remain_available():
    paths = {route.path for route in router.routes}

    assert "/m365/exchange/posture" in paths
    assert "/m365/intune/posture" in paths
    assert "/m365/collaboration/posture" in paths
    assert "/m365/security/posture" in paths
    assert "/m365/licensing/posture" in paths
    assert "/m365/sync/readiness" in paths
