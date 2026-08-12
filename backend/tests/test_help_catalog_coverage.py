from app.routers._help_seed_curated import CURATED_ARTICLES, HELP_CATALOG_VERSION


PLATFORM_OPERATION_GUIDES = {
    "deployment-hub",
    "nexus-edge-lab",
    "nexus-jump-lab",
    "nexus-verify",
    "nexus-work-session",
    "nexus-dmarc-operations",
    "nexus-mail-shield",
    "expected-state",
    "nexus-diagnostics",
    "nexus-what-changed",
    "channel-mode",
}


def test_platform_operation_guides_are_shipped_and_task_complete():
    guides = {article["slug"]: article for article in CURATED_ARTICLES}

    assert PLATFORM_OPERATION_GUIDES <= guides.keys()
    for slug in PLATFORM_OPERATION_GUIDES:
        body = guides[slug]["body_md"]
        for section in (
            "## Outcome",
            "## Before you start",
            "## Procedure",
            "## Verify the result",
            "## Troubleshooting",
            "## Rollback and escalation",
            "## Audit and handover",
        ):
            assert section in body, f"{slug} is missing {section}"
        assert guides[slug]["screenshots"] == []


def test_help_catalog_version_tracks_the_platform_operations_release():
    assert "v19-platform-operations" in HELP_CATALOG_VERSION
