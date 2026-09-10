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

  // Also a Lambda-backed custom resource MiniStack cannot complete; off before the stack is built.
  if (config.isLocal) {
    app.node.setContext('@aws-cdk/aws-ec2:restrictDefaultSecurityGroup', false);
  }

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
  // A config problem is a typo, not a crash: print what is wrong and what to do, not a stack trace
  // through the CDK toolkit. Anything else is a real bug and should keep its trace.
  if (!(error instanceof Error)) {
    throw error;
  }

  console.error(`\n  Cannot deploy environment '${envName}'\n`);
  console.error(`  ${error.message}\n`);
  console.error('  Fix config.json, or run `make setup` to add an environment for yourself.\n');
  process.exit(1);
}

app.synth();
