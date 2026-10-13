"""Conformance guards for the immutable-application-rollback rehearsal.

The rehearsal itself (`scripts/Test-NexusApplicationRollback.ps1`) runs on a
Docker host and cannot execute in this environment, exactly like the
capture-and-restore drill it is modelled on. What *is* deterministic here is the
contract around it: the drill must rehearse the real pin script, stay
disposable, verify release identity rather than a healthy endpoint alone, keep
its scope exclusions disclosed, and the runbooks and checklist must not describe
the release gate as closed before a deployment-host run exists.

These are drift guards, not a substitute for the rehearsal. A passing run here
proves the tooling and the documentation still agree; it does not prove a
rollback works on a host.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
DRILL_PATH = SCRIPTS / "Test-NexusApplicationRollback.ps1"
PIN_PATH = SCRIPTS / "Deploy-NexusImageTag.ps1"
RELEASE_RUNBOOK_PATH = ROOT / "docs" / "RELEASE_RUNBOOK.md"
READINESS_PATH = ROOT / "docs" / "PRODUCTION_READINESS.md"
CHECKLIST_PATH = ROOT / "docs" / "NEXUS_PRODUCTION_READINESS_CHECKLIST.md"


def _drill() -> str:
    return DRILL_PATH.read_text(encoding="utf-8")


def _pin() -> str:
    return PIN_PATH.read_text(encoding="utf-8")


def test_the_rollback_drill_exists_and_rehearses_the_real_pin_script():
    assert DRILL_PATH.is_file()
    assert PIN_PATH.is_file()

    drill = _drill()

    # The rehearsal is worthless if it rolls images by hand: the point is that
    # the documented rollback command is what gets exercised.
    assert "Deploy-NexusImageTag.ps1" in drill
    assert "& $deployScript -ApiImage" in drill
    for parameter in ("-WebImage $webRelease", "-ComposeFile $ComposeFile", "-ProjectName $projectName"):
        assert parameter in drill, f"the drill no longer pins a release as documented ({parameter})"

    # It must refuse to run without the script it is proving.
    assert "The drill rehearses that script, so it cannot run without it." in drill


def test_the_drill_is_disposable_and_never_touches_a_deployment():
    drill = _drill()

    assert '"nexus-rollback-drill-$runId"' in drill
    assert "nexus-rollback-drill-" in drill
    # Every Compose variable the production file requires is generated in
    # process for the disposable project instead of being read from the host.
    for variable in (
        "MONGO_USERNAME",
        "MONGO_PASSWORD",
        "JWT_SECRET",
        "NEXUS_SECRET_ENCRYPTION_KEY",
        "NEXUS_DMARC_RECEIVER_TOKEN",
        "NEXUS_OBSERVABILITY_INGEST_TOKEN",
    ):
        assert variable in drill
    assert "RandomNumberGenerator" in drill
    # No host environment file may be sourced to obtain anything.
    assert ".env" not in drill
    assert "dotenv" not in drill

    # Fail closed before doing anything, and always clean up.
    assert "Get-Command docker" in drill
    assert "Docker Compose v2 (docker compose) is required" in drill
    assert "down --volumes --remove-orphans" in drill


def test_the_drill_verifies_release_identity_and_the_pin_guards():
    drill = _drill()

    # A green endpoint does not prove which release is running. The drill reads
    # the built image's identity and the running container's image identity and
    # compares them, before and after the rollback.
    assert "docker image inspect --format '{{.Id}}'" in drill
    assert "docker inspect --format '{{.Image}}'" in drill
    assert "rollback_restored_previous_image" in drill
    assert "adopted_release_was_running" in drill

    # Two distinct releases, or the rollback would prove nothing.
    assert "releases_are_distinct_images" in drill
    assert "A rollback between them would prove nothing." in drill

    # Data has to survive an application-only rollback.
    assert "seeded_data_survived_rollback" in drill

    # The guards the production path depends on are rehearsed too.
    assert "& $deployScript -ApiImage 'nexusmsp-api:latest'" in drill
    assert "mutable_reference_refused" in drill
    assert "-ValidateOnly" in drill
    assert "validate_only_did_not_change_state" in drill

    # Evidence is retained in the documented location.
    assert "release-drills" in drill
    assert "release-drill-{0}-{1}.json" in drill


def test_the_drill_discloses_what_it_does_not_rehearse():
    drill = _drill()

    # A reader must not be able to infer that migration rollback was exercised.
    assert "not rehearsed here" in drill
    assert "version-discriminated" in drill

    runbook = RELEASE_RUNBOOK_PATH.read_text(encoding="utf-8")
    assert "Test-NexusApplicationRollback.ps1" in runbook
    assert "Database migration rollback is not rehearsed by this" in runbook
    # The migration procedure still has to run before older images start.
    assert "migration's documented" in runbook
    assert "must run **before** older images" in runbook


def test_the_pin_script_refuses_mutable_references_and_rolls_pre_staged_images():
    pin = _pin()

    # The immutability contract cannot be relaxed by the new no-pull path.
    assert "-SkipPull" in pin
    assert "must not use the mutable 'latest' tag" in pin
    assert "must carry an explicit tag or digest" in pin

    # The reference assertions must happen at parameter-validation time, before
    # any pull or roll is reachable.
    assert pin.index("Assert-NexusImmutableReference -Reference $ApiImage") < pin.index("if ($PSCmdlet.ShouldProcess")
    assert pin.index("Assert-NexusImmutableReference -Reference $WebImage") < pin.index("if ($PSCmdlet.ShouldProcess")

    # -SkipPull fails closed when the image is not staged on the host.
    assert "-SkipPull was requested but '$reference' is not present on this host." in pin
    assert "It never makes an unpinned or mutable" in pin


def test_the_gate_is_recorded_as_unclosed_until_a_deployment_host_run_exists():
    checklist = CHECKLIST_PATH.read_text(encoding="utf-8")

    assert "[!] | Immutable application rollback" not in checklist
    assert "[-] | Immutable application rollback" in checklist
    assert "scripts/Test-NexusApplicationRollback.ps1" in checklist
    # The row must still name the work that only a deployment host can do...
    assert "run the drill on the deployment Docker host" in checklist
    assert "rehearse a real database migration's rollback" in checklist
    # ...and the cycle record must say the drill could not be executed while it
    # was authored, rather than implying a passing rehearsal.
    assert "Not re-verifiable in this environment" in checklist

    readiness = READINESS_PATH.read_text(encoding="utf-8")
    assert "Test-NexusApplicationRollback.ps1" in readiness
    assert "artifacts/release-drills/" in readiness
