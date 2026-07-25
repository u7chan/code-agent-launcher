#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_REPOSITORY='u7chan/code-agent-launcher'
readonly TAG_PATTERN='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

fail() {
  printf 'Release preflight failed: %s\n' "$1" >&2
  exit 1
}

if [[ $# -ne 1 || ! "$1" =~ $TAG_PATTERN ]]; then
  fail 'tag must be a strict stable SemVer in vX.Y.Z format'
fi
readonly tag="$1"

repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'run from inside a Git worktree'
cd "$repository_root"
[[ -f .github/workflows/release.yml ]] || fail 'release workflow is not present in this checkout'
[[ -z "$(git status --porcelain=v1)" ]] || fail 'worktree is not clean'
[[ "$(git branch --show-current)" == 'main' ]] || fail 'current branch is not main'

repository="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')" ||
  fail 'could not identify the GitHub repository'
readonly repository
[[ "$repository" == "$EXPECTED_REPOSITORY" ]] ||
  fail "repository is $repository, expected $EXPECTED_REPOSITORY"

is_expected_repository_url() {
  case "$1" in
    "https://github.com/$EXPECTED_REPOSITORY" | \
      "https://github.com/$EXPECTED_REPOSITORY.git" | \
      "git@github.com:$EXPECTED_REPOSITORY.git" | \
      "ssh://git@github.com/$EXPECTED_REPOSITORY.git") return 0 ;;
    *) return 1 ;;
  esac
}

mapfile -t origin_fetch_urls < <(git remote get-url --all origin 2>/dev/null)
[[ "${#origin_fetch_urls[@]}" -eq 1 ]] || fail 'could not identify exactly one origin fetch URL'
mapfile -t origin_push_urls < <(git remote get-url --push --all origin 2>/dev/null)
[[ "${#origin_push_urls[@]}" -eq 1 ]] || fail 'could not identify exactly one origin push URL'
readonly origin_fetch_urls origin_push_urls
is_expected_repository_url "${origin_fetch_urls[0]}" ||
  fail "origin fetch URL does not target $EXPECTED_REPOSITORY"
is_expected_repository_url "${origin_push_urls[0]}" ||
  fail "origin push URL does not target $EXPECTED_REPOSITORY"

git fetch --no-tags --prune origin '+refs/heads/main:refs/remotes/origin/main' >/dev/null

head_sha="$(git rev-parse HEAD)" || fail 'could not resolve HEAD'
main_sha="$(git rev-parse refs/heads/main)" || fail 'could not resolve local main'
origin_main_sha="$(git rev-parse refs/remotes/origin/main)" || fail 'could not resolve origin/main'
readonly head_sha main_sha origin_main_sha
[[ "$head_sha" == "$main_sha" && "$head_sha" == "$origin_main_sha" ]] ||
  fail 'HEAD, local main, and origin/main are not synchronized'
git cat-file -e "$head_sha:.github/workflows/release.yml" 2>/dev/null ||
  fail 'release workflow is not committed at the release commit'

package_version="$(node -e "const p=require('./package.json'); if(typeof p.version!=='string') process.exit(1); process.stdout.write(p.version)")" ||
  fail 'could not read package.json version'
readonly package_version
[[ "v$package_version" == "$tag" ]] ||
  fail "tag $tag does not match package.json version $package_version"
[[ "$package_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
  fail "package.json version is not a strict stable SemVer: $package_version"

if git show-ref --verify --quiet "refs/tags/$tag"; then
  fail "local tag already exists: $tag"
fi
set +e
remote_tag_output="$(git ls-remote --exit-code --tags origin "refs/tags/$tag" 2>&1)"
remote_tag_status=$?
set -e
case "$remote_tag_status" in
  0) fail "origin tag already exists: $tag" ;;
  2) ;;
  *) fail "could not verify origin tag absence: $remote_tag_output" ;;
esac

releases="$(gh api --paginate "repos/$repository/releases?per_page=100" \
  --jq ".[] | select(.tag_name == \"$tag\") | [.id, .draft, .html_url] | @tsv")" ||
  fail 'could not verify GitHub Release and draft absence'
readonly releases
[[ -z "$releases" ]] || fail "GitHub Release or draft already exists for $tag: $releases"

ci_runs="$(gh run list --repo "$repository" --workflow ci.yml --branch main --event push \
  --commit "$head_sha" --limit 100 \
  --json databaseId,headSha,status,conclusion,url,workflowName)" ||
  fail 'could not query main CI runs'
readonly ci_runs
ci_result="$(CI_RUNS="$ci_runs" EXPECTED_SHA="$head_sha" node - <<'NODE'
const runs = JSON.parse(process.env.CI_RUNS ?? '[]')
const run = runs.find((candidate) => candidate.headSha === process.env.EXPECTED_SHA)
if (run) {
  process.stdout.write([run.databaseId, run.status, run.conclusion ?? '', run.url].join('\t'))
}
NODE
)" || fail 'could not parse main CI runs'
readonly ci_result
[[ -n "$ci_result" ]] || fail "no main push CI run found for $head_sha"
IFS=$'\t' read -r ci_id ci_status ci_conclusion ci_url <<<"$ci_result"
[[ "$ci_status" == 'completed' && "$ci_conclusion" == 'success' ]] ||
  fail "main CI is not successful: id=$ci_id status=$ci_status conclusion=${ci_conclusion:-none} url=$ci_url"

printf 'Release preflight passed\n'
printf 'Version: %s\n' "$package_version"
printf 'Commit SHA: %s\n' "$head_sha"
printf 'CI result: %s (%s)\n' "$ci_conclusion" "$ci_url"
printf 'Planned tag: %s\n' "$tag"
printf 'No tag was created or pushed. Explicit approval is still required.\n'
