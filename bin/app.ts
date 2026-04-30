#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as path from 'node:path';
import { EphemeralStack } from '../lib/my-app-stack';
import { loadConfigForEnv } from '../lib/loadConfigForEnv';

async function main() {
  const app = new cdk.App();

  const envName = app.node.tryGetContext('env') ?? 'dev';
  const appImage = app.node.tryGetContext('appImage') ?? 'public.ecr.aws/nginx/nginx:alpine';
  const containerPort = app.node.tryGetContext('containerPort') ?? 80;
  const desiredCount = app.node.tryGetContext('desiredCount') ?? 2;
  const dbInstanceClass = app.node.tryGetContext('dbInstanceClass') ?? 'db.t3.micro';
  const dbAllocatedStorage = app.node.tryGetContext('dbAllocatedStorage') ?? 20;
  const alarmEmail = app.node.tryGetContext('alarmEmail');
  const configPath = path.resolve(__dirname, '../config.json');

  try {
    const config = await loadConfigForEnv(envName, configPath);

    new EphemeralStack(app, `EphemeralStack-${envName}`, {
      env: { account: config.account, region: config.region },
      config,
      stackEnvName: envName,
      appImage,
      containerPort,
      desiredCount,
      dbInstanceClass,
      dbAllocatedStorage,
      alarmEmail,
      terminationProtection: config.isProduction,
    });
  } catch (error) {
    console.error(`Failed to load config for environment '${envName}':`, error);
    process.exit(1);
  }

  app.synth();
}

main();