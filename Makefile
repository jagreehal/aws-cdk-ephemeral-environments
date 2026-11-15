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

##@ Local (AWS Emulator — no AWS account needed)

# The emulator writes its own credentials, config and CA cert to ~/.aws/emulator/<port> on start;
# these point the CDK toolkit and AWS CLI at them. The unset stops a real profile or keys winning.
LOCAL_ENV ?= local
# docker-compose.yml runs the emulator as you, so the files it writes on Linux are yours.
export EMULATOR_UID := $(shell id -u)
export EMULATOR_GID := $(shell id -g)
EMULATOR_DIR := $(HOME)/.aws/emulator/9297
LOCAL_AWS := unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; \
  AWS_ENDPOINT_URL=https://127.0.0.1:9297 AWS_REGION=us-east-1 \
  AWS_CONFIG_FILE=$(EMULATOR_DIR)/config \
  AWS_SHARED_CREDENTIALS_FILE=$(EMULATOR_DIR)/emulator_credentials \
  NODE_EXTRA_CA_CERTS=$(EMULATOR_DIR)/ca.pem

local-up: ## Start AWS Emulator (builds its image the first time)
	mkdir -p $(HOME)/.aws/emulator
	docker compose up -d --build --wait

local-down: ## Stop AWS Emulator (it keeps state in memory, so this wipes everything)
	docker compose down

local-deploy: local-up ## Start the emulator, bootstrap and deploy — one command from nothing
	$(LOCAL_AWS) npx cdk bootstrap --context env=$(LOCAL_ENV)
	$(LOCAL_AWS) npx cdk deploy --require-approval never --context env=$(LOCAL_ENV) \
	  --outputs-file $(OUTPUTS_FILE)
	@printf "\n\033[1mDeployed \033[36m$(LOCAL_ENV)-ephemeral\033[0m\033[1m to AWS Emulator\033[0m\n"
	@$(MAKE) --no-print-directory outputs

local-destroy: ## Destroy the local stack
	$(LOCAL_AWS) npx cdk destroy --force --context env=$(LOCAL_ENV)

local-diff: ## Diff against the local stack
	$(LOCAL_AWS) npx cdk diff --context env=$(LOCAL_ENV)

local-reset: ## Wipe all emulator state (restarts it; state lives in memory)
	docker compose restart
	docker compose up -d --wait

local-stacks: ## List stacks deployed to the emulator
	@$(LOCAL_AWS) aws cloudformation describe-stacks \
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
