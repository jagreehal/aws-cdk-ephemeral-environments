# CDK Makefile for AWS Ephemeral Environments
# Provides convenient targets for local development and CI/CD deployment
# Usage: make [target] ENV=<environment> AWS_REGION=<region>

SHELL := /bin/bash
.SHELLFLAGS := -e -o pipefail -c

ENV ?= dev
AWS_REGION ?= us-east-1

install:
	npm ci

build:
	npm run build

watch:
	npm run watch

cdk:
	npm run cdk

cdk-bootstrap:
	npm run cdk:bootstrap -- --context env=$(ENV)

cdk-deploy:
	npm run cdk:deploy -- --context env=$(ENV)

# Deploy with hotswap mode (faster for certain resource changes)
cdk-hot:
	npm run cdk:hot -- --context env=$(ENV)

cdk-destroy:
	npm run cdk:destroy -- --context env=$(ENV)

cdk-diff:
	npm run cdk:diff -- --context env=$(ENV)

cdk-list:
	npm run cdk:list

cdk-synth:
	npm run cdk:synth -- --context env=$(ENV)

cdk-docs:
	npm run cdk -- docs

# List all ephemeral (PR) stacks in CloudFormation
list-envs:
	aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
	  | jq -r '.StackSummaries[] | select(.StackName | starts_with("pr-")) | .StackName' \
	  | sort -u

.PHONY: install build watch cdk cdk-bootstrap cdk-deploy cdk-hot cdk-destroy cdk-diff cdk-list cdk-synth cdk-docs list-envs
