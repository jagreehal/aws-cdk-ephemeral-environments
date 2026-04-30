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

PREFILL_USER="${GH_USER:-$GIT_USER:-$SYSTEM_USER}"

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
echo "  Prefix:      $ENV_NAME (used in stack names)"
echo ""

read -p "Create this configuration? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 0
fi

# Check if config already exists
if jq -e ".$ENV_NAME" "$CONFIG_FILE" >/dev/null 2>&1; then
  echo "⚠️  Configuration for '$ENV_NAME' already exists in config.json"
  read -p "Overwrite? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
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
    "prefix": $env,
    "isPersistent": false,
    "useSsmConfig": false
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
echo "📦 Testing LocalStack (optional)..."

if docker ps 2>/dev/null | grep -q localstack-main; then
  if aws s3api list-buckets --endpoint-url=http://localhost:4566 --profile localstack >/dev/null 2>&1; then
    echo "✅ LocalStack is running and accessible"
  else
    echo "⚠️  LocalStack is running but not responding"
  fi
else
  echo "ℹ️  LocalStack not running. To start: docker-compose up -d"
fi

echo ""
echo "✨ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Deploy to AWS:"
echo "     npx cdk deploy --context env=$ENV_NAME"
echo ""
echo "  2. Or test with LocalStack:"
echo "     docker-compose up -d"
echo "     AWS_PROFILE=localstack npx cdk deploy --context env=$ENV_NAME"
echo ""
echo "  3. View deployment:"
echo "     make cdk-list"
echo ""
echo "  4. Cleanup when done:"
echo "     npx cdk destroy --context env=$ENV_NAME"
echo ""
