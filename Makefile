# CDK targets for local development and CI.
# Usage: make <target> ENV=<environment>
#
# ENV is the environment name: `dev`, `prod`, or a CI-generated `pr-123-ab12` / `branch-foo-ab12`.
# It becomes the stack name (`<ENV>-ephemeral`) and the prefix of every resource in it.

SHELL := /bin/bash
.SHELLFLAGS := -e -o pipefail -c

ENV ?= dev
# Prefixes CI uses for throwaway environments; `make list-envs` and `clean-envs` match on these.
EPHEMERAL_PREFIXES := pr- branch-

install:
	npm ci

build:
	npm run build

test:
	npm test

# Typecheck, test and synth — the same gate CI runs before deploying.
precheck:
	npm run precheck

cdk-bootstrap:
	npm run cdk:bootstrap -- --context env=$(ENV)

cdk-deploy:
	npm run cdk:deploy -- --context env=$(ENV)

# Faster redeploy for code-only changes.
cdk-hot:
	npm run cdk:hot -- --context env=$(ENV)

cdk-destroy:
	npm run cdk:destroy -- --context env=$(ENV)

cdk-diff:
	npm run cdk:diff -- --context env=$(ENV)

cdk-list:
	npm run cdk:list -- --context env=$(ENV)

cdk-synth:
	npm run cdk:synth -- --context env=$(ENV)

## Local development against MiniStack (https://ministack.org) — no AWS account needed.
# cdklocal is the CDK wrapper that points the toolkit at http://localhost:4566; the dummy
# credentials below are what MiniStack expects, so no `~/.aws` profile setup is required.
LOCAL_ENV ?= local
LOCAL_AWS := AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1

local-up:
	docker compose up -d --wait

local-down:
	docker compose down

# One command from nothing to a deployed stack: start MiniStack, bootstrap, deploy.
local-deploy: local-up
	$(LOCAL_AWS) npx cdklocal bootstrap --context env=$(LOCAL_ENV)
	$(LOCAL_AWS) npx cdklocal deploy --require-approval never --context env=$(LOCAL_ENV)

local-destroy:
	$(LOCAL_AWS) npx cdklocal destroy --force --context env=$(LOCAL_ENV)

local-diff:
	$(LOCAL_AWS) npx cdklocal diff --context env=$(LOCAL_ENV)

# Wipe MiniStack state without restarting the container.
local-reset:
	curl -fsS -X POST http://localhost:4566/_ministack/reset && echo "MiniStack state reset"

# What actually got created locally.
local-stacks:
	@$(LOCAL_AWS) aws --endpoint-url=http://localhost:4566 cloudformation describe-stacks \
	  --query 'Stacks[].[StackName,StackStatus]' --output table

# List live ephemeral stacks (deployed as `<env>-ephemeral`, so the env prefix leads).
list-envs:
	@aws cloudformation list-stacks \
	  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
	  | jq -r --arg prefixes "$(EPHEMERAL_PREFIXES)" \
	      '($$prefixes | split(" ")) as $$p | .StackSummaries[].StackName | select(. as $$n | $$p | any(. as $$x | $$n | startswith($$x)))' \
	  | sort -u

.PHONY: local-up local-down local-deploy local-destroy local-diff local-reset local-stacks
.PHONY: install build test precheck cdk-bootstrap cdk-deploy cdk-hot cdk-destroy cdk-diff cdk-list cdk-synth list-envs
