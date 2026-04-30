# AWS CDK Ephemeral Environments

Automatically create and destroy temporary AWS environments for pull requests using AWS CDK and GitHub Actions.

## Overview

This project enables you to spin up isolated, ephemeral AWS environments for each pull request and automatically tear them down when the PR is closed. Each environment includes an S3 bucket configured with appropriate security settings, encryption, and removal policies.

**Key features:**

- 🚀 **Automatic deployment** on PR open via GitHub Actions
- 🧹 **Automatic cleanup** on PR close or scheduled daily
- 🔐 **OIDC authentication** (no long-lived AWS credentials)
- 📦 **Environment-aware configuration** (dev/staging/prod)
- 💾 **Persistent vs ephemeral** resource handling
- 🏗️ **Infrastructure as Code** using AWS CDK and TypeScript

## Quick Start

### 1. Prerequisites

- **Node.js** 20.x or later
- **AWS CLI** v2
- **Git** (with `user.name` configured)
- **GitHub CLI** (optional, for auto-prefilling GitHub username)
- **AWS Account(s)** with appropriate permissions
- **GitHub Repository** with Actions enabled

### 2. Clone and Install

```bash
git clone <repo-url>
cd aws-cdk-ephemeral-environments
npm ci
npm run build
```

### 3. Quick Setup for New Team Members

Let the setup script prefill everything from your system and AWS profile:

```bash
./scripts/setup-local-env.sh
```

This script intelligently prefills:

- **Username** from `whoami` → `git config user.name` → GitHub CLI
- **AWS Account & Region** from your current AWS credentials
- **Environment name** as the stack prefix (e.g., `user-jreehal`)

Then confirm or override any value:

```
🚀 Setting up ephemeral environment...
Environment name (prefilled: user-jreehal): [press Enter or type custom name]
🔍 Detecting AWS credentials from current profile...
📋 Summary:
  Environment: user-jreehal
  Account:     111111111111
  Region:      us-east-1
✅ Configuration saved!
```

Then deploy immediately:

```bash
npx cdk deploy --context env=user-jreehal
```

**That's it!** No manual config editing needed.

### 4. AWS Setup (One-Time Per Account)

**Expected time:** 15-20 minutes per account

#### Step 1: Create OIDC Identity Provider

Create an OpenID Connect provider for GitHub Actions:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

#### Step 2: Create GitHub Actions IAM Role

Create the IAM role that GitHub Actions will assume:

```bash
# Create trust policy
cat > /tmp/trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/YOUR_REPO:*"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:aud": "aws-sdk-nodejs:*"
        }
      }
    }
  ]
}
EOF

# Create the role
aws iam create-role \
  --role-name GitHubActionsRole \
  --assume-role-policy-document file:///tmp/trust-policy.json \
  --description "Role assumed by GitHub Actions for CDK deployments"
```

#### Step 3: Attach CDK Deployment Policy

Create and attach a policy with CDK deployment permissions:

```bash
cat > /tmp/cdk-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "sts:AssumeRole",
        "iam:GetRole",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "ecs:*",
        "rds:*",
        "s3:*",
        "kms:*",
        "secretsmanager:*",
        "ssm:*",
        "logs:*",
        "cloudwatch:*",
        "sns:*",
        "elasticloadbalancing:*",
        "route53:*",
        "ecr:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "resource-groups:CreateGroup",
        "resource-groups:DeleteGroup"
      ],
      "Resource": "*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name CDKDeploymentPolicy \
  --policy-document file:///tmp/cdk-policy.json

aws iam attach-role-policy \
  --role-name GitHubActionsRole \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/CDKDeploymentPolicy
```

#### Step 4: Bootstrap CDK

Bootstrap CDK in each target region:

```bash
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
npx cdk bootstrap aws://ACCOUNT_ID/us-west-2
```

#### Step 5: Configure GitHub Secrets

Add the following to your GitHub repository secrets:

| Secret Name      | Description                            |
| ---------------- | -------------------------------------- |
| `AWS_ACCOUNT_ID` | AWS account ID for deployment          |
| `ALARM_EMAIL`    | Email for CloudWatch alarms (optional) |

#### Step 6: Configure GitHub Variables

Add repository variables:

| Variable     | Value                              |
| ------------ | ---------------------------------- |
| `AWS_REGION` | Default region (e.g., `us-east-1`) |

#### VPC Considerations

The stack creates a new VPC with:

- 3 AZs (prod) or 2 AZs (ephemeral)
- Public, Private (with NAT), and Isolated subnets
- VPC endpoints for S3, DynamoDB, ECR, CloudWatch, Secrets Manager, and RDS
- VPC Flow Logs with 90-day retention

#### Security Best Practices

**Network Isolation**

- RDS instances are deployed in isolated subnets (no internet access)
- ECS tasks use private subnets with NAT for outbound
- ALB is public but restricts traffic via security groups

**Encryption**

- All S3 buckets use encryption (KMS for prod, S3-managed for ephemeral)
- RDS uses KMS encryption at rest
- CloudWatch Logs use KMS encryption

**Access Control**

- IAM permission boundaries limit role capabilities
- Security groups enforce least-privilege networking
- No public access to any resources

#### AWS Setup Cleanup

To remove all AWS resources created during setup:

```bash
# Delete the OIDC provider (after removing all role trust policies)
aws iam delete-open-id-connect-provider \
  --arn arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com

# Delete the deployment role
aws iam delete-role --role-name GitHubActionsRole

# Delete the policy
aws iam delete-policy --policy-arn arn:aws:iam::ACCOUNT_ID:policy/CDKDeploymentPolicy
```

### 5. Configure Project (If Not Using Setup Script)

Update `config.json` with your AWS account IDs:

```json
{
  "dev": {
    "account": "YOUR_DEV_ACCOUNT_ID",
    "region": "us-east-1",
    "isProduction": false,
    "prefix": "dev"
  },
  "staging": {
    "account": "YOUR_STAGING_ACCOUNT_ID",
    "region": "us-east-1",
    "isProduction": false,
    "prefix": "stage",
    "isPersistent": true
  },
  "prod": {
    "account": "YOUR_PROD_ACCOUNT_ID",
    "region": "us-east-1",
    "isProduction": true,
    "prefix": "prod",
    "isPersistent": true
  }
}
```

### 6. Test Locally with LocalStack (Optional)

For fast local testing without deploying to AWS:

```bash
# Start LocalStack and Step Functions (requires Docker)
docker-compose up -d

# Verify LocalStack is ready
aws s3api list-buckets --endpoint-url=http://localhost:4566 --profile localstack

# Build and deploy to LocalStack
npm run build
AWS_PROFILE=localstack npx cdk deploy --require-approval never

# Test your deployed resources
aws s3api list-buckets --endpoint-url=http://localhost:4566 --profile localstack
aws s3api head-bucket --bucket <bucket-name> --endpoint-url=http://localhost:4566 --profile localstack

# Destroy stack and cleanup
AWS_PROFILE=localstack npx cdk destroy
docker-compose down
```

**LocalStack Configuration:**

- **Setup:** Requires `.env` file with `LOCALSTACK_AUTH_TOKEN` (see `.env` in repo root)
- **AWS Profile:** `localstack` (credentials: `test`/`test`)
- **Account ID:** `000000000000` (LocalStack default)
- **Region:** `eu-west-1` (configurable in docker-compose.yml)
- **Endpoint:** `http://localhost:4566`

**Testing locally:**

1. Deploy stack: `AWS_PROFILE=localstack npx cdk deploy`
2. Verify S3: `aws s3api list-buckets --endpoint-url=http://localhost:4566 --profile localstack`
3. Check CloudFormation: `aws cloudformation list-stacks --endpoint-url=http://localhost:4566 --profile localstack`
4. Cleanup: `AWS_PROFILE=localstack npx cdk destroy`

**Differences from AWS:**

- ✅ Useful for fast iteration and schema validation
- ⚠️ LocalStack doesn't emulate all AWS services perfectly
- ⚠️ Some features (IAM policies, CloudWatch metrics) have limited support
- ✅ Great for testing infrastructure code before deploying to real AWS

### 7. Test Locally (Without LocalStack)

```bash
# Build the TypeScript
npm run build

# Synthesize CloudFormation for dev environment
npm run cdk -- synth --context env=dev

# Or use Makefile
make cdk-synth ENV=dev
```

## Local Development

### Available Commands

Use the **Makefile** for convenient DX:

```bash
# Install dependencies
make install

# Build TypeScript
make build

# Watch TypeScript for changes
make watch

# CDK operations
make cdk-bootstrap ENV=dev           # Bootstrap AWS account
make cdk-deploy ENV=dev              # Deploy stack
make cdk-destroy ENV=dev             # Destroy stack (removes all resources)
make cdk-diff ENV=dev                # Preview changes
make cdk-synth ENV=dev               # Generate CloudFormation
make cdk-list                        # List stacks
make list-envs                       # List ephemeral (PR) environments
```

Or use **npm scripts** directly:

```bash
npm run cdk:bootstrap -- --context env=dev
npm run cdk:deploy -- --context env=dev
npm run cdk:destroy -- --context env=dev   # Clean up everything
```

**Tip:** `make cdk-destroy ENV=dev` safely removes all resources including S3 buckets (for ephemeral environments) or retains them (for persistent environments per config).

## How It Works

### Local Development Flow

1. **Make changes** to your application
2. **Verify locally:** `make cdk-synth ENV=dev` (or with LocalStack)
3. **Test in AWS:** `make cdk-deploy ENV=dev`
4. **When done:** `make cdk-destroy ENV=dev` (removes all resources)

The Makefile makes it easy to iterate: build → deploy → test → destroy.

### GitHub Actions Flow

1. **Create feature branch** and push to GitHub
2. **Open a Pull Request**
3. ✅ **GitHub Actions automatically:**
   - Builds your code
   - Creates a new AWS stack: `MyAppStack-pr-<number>-<hash>`
   - Deploys to your AWS account
4. **Test your ephemeral environment** using the deployed S3 bucket and resources
5. **Close the PR**
6. ✅ **GitHub Actions automatically:**
   - Deletes the temporary CloudFormation stack
   - Removes all ephemeral resources
7. **Scheduled cleanup** (daily 3 AM ET) deletes any orphaned PR stacks

### Environment Names

Ephemeral environments are named based on the PR and branch:

- **Pull Requests:** `pr-<PR_NUMBER>-<HASH>`
  - Example: `pr-42-a3f7b1c2`
  - Cleaned up when PR is closed

- **Feature Branches:** `branch-<SANITIZED>-<HASH>`
  - Example: `branch-feature-login-d5e8f2a1`
  - Cleaned up by daily schedule or manual deletion

## Configuration

### config.json

Each environment can be configured with:

- **account**: 12-digit AWS account ID
- **region**: AWS region (us-east-1, us-west-2, eu-west-1, eu-west-2)
- **isProduction**: Set to `true` for production (enables KMS encryption, stricter security)
- **prefix**: Resource name prefix (used in bucket names, tags)
- **isPersistent**: If `true`, resources are retained on stack deletion (for prod/staging)

### Resource Behavior

**Ephemeral environments (dev, PR-based):**

- ❌ S3 buckets are **destroyed** on stack deletion
- ✅ Objects are **auto-deleted** before bucket removal
- 🔐 Encryption: S3-managed (standard)

**Persistent environments (staging, prod):**

- ✅ S3 buckets are **retained** on stack deletion (data protection)
- 🔐 Encryption: KMS-managed (production-grade)
- 🔒 All resources block public access and enforce SSL

## Deployment Workflow

### Step 1: First-Time AWS Setup (Per Account)

Complete the AWS setup steps outlined in the [AWS Setup](#4-aws-setup-one-time-per-account) section above if you haven't already. This includes:

- Creating an OIDC provider
- Setting up the `GitHubActionsRole` IAM role
- Bootstrapping CDK per region
- Adding GitHub secrets

### Step 2: Deploy Your Changes

```bash
# Create a PR
git checkout -b feature/my-feature
git commit -am "My changes"
git push -u origin feature/my-feature

# Open PR on GitHub
# ✅ GitHub Actions automatically deploys your environment
```

### Step 3: Test and Iterate

Visit AWS Console:

- **CloudFormation:** View your stack `MyAppStack-pr-<number>-<hash>`
- **S3:** Access your ephemeral bucket
- **CloudWatch:** Monitor deployment

### Step 4: Merge and Cleanup

```bash
# Close or merge the PR
# ✅ GitHub Actions automatically cleans up resources
```

## Troubleshooting

### "AssumeRole failed"

**Cause:** GitHub Actions can't assume the `GitHubActionsRole`

**Solution:**

1. Verify OIDC provider exists: `aws iam list-open-id-connect-providers`
2. Check trust policy: `aws iam get-role --role-name GitHubActionsRole`
3. Ensure `token.actions.githubusercontent.com:sub` matches `repo:YOUR_ORG/YOUR_REPO:*`
4. Verify the OIDC thumbprint matches in Step 1 of the AWS Setup section

### "CloudFormation bootstrap stack not found"

**Cause:** CDK hasn't been bootstrapped in the account/region

**Solution:**

```bash
export AWS_ACCOUNT_ID=YOUR_ACCOUNT_ID
export AWS_REGION=us-east-1
npx cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION}
```

### "S3 bucket already exists"

**Cause:** Bucket names must be globally unique; a previous deployment left a bucket

**Solution:**

1. Check AWS console for leftover buckets
2. Delete manually or by destroying the old stack:
   ```bash
   make cdk-destroy ENV=pr-XX-hash
   ```

### "Permission denied" during deployment

**Cause:** `GitHubActionsRole` lacks required permissions

**Solution:**

1. Verify the inline policy is attached: `aws iam get-role-policy --role-name GitHubActionsRole --policy-name CDKDeploymentPolicy`
2. Check CloudFormation events for detailed errors in AWS Console

## Learn More

- **AWS CDK Documentation:** https://docs.aws.amazon.com/cdk/
- **GitHub Actions:** https://docs.github.com/en/actions
- **AWS IAM OIDC:** https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html
- **S3 Best Practices:** https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html

## Support

For issues or questions:

1. Check [Troubleshooting](#troubleshooting) above
2. Check GitHub Actions workflow logs for deployment errors
3. Review CloudFormation events in AWS Console for stack failures

## License

MIT License — see [LICENSE](LICENSE) file for details.

Copyright © 2026 [jagreehal](https://github.com/jagreehal)
