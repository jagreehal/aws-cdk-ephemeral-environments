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

# List live ephemeral stacks (deployed as `<env>-ephemeral`, so the env prefix leads).
list-envs:
	@aws cloudformation list-stacks \
	  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
	  | jq -r --arg prefixes "$(EPHEMERAL_PREFIXES)" \
	      '($$prefixes | split(" ")) as $$p | .StackSummaries[].StackName | select(. as $$n | $$p | any(. as $$x | $$n | startswith($$x)))' \
	  | sort -u

.PHONY: install build test precheck cdk-bootstrap cdk-deploy cdk-hot cdk-destroy cdk-diff cdk-list cdk-synth list-envs
