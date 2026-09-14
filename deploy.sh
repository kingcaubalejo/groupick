#!/usr/bin/env bash
# Deploy the built Angular app to an S3 bucket configured for website hosting.
# Usage:
#   ./deploy.sh                          # build + sync files to the bucket
#   ./deploy.sh --setup                  # create bucket + configure + build + upload
#   ./deploy.sh --dry-run                # preview which files would upload
#   ./deploy.sh --skip-build             # sync existing dist/ without rebuilding
#   ./deploy.sh --profile <name>         # use a named AWS profile
#   ./deploy.sh --setup --profile foo    # flags combine in any order
#
# Configure via env vars (or edit defaults below):
#   BUCKET   S3 bucket name (must be globally unique)
#   REGION   AWS region
#   PROFILE  Named AWS profile (default: exam-devops)

set -euo pipefail

BUCKET="${BUCKET:-groupick.thelawrence.site}"
REGION="${REGION:-ap-southeast-1}"
PROFILE="${PROFILE:-exam-devops}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$PROJECT_DIR/dist/pickone/browser"

# -- arg parsing -------------------------------------------------------------

MODE="sync"
SKIP_BUILD="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup)      MODE="setup"; shift ;;
    --dry-run)    MODE="dry-run"; shift ;;
    --skip-build) SKIP_BUILD="true"; shift ;;
    --profile)
      [[ -z "${2:-}" ]] && { echo "error: --profile requires a value" >&2; exit 1; }
      PROFILE="$2"; shift 2 ;;
    --profile=*)
      PROFILE="${1#--profile=}"; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "error: unknown arg '$1'. Try --help" >&2; exit 1 ;;
  esac
done

PROFILE_ARG=()
[[ -n "$PROFILE" ]] && PROFILE_ARG=(--profile "$PROFILE")

# -- helpers -----------------------------------------------------------------

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' not found on PATH" >&2; exit 1; }
}

bucket_exists() {
  aws "${PROFILE_ARG[@]}" s3api head-bucket --bucket "$BUCKET" 2>/dev/null
}

setup_bucket() {
  echo "→ creating bucket $BUCKET in $REGION"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws "${PROFILE_ARG[@]}" s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws "${PROFILE_ARG[@]}" s3api create-bucket \
      --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi

  echo "→ disabling block-public-access"
  aws "${PROFILE_ARG[@]}" s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

  echo "→ enabling static website hosting (SPA fallback to index.html)"
  aws "${PROFILE_ARG[@]}" s3 website "s3://$BUCKET/" \
    --index-document index.html \
    --error-document index.html

  echo "→ applying public-read bucket policy"
  local policy
  policy=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicRead",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/*"
  }]
}
EOF
)
  aws "${PROFILE_ARG[@]}" s3api put-bucket-policy --bucket "$BUCKET" --policy "$policy"

  echo "✓ bucket setup complete"
}

build_app() {
  echo "→ building Angular app (production)"
  ( cd "$PROJECT_DIR" && npm run build )
  [[ -d "$DIST_DIR" ]] || { echo "error: expected build output at $DIST_DIR" >&2; exit 1; }
}

sync_files() {
  local dry=("$@")
  echo "→ syncing $DIST_DIR → s3://$BUCKET/"

  # index.html: short cache so new deploys are picked up quickly
  aws "${PROFILE_ARG[@]}" s3 sync "$DIST_DIR/" "s3://$BUCKET/" \
    "${dry[@]}" \
    --delete \
    --exclude "*" \
    --include "index.html" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/html; charset=utf-8"

  # Fingerprinted JS/CSS: safe to cache aggressively (hash changes on rebuild)
  aws "${PROFILE_ARG[@]}" s3 sync "$DIST_DIR/" "s3://$BUCKET/" \
    "${dry[@]}" \
    --exclude "*" \
    --include "*.js" --include "*.css" \
    --cache-control "public, max-age=31536000, immutable"

  # Everything else (favicon, images, fonts, etc.)
  aws "${PROFILE_ARG[@]}" s3 sync "$DIST_DIR/" "s3://$BUCKET/" \
    "${dry[@]}" \
    --exclude "index.html" \
    --exclude "*.js" --exclude "*.css" \
    --cache-control "public, max-age=86400"
}

# -- main --------------------------------------------------------------------

require_cmd aws

echo "→ using profile: ${PROFILE:-<default>}"
echo "→ bucket:        $BUCKET"
echo "→ region:        $REGION"
echo

case "$MODE" in
  setup)
    if bucket_exists; then
      echo "bucket $BUCKET already exists — skipping create; re-applying config"
    fi
    setup_bucket
    [[ "$SKIP_BUILD" == "true" ]] || { require_cmd npm; build_app; }
    sync_files
    ;;
  dry-run)
    [[ "$SKIP_BUILD" == "true" ]] || { require_cmd npm; build_app; }
    sync_files --dryrun
    ;;
  sync)
    if ! bucket_exists; then
      echo "error: bucket $BUCKET doesn't exist. Run: $0 --setup" >&2
      exit 1
    fi
    [[ "$SKIP_BUILD" == "true" ]] || { require_cmd npm; build_app; }
    sync_files
    ;;
esac

echo
echo "✓ deployed"
echo "  http://$BUCKET.s3-website-$REGION.amazonaws.com"
