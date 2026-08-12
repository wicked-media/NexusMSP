"""Contract coverage for the Nexus-owned DMARC control plane."""

from app.routers.nexus_dmarc import router


def test_nexus_dmarc_routes_are_registered():
    paths = {route.path for route in router.routes}
    assert "/nexus-dmarc/overview" in paths
    assert "/nexus-dmarc/settings" in paths
    assert "/nexus-dmarc/receiver/xml" in paths
    assert "/nexus-dmarc/receiver/readiness" in paths
    assert "/nexus-dmarc/domains/{domain_id}/posture-discovery" in paths
    assert "/nexus-dmarc/domains/{domain_id}/spf-discovery" in paths
    assert "/nexus-dmarc/domains/{domain_id}/spf-flatten-preview" in paths
    assert "/nexus-dmarc/domains/{domain_id}/spf-assessment" in paths
    assert "/nexus-dmarc/domains/{domain_id}/spf-change-plan" in paths
    assert "/nexus-dmarc/spf-change-plans/{plan_id}/change-request" in paths
