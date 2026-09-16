#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as path from 'node:path';
import { EphemeralStack } from '../lib/ephemeral-stack';
import { nameFor } from '../lib/constants';
import { numberContext } from '../lib/context';
import { loadConfigForEnv, type Config } from '../lib/loadConfigForEnv';

const app = new cdk.App();

const envName = app.node.tryGetContext('env') ?? 'dev';

let config: Config;

try {
  config = loadConfigForEnv(envName, path.resolve(__dirname, '../config.json'));
} catch (error) {
  // A config problem is a typo, not a crash: print what is wrong and what to do, not a stack trace
  // through the CDK toolkit. Only config loading is caught here — anything thrown while building
  // the stack is a real bug and keeps its trace.
  if (!(error instanceof Error)) {
    throw error;
  }

  console.error(`\n  Cannot deploy environment '${envName}'\n`);
  console.error(`  ${error.message}\n`);
  console.error('  Fix config.json, or run `make setup` to add an environment for yourself.\n');
  process.exit(1);
}

// Also a Lambda-backed custom resource MiniStack cannot complete; off before the stack is built.
if (config.isLocal) {
  app.node.setContext('@aws-cdk/aws-ec2:restrictDefaultSecurityGroup', false);
}

new EphemeralStack(app, nameFor(envName), {
  env: { account: config.account, region: config.region },
  config,
  envName,
  appImage: app.node.tryGetContext('appImage'),
  containerPort: numberContext(app.node, 'containerPort'),
  desiredCount: numberContext(app.node, 'desiredCount'),
  dbInstanceClass: app.node.tryGetContext('dbInstanceClass'),
  dbAllocatedStorage: numberContext(app.node, 'dbAllocatedStorage'),
  healthCheckPath: app.node.tryGetContext('healthCheckPath'),
  alarmEmail: app.node.tryGetContext('alarmEmail'),
  terminationProtection: config.isProduction,
});

app.synth();
