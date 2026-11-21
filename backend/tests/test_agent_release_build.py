"""Release-pipeline contracts for the distributable Nexus Agent components."""

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_production_image_builds_agent_components_from_source_not_local_dist():
    dockerfile = (ROOT / "backend" / "Dockerfile.production").read_text(encoding="utf-8")
    dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")

    assert "FROM golang:" in dockerfile
    assert "COPY agent/go.mod agent/go.sum ./" in dockerfile
    assert "COPY agent ./" in dockerfile
    assert "COPY --from=agent-build" in dockerfile
    assert "agent/dist ./agent/dist" not in dockerfile
    assert "NEXUS_AGENT_VERSION_FILE=/app/agent/dist/VERSION" in dockerfile
    for component in ("nexus-agent.exe", "nexus-client-chat.exe", "nexus-agent-tray.exe", "nexus-remote-companion.exe"):
        assert f"/out/{component}" in dockerfile
    assert "agent/dist" in dockerignore
    assert "signed-bundle" not in dockerignore
    assert "backend/.env" in dockerignore


def test_ci_builds_every_distributed_agent_component_and_production_image():
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    for component in ("nexus-agent.exe", "nexus-client-chat.exe", "nexus-agent-tray.exe", "nexus-remote-companion.exe"):
        assert component in workflow
    assert "--file backend/Dockerfile.production ." in workflow
    assert "--file backend/Dockerfile.release" in workflow


def test_signing_evidence_covers_every_distributed_agent_component():
    signing_script = (ROOT / "scripts" / "Sign-NexusAgent.ps1").read_text(encoding="utf-8")

    for component in ("nexus-agent.exe", "nexus-client-chat.exe", "nexus-agent-tray.exe", "nexus-remote-companion.exe"):
        assert component in signing_script
    assert "agent_version     = $AgentVersion" in signing_script
    assert "commit            = $Commit" in signing_script


def test_release_workflow_builds_and_uploads_native_remote_companion():
    workflow = (ROOT / ".github" / "workflows" / "nexus-agent-release.yml").read_text(encoding="utf-8")

    assert "./cmd/nexus-remote-companion" in workflow
    assert "agent/dist/nexus-remote-companion.exe" in workflow
    assert "agent/dist/VERSION" in workflow
    assert "-AgentVersion" in workflow
    assert "-Commit" in workflow
    assert "Native Remote Companion" in workflow


def test_published_api_image_requires_a_verified_signed_agent_bundle():
    dockerfile = (ROOT / "backend" / "Dockerfile.release").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "release-images.yml").read_text(encoding="utf-8")

    assert "FROM golang:" not in dockerfile
    assert "COPY scripts/verify_signed_agent_bundle.py" in dockerfile
    assert "COPY signed-bundle" in dockerfile
    assert "--expected-version" in dockerfile
    assert "COPY --from=verify-signed-agent" in dockerfile
    assert "NEXUS_AGENT_VERSION_FILE=/app/agent/dist/VERSION" in dockerfile

    assert "actions: read" in workflow
    assert "agent_run_id" in workflow
    assert "verify_signed_agent_bundle.py" in workflow
    assert "backend/Dockerfile.release" in workflow
    assert "nexus-agent-windows-" in workflow
    assert "NEXUS_AGENT_VERSION=" in workflow
    assert "git merge-base --is-ancestor" in workflow
    assert "Install crane for digest-preserving promotion" in workflow
    assert "scripts/promote_signed_images.sh" in workflow
    assert "Upload promotion manifest" in workflow
    assert "staging-" in workflow


def test_release_tags_are_promoted_only_after_both_signed_images():
    workflow_path = ROOT / ".github" / "workflows" / "release-images.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    job = workflow["jobs"]["release-images"]
    assert "matrix" not in job
    assert "inputs.promotion_only" in job["if"]

    steps = job["steps"]
    names = [step.get("name", "") for step in steps]
    api_build = names.index("Build and stage API image")
    api_sign = names.index("Sign staged API image digest")
    web_build = names.index("Build and stage web image")
    web_sign = names.index("Sign staged web image digest")
    record = names.index("Record promotion manifest")
    upload = names.index("Upload promotion manifest")
    promote = names.index("Verify and promote signed digests")

    assert api_build < api_sign < web_build < web_sign < record < upload < promote
    assert steps[api_build]["with"]["file"] == "backend/Dockerfile.release"
    assert steps[api_build]["with"]["build-args"].startswith("NEXUS_AGENT_VERSION=")
    assert "staging_api" in steps[api_build]["with"]["tags"]
    assert "meta_api" not in steps[api_build]["with"]["tags"]
    assert steps[web_build]["with"]["file"] == "frontend/Dockerfile"
    assert "staging_web" in steps[web_build]["with"]["tags"]
    assert "meta_web" not in steps[web_build]["with"]["tags"]
    assert steps[upload]["uses"] == "actions/upload-artifact@v4"
    assert steps[upload]["with"]["name"] == (
        "nexus-promotion-${{ steps.version.outputs.version }}-${{ github.run_id }}"
    )
    assert "scripts/promote_signed_images.sh" in steps[promote]["run"]


def test_promotion_script_verifies_both_images_before_tagging():
    script = (ROOT / "scripts" / "promote_signed_images.sh").read_text(encoding="utf-8")

    assert "cosign verify" in script
    assert "crane digest" in script
    assert "crane tag" in script
    assert script.index("cosign verify") < script.index("crane tag")


def test_promotion_recovery_reuses_recorded_digests_without_rebuilding():
    workflow_path = ROOT / ".github" / "workflows" / "release-images.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    recovery = workflow["jobs"]["promotion-recovery"]
    assert "inputs.promotion_only" in recovery["if"]

    steps = recovery["steps"]
    names = [step.get("name", "") for step in steps]
    assert names.index("Validate recovery inputs") < names.index(
        "Download recorded promotion manifest"
    ) < names.index("Validate recorded promotion manifest") < names.index(
        "Verify and promote recorded digests"
    )
    assert "Recovery summary" in names
    download = steps[names.index("Download recorded promotion manifest")]
    assert download["uses"] == "actions/download-artifact@v4"
    assert download["with"]["name"] == (
        "nexus-promotion-${{ inputs.version }}-${{ inputs.source_run_id }}"
    )
    assert download["with"]["run-id"] == "${{ inputs.source_run_id }}"
    assert "pattern" not in download["with"]
    promote = steps[names.index("Verify and promote recorded digests")]
    assert "scripts/promote_signed_images.sh" in promote["run"]
    assert not any(
        str(step.get("uses", "")).startswith("docker/build-push-action")
        for step in steps
    )
    assert not any("docker build" in str(step.get("run", "")) for step in steps)
    assert not any("cosign sign" in str(step.get("run", "")) for step in steps)


def test_local_component_build_includes_native_remote_companion():
    makefile = (ROOT / "agent" / "Makefile").read_text(encoding="utf-8")

    assert "all: windows windows-chat windows-tray windows-remote" in makefile
    assert "dist/VERSION" in makefile


def test_native_remote_companion_is_built_as_a_gui_app_on_every_path():
    build_files = (
        ROOT / "agent" / "Makefile",
        ROOT / "backend" / "Dockerfile.production",
        ROOT / ".github" / "workflows" / "ci.yml",
        ROOT / ".github" / "workflows" / "nexus-agent-release.yml",
    )

    for path in build_files:
        lines = [
            line for line in path.read_text(encoding="utf-8").splitlines()
            if "go build" in line and "nexus-remote-companion" in line
        ]
        assert lines, f"no Native Remote companion build in {path.name}"
        assert all("-H=windowsgui" in line for line in lines), path.name
