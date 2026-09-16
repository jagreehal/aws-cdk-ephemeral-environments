# CDK targets for local development and CI. Run `make` for the list.
#
# ENV is the environment name: `dev`, `prod`, `local`, or a CI-generated `pr-123-ab12` /
# `branch-foo-ab12`. It becomes the stack name (`<ENV>-ephemeral`) and the prefix of every
# resource in it.

SHELL := /bin/bash
.SHELLFLAGS := -e -o pipefail -c
.DEFAULT_GOAL := help

ENV ?= dev
# Prefixes CI uses for throwaway environments; `make list-envs` matches on these.
EPHEMERAL_PREFIXES := pr- branch-
# Written by every deploy; `make outputs` prints it, and CI posts it to the pull request.
OUTPUTS_FILE := cdk-outputs.json

##@ Getting started

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m [ENV=<environment>]\n"} \
	  /^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 } \
	  /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@printf "\nCurrent ENV: \033[36m$(ENV)\033[0m -> stack \033[36m$(ENV)-ephemeral\033[0m\n\n"

install: ## Install dependencies
	npm ci

setup: install ## Install, then configure a personal environment in config.json
	./scripts/setup-local-env.sh

##@ Develop

build: ## Typecheck (tsx runs the app, so there is nothing to emit)
	npm run build

test: ## Run the tests
	npm test

precheck: ## Typecheck, test and synth — the gate CI runs before deploying
	npm run precheck

##@ Local (MiniStack — no AWS account needed)

# cdklocal points the CDK toolkit at http://localhost:4566; the dummy credentials are what
# MiniStack expects, so no `~/.aws` profile setup is required.
LOCAL_ENV ?= local
LOCAL_AWS := AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1

local-up: ## Start MiniStack
	docker compose up -d --wait

local-down: ## Stop MiniStack
	docker compose down

local-deploy: local-up ## Start MiniStack, bootstrap and deploy — one command from nothing
	$(LOCAL_AWS) npx cdklocal bootstrap --context env=$(LOCAL_ENV)
	$(LOCAL_AWS) npx cdklocal deploy --require-approval never --context env=$(LOCAL_ENV) \
	  --outputs-file $(OUTPUTS_FILE)
	@printf "\n\033[1mDeployed \033[36m$(LOCAL_ENV)-ephemeral\033[0m\033[1m to MiniStack\033[0m\n"
	@$(MAKE) --no-print-directory outputs
	@printf "\nThe app container is running for real: \033[36mdocker ps\033[0m\n"
	@printf "The ALB deploys but routes nowhere locally — see README, Deploy Locally with MiniStack.\n\n"

local-destroy: ## Destroy the local stack
	$(LOCAL_AWS) npx cdklocal destroy --force --context env=$(LOCAL_ENV)

local-diff: ## Diff against the local stack
	$(LOCAL_AWS) npx cdklocal diff --context env=$(LOCAL_ENV)

local-reset: ## Wipe MiniStack state without restarting it
	curl -fsS -X POST http://localhost:4566/_ministack/reset && echo "MiniStack state reset"

local-stacks: ## List stacks deployed to MiniStack
	@$(LOCAL_AWS) aws --endpoint-url=http://localhost:4566 cloudformation describe-stacks \
	  --query 'Stacks[].[StackName,StackStatus]' --output table

##@ AWS

cdk-bootstrap: ## Bootstrap CDK in the target account/region
	npm run cdk:bootstrap -- --context env=$(ENV)

cdk-deploy: ## Deploy ENV to AWS
	npm run cdk:deploy -- --context env=$(ENV) --outputs-file $(OUTPUTS_FILE)
	@$(MAKE) --no-print-directory outputs

cdk-hot: ## Redeploy code-only changes faster
	npm run cdk:hot -- --context env=$(ENV)

cdk-destroy: ## Destroy ENV
	npm run cdk:destroy -- --context env=$(ENV)

cdk-diff: ## Preview changes to ENV
	npm run cdk:diff -- --context env=$(ENV)

cdk-synth: ## Synthesize CloudFormation for ENV
	npm run cdk:synth -- --context env=$(ENV)

outputs: ## Print the outputs of the last deploy
	@if [ -f $(OUTPUTS_FILE) ]; then \
	  jq -r 'to_entries[] | "\n  \(.key)", (.value | to_entries[] | "    \(.key): \(.value)")' $(OUTPUTS_FILE); \
	else \
	  echo "No $(OUTPUTS_FILE) yet — run a deploy first."; \
	fi

list-envs: ## List live ephemeral stacks in AWS (pr-*, branch-*)
	@aws cloudformation list-stacks \
	  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
	  | jq -r --arg prefixes "$(EPHEMERAL_PREFIXES)" \
	      '($$prefixes | split(" ")) as $$p | .StackSummaries[].StackName | select(. as $$n | $$p | any(. as $$x | $$n | startswith($$x)))' \
	  | sort -u

.PHONY: help install setup build test precheck
.PHONY: local-up local-down local-deploy local-destroy local-diff local-reset local-stacks
.PHONY: cdk-bootstrap cdk-deploy cdk-hot cdk-destroy cdk-diff cdk-synth outputs list-envs
