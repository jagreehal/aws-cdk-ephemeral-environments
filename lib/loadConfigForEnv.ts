import * as fs from 'node:fs';

export interface Config {
  account: string;
  region: string;
  isProduction: boolean;
  /** Keep resources on stack delete. Ephemeral envs (the default) are destroyed with the stack. */
  isPersistent?: boolean;
  /**
   * Deploying to MiniStack (http://localhost:4566) rather than AWS. Its CloudFormation engine
   * covers most of this stack but not NAT gateways, EIPs, flow logs, standalone security-group
   * ingress, RDS subnet groups or secret target attachments, so local mode trims to the subset
   * that deploys: no NAT, no flow logs, inline SG rules, and no RDS. See README "Local".
   */
  isLocal?: boolean;
}

const ACCOUNT_PATTERN = /^\d{12}$/;

/**
 * Resolve config for `env` from `configPath`.
 *
 * Named entries (dev/staging/prod) merge over a `default` entry, and an env with no entry at all
 * — every `pr-123-ab12` / `branch-foo-ab12` environment CI invents — gets the defaults. Without
 * that fallback no ephemeral deploy could ever load config, which is the point of the repo.
 */
export function loadConfigForEnv(env: string, configPath: string): Config {
  let configData: Record<string, Partial<Config>>;

  try {
    configData = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, Partial<Config>>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Configuration file contains invalid JSON: ${configPath}`);
    }
    throw new Error(
      `Failed to read configuration file at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const { default: defaults, [env]: named } = configData;

  if (!defaults && !named) {
    throw new Error(
      `No configuration for environment '${env}' and no 'default' entry in ${configPath}.`,
    );
  }

  const config = { ...defaults, ...named } as Config;

  // CI never knows the account up front, so an env var wins over a placeholder in the file.
  const account = process.env.CDK_DEFAULT_ACCOUNT?.trim() || config.account?.trim();

  if (!account) {
    throw new Error('Configuration account is missing: set it in config.json or CDK_DEFAULT_ACCOUNT.');
  }

  if (!ACCOUNT_PATTERN.test(account)) {
    throw new Error(`Invalid AWS account ID '${account}': must be a 12-digit numeric string.`);
  }

  const region = config.region?.trim();

  if (!region) {
    throw new Error('Configuration region is missing or empty.');
  }

  const allowedRegions = process.env.VALID_REGIONS
    ? process.env.VALID_REGIONS.split(',').map((r) => r.trim())
    : ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-west-2'];

  if (!allowedRegions.includes(region)) {
    throw new Error(
      `Unsupported region '${region}'. Allowed regions: ${allowedRegions.join(', ')}`,
    );
  }

  return { ...config, account, region, isProduction: config.isProduction ?? false };
}
