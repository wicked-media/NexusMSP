#!/usr/bin/env python3
"""Deterministic drill for promotion-only recovery.

The drill does not need Docker, a live registry, real Cosign credentials or a
GitHub Actions runner. It extracts the real manifest writer, recovery input
validator and manifest validator from the release workflow, stages a recorded
manifest, interrupts the real promotion script at the first web tag, and then
runs only the recovery run blocks against a disposable fake registry.

It proves the recorded-digest recovery path can finish an interrupted promotion
without rebuilding or re-signing either image, and that a second recovery run is
idempotent. It does not prove real registry behavior, keyless Cosign
verification, artifact download or GitHub Actions job orchestration; those still
require a live interrupted-run recovery.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "release-images.yml"
PROMOTION_SCRIPT_PATH = ROOT / "scripts" / "promote_signed_images.sh"
DRILL_NAME = "nexus-promotion-recovery"
EVIDENCE_PREFIX = "promotion-recovery-drill"


class DrillError(RuntimeError):
    """Raised when the drill cannot prove the recovery contract."""


SHIM_BODY = r'''
import json
import os
import sys
from pathlib import Path

TOOL = Path(sys.argv[0]).name
ARGS = sys.argv[1:]
STATE = Path(os.environ["PROMOTION_DRILL_STATE"])
LOG = Path(os.environ["PROMOTION_DRILL_LOG"])


def log(result, **extra):
    entry = {"tool": TOOL, "argv": ARGS, "result": result}
    entry.update(extra)
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True) + "\n")


def load():
    return json.loads(STATE.read_text(encoding="utf-8"))


def save(state):
    STATE.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def refuse(message):
    log("refused", message=message)
    sys.stderr.write(message + "\n")
    sys.exit(1)


if TOOL == "crane":
    if not ARGS:
        refuse("crane: missing command")
    command = ARGS[0]
    if command == "digest":
        if len(ARGS) != 2:
            refuse("crane digest: expected one reference")
        reference = ARGS[1]
        state = load()
        if "@" in reference:
            image, digest = reference.rsplit("@", 1)
            if digest in state.get("manifests", {}).get(image, []):
                log("digest", reference=reference, digest=digest)
                print(digest)
                sys.exit(0)
        elif ":" in reference:
            image, tag = reference.rsplit(":", 1)
            digest = state.get("tags", {}).get(image, {}).get(tag)
            if digest:
                log("digest", reference=reference, digest=digest)
                print(digest)
                sys.exit(0)
        refuse(f"crane digest: not found: {reference}")
    if command == "tag":
        if len(ARGS) != 3:
            refuse("crane tag: expected image@digest and tag")
        reference, tag = ARGS[1], ARGS[2]
        if "@" not in reference:
            refuse("crane tag: source must be digest-qualified")
        image, digest = reference.rsplit("@", 1)
        state = load()
        if state.get("fail_once") and state.get("fail_tag") == f"{image}:{tag}":
            state["fail_once"] = False
            save(state)
            log("injected_failure", image=image, tag=tag, digest=digest)
            sys.stderr.write(
                f"crane tag: injected registry interruption for {image}:{tag}\n"
            )
            sys.exit(1)
        if digest not in state.get("manifests", {}).get(image, []):
            refuse(f"crane tag: source manifest not found: {reference}")
        state.setdefault("tags", {}).setdefault(image, {})[tag] = digest
        save(state)
        log("tagged", image=image, tag=tag, digest=digest)
        sys.exit(0)
    refuse(f"crane: unsupported command: {command}")

if TOOL == "cosign":
    if not ARGS:
        refuse("cosign: missing command")
    if ARGS[0] == "sign":
        refuse("cosign sign is not allowed in the promotion drill")
    if ARGS[0] == "verify":
        reference = ARGS[-1]
        if "@" not in reference:
            refuse("cosign verify: reference must be digest-qualified")
        image, digest = reference.rsplit("@", 1)
        state = load()
        if digest in state.get("signatures", {}).get(image, []):
            log("verified", image=image, digest=digest)
            sys.exit(0)
        refuse(f"cosign verify: signature not found for {reference}")
    refuse(f"cosign: unsupported command: {ARGS[0]}")

if TOOL == "docker":
    refuse("docker must not run during promotion recovery")

refuse(f"unsupported drill tool: {TOOL}")
'''


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_workflow() -> dict[str, Any]:
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - dependency is in requirements
        raise DrillError(
            "PyYAML is required to extract the release workflow steps "
            "(install backend/requirements.txt)."
        ) from exc
    try:
        parsed = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        raise DrillError(f"could not parse {WORKFLOW_PATH}: {exc}") from exc
    if not isinstance(parsed, dict):
        raise DrillError(f"{WORKFLOW_PATH} did not parse as a workflow mapping")
    return parsed


def _step(workflow: dict[str, Any], job: str, name: str) -> dict[str, Any]:
    try:
        steps = workflow["jobs"][job]["steps"]
    except (KeyError, TypeError) as exc:
        raise DrillError(f"workflow has no steps for job '{job}'") from exc
    for step in steps:
        if isinstance(step, dict) and step.get("name") == name:
            return step
    raise DrillError(f"workflow job '{job}' has no step named '{name}'")


def _python_from_step(step: dict[str, Any], step_name: str) -> str:
    run = step.get("run")
    if not isinstance(run, str):
        raise DrillError(f"workflow step '{step_name}' has no shell run block")
    marker = "python3 - <<'PY'\n"
    try:
        start = run.index(marker) + len(marker)
        end = run.index("\nPY\n", start)
    except ValueError as exc:
        raise DrillError(
            f"workflow step '{step_name}' does not contain the expected Python heredoc"
        ) from exc
    return run[start:end].strip("\n") + "\n"


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _write_shims(bin_dir: Path) -> None:
    source = f"#!{sys.executable}\n{SHIM_BODY}"
    for tool in ("crane", "cosign", "docker"):
        _write_executable(bin_dir / tool, source)


def _base_env(workdir: Path, bin_dir: Path) -> dict[str, str]:
    return {
        "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", ""),
        "HOME": str(workdir),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "UTC",
        "PROMOTION_DRILL_STATE": str(workdir / "registry.json"),
        "PROMOTION_DRILL_LOG": str(workdir / "commands.jsonl"),
    }


def _run(
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    timeout: int = 60,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd),
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise DrillError(message)


def _write_registry(
    path: Path,
    *,
    api_image: str,
    web_image: str,
    api_digest: str,
    web_digest: str,
    interrupted_tag: str,
) -> None:
    state = {
        "manifests": {
            api_image: [api_digest],
            web_image: [web_digest],
        },
        "signatures": {
            api_image: [api_digest],
            web_image: [web_digest],
        },
        "tags": {api_image: {}, web_image: {}},
        "fail_tag": interrupted_tag,
        "fail_once": True,
    }
    path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def _tag_map(path: Path, image: str) -> dict[str, str]:
    state = json.loads(path.read_text(encoding="utf-8"))
    tags = state.get("tags", {}).get(image, {})
    if not isinstance(tags, dict):
        raise DrillError(f"fake registry has an invalid tag map for {image}")
    return {str(tag): str(digest) for tag, digest in tags.items()}


def _command_log(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _parse_github_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise DrillError("recovery manifest validator did not write GITHUB_ENV")
    lines = path.read_text(encoding="utf-8").splitlines()
    env: dict[str, str] = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line:
            index += 1
            continue
        if "<<" in line:
            key, delimiter = line.split("<<", 1)
            if not key or not delimiter:
                raise DrillError(f"invalid GITHUB_ENV multiline header: {line!r}")
            index += 1
            values: list[str] = []
            while index < len(lines) and lines[index] != delimiter:
                values.append(lines[index])
                index += 1
            if index >= len(lines):
                raise DrillError(f"unterminated GITHUB_ENV value for {key}")
            env[key] = "\n".join(values)
        elif "=" in line:
            key, value = line.split("=", 1)
            env[key] = value
        else:
            raise DrillError(f"invalid GITHUB_ENV line: {line!r}")
        index += 1
    return env


def _write_python(path: Path, code: str) -> None:
    path.write_text(code, encoding="utf-8")


def _run_python(path: Path, cwd: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return _run([sys.executable, str(path)], cwd=cwd, env=env)


def _write_shell(path: Path, code: str) -> None:
    path.write_text(code, encoding="utf-8")


def _run_shell(path: Path, cwd: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return _run(["bash", str(path)], cwd=cwd, env=env)


def _manifest_writer_code(workflow: dict[str, Any]) -> str:
    step = _step(workflow, "release-images", "Record promotion manifest")
    return _python_from_step(step, "Record promotion manifest")


def _manifest_validator_code(workflow: dict[str, Any]) -> str:
    step = _step(workflow, "promotion-recovery", "Validate recorded promotion manifest")
    return _python_from_step(step, "Validate recorded promotion manifest")


def _recovery_inputs_code(workflow: dict[str, Any]) -> str:
    step = _step(workflow, "promotion-recovery", "Validate recovery inputs")
    run = step.get("run")
    if not isinstance(run, str):
        raise DrillError("Validate recovery inputs has no shell run block")
    return run.strip("\n") + "\n"


def _recovery_promote_code(workflow: dict[str, Any]) -> str:
    step = _step(workflow, "promotion-recovery", "Verify and promote recorded digests")
    run = step.get("run")
    if not isinstance(run, str):
        raise DrillError("Verify and promote recorded digests has no shell run block")
    return run.strip("\n") + "\n"


def _require_bash() -> None:
    if shutil.which("bash") is None:
        raise DrillError("bash is required to run the shared promotion script")


def _run_drill(evidence_dir: Path, *, inject_failure: bool = False) -> Path:
    _require_bash()
    workflow = _load_workflow()
    manifest_writer = _manifest_writer_code(workflow)
    manifest_validator = _manifest_validator_code(workflow)
    recovery_inputs = _recovery_inputs_code(workflow)
    recovery_promote = _recovery_promote_code(workflow)

    run_id = uuid.uuid4().hex[:12]
    version = "1.4.0"
    source_run_id = "424242"
    commit = "c" * 40
    agent_commit = "d" * 40
    sha_tag = f"sha-{commit[:7]}"
    registry = "ghcr.io"
    owner = "nexusmsp-drill"
    api_image = f"{registry}/{owner}/nexusmsp-api"
    web_image = f"{registry}/{owner}/nexusmsp-web"
    api_digest = "sha256:" + "a" * 64
    web_digest = "sha256:" + "b" * 64
    api_tags = [f"{api_image}:{version}", f"{api_image}:{sha_tag}"]
    web_tags = [f"{web_image}:{version}", f"{web_image}:{sha_tag}"]
    interrupted_tag = f"{web_image}:{version}"
    artifact_name = f"nexus-promotion-{version}-{source_run_id}"
    started_at = _utc_now()

    evidence: dict[str, Any] = {
        "drill": DRILL_NAME,
        "run_id": run_id,
        "scope": (
            "recorded-digest retag after an interrupted promotion, including "
            "corrupted-digest rejection"
        ),
        "started_at": started_at,
        "workflow": str(WORKFLOW_PATH.relative_to(ROOT)),
        "version": version,
        "source_run_id": source_run_id,
        "artifact_name": artifact_name,
        "recorded": {
            "api": {"image": api_image, "digest": api_digest, "release_tags": api_tags},
            "web": {"image": web_image, "digest": web_digest, "release_tags": web_tags},
        },
        "executed_recovery_steps": [
            "Validate recovery inputs",
            "Validate recorded promotion manifest",
            "Verify and promote recorded digests",
        ],
        "not_exercised": [
            "GitHub Actions artifact upload/download",
            "container registry authentication and writes against a real registry",
            "real keyless Cosign verification",
            "container build and image signing",
        ],
        "verification": {
            "normal_promotion_interrupted": False,
            "api_tags_existed_before_recovery": False,
            "web_tags_absent_before_recovery": False,
            "corrupted_api_digest_rejected_before_tagging": False,
            "corrupted_web_digest_rejected_before_tagging": False,
            "recovery_used_recorded_digests": False,
            "both_images_have_both_recorded_tags": False,
            "recovery_rerun_is_idempotent": False,
            "no_build_or_sign_commands": False,
            "recovery_steps_executed_verbatim": False,
        },
        "result": "failed",
        "evidence_note": (
            "Disposable fake-registry drill; no deployment secrets are recorded. "
            "It proves the recorded-digest recovery logic, not live registry, "
            "Cosign or GitHub Actions behavior."
        ),
    }

    workdir = Path(tempfile.mkdtemp(prefix="nexus-promotion-recovery-drill-"))
    try:
        bin_dir = workdir / "bin"
        scripts_dir = workdir / "scripts"
        promotion_dir = workdir / "promotion"
        bin_dir.mkdir()
        scripts_dir.mkdir()
        promotion_dir.mkdir()
        _write_shims(bin_dir)
        shutil.copy2(PROMOTION_SCRIPT_PATH, scripts_dir / PROMOTION_SCRIPT_PATH.name)

        registry_path = workdir / "registry.json"
        _write_registry(
            registry_path,
            api_image=api_image,
            web_image=web_image,
            api_digest=api_digest,
            web_digest=web_digest,
            interrupted_tag=interrupted_tag,
        )
        base_env = _base_env(workdir, bin_dir)
        github_env = workdir / "github_env"
        log_path = workdir / "commands.jsonl"

        writer_path = workdir / "write_manifest.py"
        _write_python(writer_path, manifest_writer)
        writer_env = base_env | {
            "API_DIGEST": api_digest,
            "API_IMAGE": api_image,
            "API_TAGS": "\n".join(api_tags),
            "STAGING_API_IMAGE": f"{api_image}:staging-{source_run_id}-{commit}",
            "WEB_DIGEST": web_digest,
            "WEB_IMAGE": web_image,
            "WEB_TAGS": "\n".join(web_tags),
            "STAGING_WEB_IMAGE": f"{web_image}:staging-{source_run_id}-{commit}",
            "VERSION": version,
            "AGENT_VERSION": "0.1.20",
            "AGENT_RUN_ID": "171717",
            "AGENT_RUN_COMMIT": agent_commit,
            "GITHUB_SHA": commit,
        }
        writer = _run_python(writer_path, workdir, writer_env)
        if writer.returncode != 0:
            raise DrillError(f"manifest writer failed: {writer.stderr.strip()}")
        manifest_path = promotion_dir / "promotion-manifest.json"
        if not manifest_path.is_file():
            raise DrillError("manifest writer did not create promotion-manifest.json")

        promotion_env = base_env | {
            "GITHUB_REPOSITORY": f"{owner}/repo",
            "API_IMAGE": api_image,
            "API_DIGEST": api_digest,
            "API_TAGS": "\n".join(api_tags),
            "WEB_IMAGE": web_image,
            "WEB_DIGEST": web_digest,
            "WEB_TAGS": "\n".join(web_tags),
        }
        interrupted = _run(
            ["bash", "scripts/promote_signed_images.sh"],
            cwd=workdir,
            env=promotion_env,
        )
        if interrupted.returncode == 0:
            raise DrillError("normal promotion unexpectedly completed; the drill did not interrupt it")
        interrupted_api_tags = _tag_map(registry_path, api_image)
        interrupted_web_tags = _tag_map(registry_path, web_image)
        expected_api = {version: api_digest, sha_tag: api_digest}
        expected_web = {version: web_digest, sha_tag: web_digest}
        if interrupted_api_tags != expected_api:
            raise DrillError(
                f"normal promotion did not leave the expected partial API tags: {interrupted_api_tags}"
            )
        if interrupted_web_tags:
            raise DrillError(
                f"normal promotion was expected to stop before any web tag: {interrupted_web_tags}"
            )
        evidence["interruption"] = {
            "normal_promotion_exit_code": interrupted.returncode,
            "failed_tag": interrupted_tag,
            "api_tags_at_interruption": interrupted_api_tags,
            "web_tags_at_interruption": interrupted_web_tags,
            "stderr": interrupted.stderr.strip(),
        }
        evidence["verification"]["normal_promotion_interrupted"] = True
        evidence["verification"]["api_tags_existed_before_recovery"] = True
        evidence["verification"]["web_tags_absent_before_recovery"] = True

        if inject_failure:
            raise DrillError("injected drill failure after the promotion interruption")

        inputs_path = workdir / "validate_recovery_inputs.sh"
        _write_shell(inputs_path, recovery_inputs)
        inputs = _run_shell(
            inputs_path,
            workdir,
            base_env | {"SOURCE_RUN_ID": source_run_id, "VERSION": version},
        )
        if inputs.returncode != 0:
            raise DrillError(f"recovery input validation failed: {inputs.stderr.strip()}")

        validator_path = workdir / "validate_manifest.py"
        _write_python(validator_path, manifest_validator)
        promote_path = workdir / "recovery_promote.sh"
        _write_shell(promote_path, recovery_promote)
        recorded_manifest = manifest_path.read_text(encoding="utf-8")

        def run_corrupted_digest_control(component: str, tampered_digest: str) -> None:
            images = {"api": api_image, "web": web_image}
            recorded_digests = {"api": api_digest, "web": web_digest}
            image = images[component]
            tampered_manifest = json.loads(recorded_manifest)
            tampered_manifest[component]["digest"] = tampered_digest
            manifest_path.write_text(
                json.dumps(tampered_manifest, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            negative_github_env = workdir / f"github_env_negative_{component}"
            try:
                negative_log_offset = len(_command_log(log_path))
                negative_validator = _run_python(
                    validator_path,
                    workdir,
                    base_env
                    | {
                        "VERSION": version,
                        "REGISTRY": registry,
                        "GITHUB_REPOSITORY_OWNER": owner,
                        "GITHUB_ENV": str(negative_github_env),
                    },
                )
                if negative_validator.returncode != 0:
                    raise DrillError(
                        f"tampered {component} manifest failed schema validation "
                        f"before the promotion check: {negative_validator.stderr.strip()}"
                    )
                negative_env = base_env | _parse_github_env(negative_github_env) | {
                    "GITHUB_REPOSITORY": f"{owner}/repo",
                }
                negative = _run_shell(promote_path, workdir, negative_env)
                negative_commands = _command_log(log_path)[negative_log_offset:]
                negative_tagged = [
                    entry
                    for entry in negative_commands
                    if entry.get("result") == "tagged"
                ]
                negative_verified = [
                    entry
                    for entry in negative_commands
                    if entry.get("result") == "verified"
                ]
                negative_api_tags = _tag_map(registry_path, api_image)
                negative_web_tags = _tag_map(registry_path, web_image)
                control = {
                    "component": component,
                    "description": (
                        f"A valid-format but unrecorded {component} digest must be "
                        "rejected before any tag is written."
                    ),
                    "tampered": {
                        "image": image,
                        "digest": tampered_digest,
                        "recorded_digest": recorded_digests[component],
                    },
                    "stage": "promotion",
                    "exit_code": negative.returncode,
                    "verified_before_rejection": len(negative_verified),
                    "tagged_commands": len(negative_tagged),
                    "api_tags_after": negative_api_tags,
                    "web_tags_after": negative_web_tags,
                    "stderr": negative.stderr.strip(),
                }
                evidence.setdefault("negative_controls", []).append(control)
                if negative.returncode == 0:
                    raise DrillError(
                        f"recovery unexpectedly accepted the corrupted {component} digest"
                    )
                if negative_tagged:
                    raise DrillError(
                        "recovery wrote tags before rejecting the corrupted "
                        f"{component} digest: {negative_tagged}"
                    )
                if negative_api_tags != expected_api or negative_web_tags:
                    raise DrillError(
                        "recovery changed the partial tag map while rejecting the "
                        f"corrupted {component} digest: api={negative_api_tags} "
                        f"web={negative_web_tags}"
                    )
                if "signature not found" not in negative.stderr:
                    raise DrillError(
                        f"recovery did not fail on the corrupted {component} digest "
                        f"signature: {negative.stderr.strip()}"
                    )
                evidence["verification"][
                    f"corrupted_{component}_digest_rejected_before_tagging"
                ] = True
            finally:
                manifest_path.write_text(recorded_manifest, encoding="utf-8")

        run_corrupted_digest_control("api", "sha256:" + "e" * 64)
        run_corrupted_digest_control("web", "sha256:" + "f" * 64)

        validator = _run_python(
            validator_path,
            workdir,
            base_env
            | {
                "VERSION": version,
                "REGISTRY": registry,
                "GITHUB_REPOSITORY_OWNER": owner,
                "GITHUB_ENV": str(github_env),
            },
        )
        if validator.returncode != 0:
            raise DrillError(f"recorded manifest validation failed: {validator.stderr.strip()}")
        recovery_env = base_env | _parse_github_env(github_env) | {
            "GITHUB_REPOSITORY": f"{owner}/repo",
        }

        recovered = _run_shell(promote_path, workdir, recovery_env)
        if recovered.returncode != 0:
            raise DrillError(f"recovery promotion failed: {recovered.stderr.strip()}")
        recovered_api_tags = _tag_map(registry_path, api_image)
        recovered_web_tags = _tag_map(registry_path, web_image)
        if recovered_api_tags != expected_api or recovered_web_tags != expected_web:
            raise DrillError(
                "recovery did not land both images on the recorded tags: "
                f"api={recovered_api_tags} web={recovered_web_tags}"
            )

        rerun = _run_shell(promote_path, workdir, recovery_env)
        if rerun.returncode != 0:
            raise DrillError(f"idempotent recovery rerun failed: {rerun.stderr.strip()}")
        rerun_api_tags = _tag_map(registry_path, api_image)
        rerun_web_tags = _tag_map(registry_path, web_image)
        if rerun_api_tags != expected_api or rerun_web_tags != expected_web:
            raise DrillError(
                "recovery rerun changed the recorded tag mapping: "
                f"api={rerun_api_tags} web={rerun_web_tags}"
            )

        commands = _command_log(log_path)
        no_build_or_sign = not any(
            entry.get("tool") == "docker"
            or (entry.get("tool") == "cosign" and entry.get("argv", [])[:1] == ["sign"])
            for entry in commands
        )
        verified_digests = {
            (entry.get("image"), entry.get("digest"))
            for entry in commands
            if entry.get("result") == "verified"
        }
        _require(
            no_build_or_sign,
            "promotion/recovery invoked docker or cosign sign",
        )
        _require(
            (api_image, api_digest) in verified_digests
            and (web_image, web_digest) in verified_digests,
            "the drill did not verify both recorded image signatures",
        )
        _require(
            any(entry.get("result") == "injected_failure" for entry in commands),
            "the drill did not record the injected promotion interruption",
        )

        evidence["recovery"] = {
            "api_tags": recovered_api_tags,
            "web_tags": recovered_web_tags,
            "rerun_api_tags": rerun_api_tags,
            "rerun_web_tags": rerun_web_tags,
            "cosign_verifications": len(
                [entry for entry in commands if entry.get("result") == "verified"]
            ),
        }
        evidence["verification"].update(
            {
                "recovery_used_recorded_digests": True,
                "both_images_have_both_recorded_tags": True,
                "recovery_rerun_is_idempotent": True,
                "no_build_or_sign_commands": no_build_or_sign,
                "recovery_steps_executed_verbatim": True,
            }
        )
        evidence["result"] = "passed"
    except Exception as exc:
        evidence["failure"] = str(exc)
        evidence["result"] = "failed"
        raise
    finally:
        evidence["finished_at"] = _utc_now()
        evidence_dir.mkdir(parents=True, exist_ok=True)
        evidence_path = evidence_dir / f"{EVIDENCE_PREFIX}-{run_id}.json"
        evidence_path.write_text(
            json.dumps(evidence, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        shutil.rmtree(workdir, ignore_errors=True)

    return evidence_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evidence-dir",
        type=Path,
        default=ROOT / "artifacts" / "release-drills",
        help="Directory for the retained JSON evidence.",
    )
    parser.add_argument(
        "--inject-failure",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args(argv)
    try:
        evidence_path = _run_drill(
            args.evidence_dir,
            inject_failure=args.inject_failure,
        )
    except Exception as exc:
        print(f"Promotion recovery drill failed: {exc}", file=sys.stderr)
        return 1
    print(f"Promotion recovery drill passed. Evidence: {evidence_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
