from app.services.nexus_ideas import IDEA_STATUSES, VALUE_AXES, _IDEAS, _seed_document


def test_curated_idea_catalog_is_distinct_and_value_filtered():
    documents = [_seed_document(*row) for row in _IDEAS]

    assert len(documents) == 388
    assert len({item["id"] for item in documents}) == 388
    assert {item["number"] for item in documents} == set(range(326, 714))
    assert all(any(item["value_axes"].values()) for item in documents)
    assert all(set(item["value_axes"]) == set(VALUE_AXES) for item in documents)
    assert all(item["status"] == "captured" for item in documents)
    by_source = {}
    for item in documents:
        by_source.setdefault(item["source"], []).append(item["source_number"])
    assert by_source["self-improving-platform-brief-351-370"] == list(range(351, 371))
    assert by_source["experience-design-brief-371-400"] == list(range(371, 401))
    assert by_source["purposeful-motion-brief-401-445"] == list(range(401, 446))
    assert by_source["interaction-delight-brief-401-430"] == list(range(401, 431))
    assert by_source["security-saas-diagnostics-brief-536-556"] == list(range(536, 557))
    assert by_source["experience-requests-services-brief-557-589"] == list(range(557, 590))
    assert by_source["identity-recovery-resilience-billing-brief-590-633"] == list(range(590, 634))
    assert by_source["technician-network-field-brief-634-673"] == list(range(634, 674))
    assert by_source["vendor-assurance-autonomy-federation-brief-674-713"] == list(range(674, 714))


def test_idea_lifecycle_keeps_capture_separate_from_roadmap_release():
    assert IDEA_STATUSES == ("captured", "reviewing", "validated", "promoted", "parked", "rejected")
    assert "released" not in IDEA_STATUSES
