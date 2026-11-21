#!/usr/bin/env bash
# Verify both image signatures and add release tags to the exact signed digests.
# This is shared by the normal release job and the promotion-only recovery job.
set -euo pipefail

for name in API_IMAGE API_DIGEST API_TAGS WEB_IMAGE WEB_DIGEST WEB_TAGS GITHUB_REPOSITORY; do
  if [ -z "${!name:-}" ]; then
    echo "::error::${name} is required for signed image promotion." >&2
    exit 1
  fi
done

IDENTITY="^https://github.com/${GITHUB_REPOSITORY}/[.]github/workflows/release-images[.]yml@(refs/heads|refs/tags)/.*$"

for image_digest in "${API_IMAGE}@${API_DIGEST}" "${WEB_IMAGE}@${WEB_DIGEST}"; do
  cosign verify \
    --certificate-identity-regexp "${IDENTITY}" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    "${image_digest}" >/dev/null
done

crane digest "${API_IMAGE}@${API_DIGEST}" >/dev/null
crane digest "${WEB_IMAGE}@${WEB_DIGEST}" >/dev/null

promote() {
  local image="$1" digest="$2" tags="$3"
  local promoted_count=0
  while IFS= read -r ref; do
    [ -z "${ref}" ] && continue
    if [[ "${ref}" != "${image}:"* ]]; then
      echo "::error::Release tag ${ref} is outside ${image}." >&2
      return 1
    fi
    local tag="${ref#"${image}:"}"
    if [[ ! "${tag}" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
      echo "::error::Release tag ${ref} has an invalid tag name." >&2
      return 1
    fi
    echo "Promoting ${image}@${digest} to ${tag}"
    crane tag "${image}@${digest}" "${tag}"
    local promoted
    promoted=$(crane digest "${image}:${tag}")
    if [ "${promoted}" != "${digest}" ]; then
      echo "::error::Promotion of ${image}:${tag} changed the digest (${promoted} != ${digest})." >&2
      return 1
    fi
    promoted_count=$((promoted_count + 1))
  done <<< "${tags}"
  if [ "${promoted_count}" -eq 0 ]; then
    echo "::error::No release tags were provided for ${image}." >&2
    return 1
  fi
}

promote "${API_IMAGE}" "${API_DIGEST}" "${API_TAGS}"
promote "${WEB_IMAGE}" "${WEB_DIGEST}" "${WEB_TAGS}"
echo "Both signed image digests are promoted to their release tags."
