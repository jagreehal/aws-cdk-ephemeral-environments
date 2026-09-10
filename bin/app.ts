#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as path from 'node:path';
import { EphemeralStack } from '../lib/ephemeral-stack';
import { nameFor } from '../lib/constants';
import { loadConfigForEnv } from '../lib/loadConfigForEnv';

const app = new cdk.App();

const envName = app.node.tryGetContext('env') ?? 'dev';

try {
  const config = loadConfigForEnv(envName, path.resolve(__dirname, '../config.json'));

  new EphemeralStack(app, nameFor(envName), {
    env: { account: config.account, region: config.region },
    config,
    envName,
    appImage: app.node.tryGetContext('appImage'),
    containerPort: app.node.tryGetContext('containerPort'),
    desiredCount: app.node.tryGetContext('desiredCount'),
    dbInstanceClass: app.node.tryGetContext('dbInstanceClass'),
    dbAllocatedStorage: app.node.tryGetContext('dbAllocatedStorage'),
    alarmEmail: app.node.tryGetContext('alarmEmail'),
    terminationProtection: config.isProduction,
  });
} catch (error) {
  console.error(`Failed to load config for environment '${envName}':`, error);
  process.exit(1);
}

app.synth();
