# AWS CDK Ephemeral Environments

Automatically create and destroy temporary AWS environments for pull requests using AWS CDK and GitHub Actions.

## Overview

This project enables you to spin up isolated, ephemeral AWS environments for each pull request and automatically tear them down when the PR is closed. Each environment is a VPC with an ECS Fargate service behind an Application Load Balancer, an RDS Postgres instance, an S3 bucket and KMS keys, plus CloudWatch alarms and a dashboard.

```bash
make                # every target, grouped, with the current ENV
make local-deploy   # the whole stack on your laptop — no AWS account (MiniStack)
```

Deploying to AWS instead:

```bash
make setup                    # one-time: adds an environment for you to config.json
make cdk-deploy ENV=user-you  # prints the load balancer URL when it finishes
make cdk-destroy ENV=user-you
```

Or open a pull request: CI deploys an environment and comments its URL on the PR, redeploys on
every push, and destroys it when the PR closes.

**Key features:**

- 🚀 **Automatic deployment** on PR open via GitHub Actions
- 🧹 **Automatic cleanup** on PR close or scheduled daily
- 🔐 **OIDC authentication** (no long-lived AWS credentials)
- 📦 **Environment-aware configuration** (dev/staging/prod)
- 💾 **Persistent vs ephemeral** resource handling
- 💻 **Local deploys** against [MiniStack](https://ministack.org) — no AWS account needed
- 🏗️ **Infrastructure as Code** using AWS CDK and TypeScript

## Quick Start

### 1. Prerequisites

- **Node.js** 22.x or later
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
npm run precheck   # typecheck, test, synth
```

### 3. Quick Setup for New Team Members

Let the setup script prefill everything from your system and AWS profile:

```bash
make setup
```

This script intelligently prefills:

- **Username** from `whoami` → `git config user.name` → GitHub CLI
- **AWS Account & Region** from your current AWS credentials
- **Environment name**, which names the stack and every resource in it (e.g. `user-jreehal`)

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
- Gateway VPC endpoints for S3 and DynamoDB (interface endpoints are billed per AZ per hour, so an env that lives for one PR uses the NAT gateway instead)
- VPC Flow Logs with 1-week retention

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
  "default": {
    "account": "YOUR_DEV_ACCOUNT_ID",
    "region": "us-east-1",
    "isProduction": false,
    "isPersistent": false
  },
  "staging": {
    "account": "YOUR_STAGING_ACCOUNT_ID",
    "isPersistent": true
  },
  "prod": {
    "account": "YOUR_PROD_ACCOUNT_ID",
    "isProduction": true,
    "isPersistent": true
  }
}
```

Named entries merge over `default`, and **any environment without an entry gets `default`** — which
is how every CI-generated `pr-123-ab12` environment resolves without touching this file.
`CDK_DEFAULT_ACCOUNT` overrides the account, so CI never needs a real account ID committed here.

### 6. Deploy Locally with MiniStack (Optional)

[MiniStack](https://ministack.org) emulates AWS on `http://localhost:4566`, so the whole stack can
be deployed on a laptop with no AWS account. `cdklocal` is the CDK wrapper that points the toolkit
at it ([docs](https://ministack.org/docs/iac#cdk)).

```bash
make local-deploy     # starts MiniStack, bootstraps, deploys the `local` environment
make local-stacks     # what got created
make local-destroy    # tear the stack down
make local-down       # stop MiniStack
make local-reset      # wipe all MiniStack state without restarting it
```

`make local-deploy` takes about a minute the first time (image pull) and a few seconds after that.
It deploys the environment named `local`, whose config entry carries `"isLocal": true`.

**What runs locally.** MiniStack provisions real Docker containers for ECS tasks, so the app
container actually runs — `docker ps` shows it, and `aws --endpoint-url=http://localhost:4566 ecs
list-tasks --cluster local-ephemeral-ecs` lists the task. The VPC, subnets, security groups, ALB,
target group, S3 bucket, KMS keys, IAM roles, log groups, alarms and dashboard are all created.

**What local mode leaves out.** MiniStack's CloudFormation engine covers a subset of AWS, and it
rejects a template up front if it contains a resource type it does not implement. `isLocal` trims
the stack to what deploys:

| Left out locally | Why |
| --- | --- |
| NAT gateway + EIP (private subnets become isolated) | no `AWS::EC2::NatGateway` / `AWS::EC2::EIP` |
| VPC flow logs | no `AWS::EC2::FlowLog` |
| RDS instance, its secret and subnet group | no `AWS::RDS::DBSubnetGroup`, which CDK always creates for a VPC-placed instance |
| ALB → task registration (the ALB deploys but routes nowhere) | attaching makes CDK emit a standalone `AWS::EC2::SecurityGroupIngress` |
| S3 auto-delete and default-SG restriction | Lambda-backed custom resources whose CloudFormation response never arrives |

None of this affects a real AWS deploy — see the "leaves the AWS deploy untouched" test.

### 7. Synthesize Without Deploying

```bash
# Typecheck
npm run build

# Synthesize CloudFormation for dev environment
npm run cdk -- synth --context env=dev

# Or use Makefile
make cdk-synth ENV=dev
```

## Local Development

### Available Commands

`make` on its own lists every target, grouped, and shows which environment it will act on:

```bash
make                       # the list
make ENV=pr-42-a3f7b1c2    # the list, with that environment as the target
```

Everything routes through it — `make setup`, `make test`, `make precheck`, `make local-deploy`,
`make cdk-deploy ENV=…`, `make outputs`, `make list-envs`. The npm scripts underneath still work if
you prefer them:

```bash
npm run cdk:deploy -- --context env=dev
npm run cdk:destroy -- --context env=dev
```

**Tip:** `make cdk-destroy ENV=dev` safely removes all resources including S3 buckets (for ephemeral environments) or retains them (for persistent environments per config).

## How It Works

### Local Development Flow

1. **Make changes** to your application
2. **Verify locally:** `make cdk-synth ENV=dev`, or deploy for real with `make local-deploy`
3. **Test in AWS:** `make cdk-deploy ENV=dev`
4. **When done:** `make cdk-destroy ENV=dev` (removes all resources)

The Makefile makes it easy to iterate: build → deploy → test → destroy.

### GitHub Actions Flow

1. **Create feature branch** and push to GitHub
2. **Open a Pull Request**
3. ✅ **GitHub Actions automatically:**
   - Builds your code
   - Typechecks, tests and synths, then creates the stack `pr-<number>-<hash>-ephemeral`
   - Deploys to your AWS account
4. **Test your ephemeral environment** using the deployed S3 bucket and resources
5. **Close the PR**
6. ✅ **GitHub Actions automatically:**
   - Deletes the temporary CloudFormation stack
   - Removes all ephemeral resources
   - Edits the PR comment to say the environment is gone, so no dead link is left behind
7. **Scheduled cleanup** (daily 03:00 UTC) deletes any orphaned `pr-` / `branch-` stacks

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

- **account**: 12-digit AWS account ID (overridden by `CDK_DEFAULT_ACCOUNT` when set)
- **region**: AWS region (us-east-1, us-west-2, eu-west-1, eu-west-2 — override the list with `VALID_REGIONS`)
- **isProduction**: `true` for production (multi-AZ RDS, KMS encryption, termination protection)
- **isPersistent**: `true` to retain resources on stack deletion (staging/prod)
- **isLocal**: `true` for the MiniStack environment — trims the stack to what MiniStack's
  CloudFormation engine implements (see [Deploy Locally with MiniStack](#6-deploy-locally-with-ministack-optional))

Names come from the environment name alone: env `pr-42-a3f7b1c2` deploys the stack
`pr-42-a3f7b1c2-ephemeral` and names its resources `pr-42-a3f7b1c2-ephemeral-*`. Because the stack
name starts with the environment name, `make list-envs` and the cleanup workflow can find every
ephemeral stack by its `pr-` / `branch-` prefix.

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

- **CloudFormation:** View your stack `pr-<number>-<hash>-ephemeral`
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
