#!/bin/bash
set -e

# Setup script for new team members
# Prefills user info from whoami, git config, and GitHub CLI
# Uses current AWS profile to get account & region

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/config.json"

echo "🚀 Setting up ephemeral environment for local development..."
echo ""

# Prefill username from whoami, git config, or GitHub CLI
SYSTEM_USER=$(whoami)
GIT_USER=$(git config user.name 2>/dev/null || echo "")
GH_USER=$(gh api user --jq '.login' 2>/dev/null || echo "")

PREFILL_USER="$GH_USER"
[ -z "$PREFILL_USER" ] && PREFILL_USER="$GIT_USER"
[ -z "$PREFILL_USER" ] && PREFILL_USER="$SYSTEM_USER"
# Stack names allow letters, digits and hyphens only, so a git name like "Jag Reehal" needs a scrub.
PREFILL_USER=$(echo "$PREFILL_USER" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')

read -p "Environment name (prefilled: user-$PREFILL_USER): " ENV_INPUT
ENV_NAME="${ENV_INPUT:-user-$PREFILL_USER}"

echo ""
echo "🔍 Detecting AWS credentials from current profile..."

# Get AWS account and region from current profile
PREFILL_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
PREFILL_REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")

if [ -z "$PREFILL_ACCOUNT" ]; then
  echo "❌ Could not detect AWS account. Make sure AWS credentials are configured."
  exit 1
fi

read -p "AWS Account (prefilled: $PREFILL_ACCOUNT): " ACCOUNT_INPUT
AWS_ACCOUNT="${ACCOUNT_INPUT:-$PREFILL_ACCOUNT}"

read -p "AWS Region (prefilled: $PREFILL_REGION): " REGION_INPUT
AWS_REGION_FINAL="${REGION_INPUT:-$PREFILL_REGION}"

echo ""
echo "📋 Summary:"
echo "  Environment: $ENV_NAME"
echo "  Account:     $AWS_ACCOUNT"
echo "  Region:      $AWS_REGION_FINAL"
echo "  Stack:       $ENV_NAME-ephemeral"
echo ""

read -p "Create this configuration? (Y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
  echo "Cancelled."
  exit 0
fi

# Check if config already exists
if jq -e ".$ENV_NAME" "$CONFIG_FILE" >/dev/null 2>&1; then
  echo "⚠️  Configuration for '$ENV_NAME' already exists in config.json"
  read -p "Overwrite? (Y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

# Add/update config entry
NEW_CONFIG=$(jq \
  --arg env "$ENV_NAME" \
  --arg account "$AWS_ACCOUNT" \
  --arg region "$AWS_REGION_FINAL" \
  '.[$env] = {
    "account": $account,
    "region": $region,
    "isProduction": false,
    "isPersistent": false
  }' "$CONFIG_FILE")

echo "$NEW_CONFIG" > "$CONFIG_FILE"
echo "✅ Configuration saved to config.json"

echo ""
echo "🔍 Verifying AWS credentials..."

ACTUAL_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
if [ "$ACTUAL_ACCOUNT" == "$AWS_ACCOUNT" ]; then
  echo "✅ AWS credentials verified (account: $ACTUAL_ACCOUNT)"
else
  echo "⚠️  Warning: Account mismatch (configured: $AWS_ACCOUNT, actual: $ACTUAL_ACCOUNT)"
fi

echo ""
echo "✨ Setup complete!"
echo ""
echo "Next steps:"
echo "  Deploy to AWS:       make cdk-deploy ENV=$ENV_NAME"
echo "  Preview changes:     make cdk-diff ENV=$ENV_NAME"
echo "  Clean up when done:  make cdk-destroy ENV=$ENV_NAME"
echo ""
echo "  No AWS account handy? MiniStack runs the whole stack locally:"
echo "                       make local-deploy"
echo ""
echo "  Run 'make' to see everything."
echo ""
