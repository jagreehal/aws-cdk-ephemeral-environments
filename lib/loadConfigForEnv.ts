import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Config {
  account: string;
  region: string;
  isProduction: boolean;
  prefix: string;
  isPersistent?: boolean;
  useSsmConfig?: boolean;
}

export async function loadConfigForEnv(env: string, configPath: string): Promise<Config> {
  let configData: Record<string, Config>;

  try {
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    configData = JSON.parse(fileContent) as Record<string, Config>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Configuration file contains invalid JSON: ${configPath}`);
    }
    throw new Error(`Failed to read configuration file at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const config = configData[env];

  if (!config) {
    throw new Error(`Configuration for environment '${env}' not found in ${configPath}.`);
  }

  if (!config.account || !config.account.trim()) {
    throw new Error('Configuration account is missing or empty.');
  }

  if (!/^\d{12}$/.test(config.account)) {
    const ssmValue = process.env[`SSM_ACCOUNT_${env.toUpperCase()}`];
    if (ssmValue && /^\d{12}$/.test(ssmValue)) {
      config.account = ssmValue;
    } else {
      throw new Error('Invalid AWS account ID: must be a 12-digit numeric string.');
    }
  }

  if (!config.region || !config.region.trim()) {
    throw new Error('Configuration region is missing or empty.');
  }

  const allowedRegions = process.env.VALID_REGIONS
    ? process.env.VALID_REGIONS.split(',').map((r: string) => r.trim())
    : ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-west-2'];

  if (!allowedRegions.includes(config.region)) {
    throw new Error(
      `Unsupported region '${config.region}'. Allowed regions: ${allowedRegions.join(', ')}`,
    );
  }

  return config;
}