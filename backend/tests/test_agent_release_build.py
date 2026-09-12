"""Release-pipeline contracts for the distributable Nexus Agent components."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_production_image_builds_agent_components_from_source_not_local_dist():
    dockerfile = (ROOT / "backend" / "Dockerfile.production").read_text(encoding="utf-8")
    dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")

    assert "FROM golang:" in dockerfile
    assert "COPY agent/go.mod agent/go.sum ./" in dockerfile
    assert "COPY agent ./" in dockerfile
    assert "COPY --from=agent-build" in dockerfile
    assert "agent/dist ./agent/dist" not in dockerfile
    for component in ("nexus-agent.exe", "nexus-client-chat.exe", "nexus-agent-tray.exe"):
        assert f"/out/{component}" in dockerfile
    assert "agent/dist" in dockerignore
    assert "backend/.env" in dockerignore


def test_ci_builds_every_distributed_agent_component_and_production_image():
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    for component in ("nexus-agent.exe", "nexus-client-chat.exe", "nexus-agent-tray.exe"):
        assert component in workflow
    assert "--file backend/Dockerfile.production ." in workflow
