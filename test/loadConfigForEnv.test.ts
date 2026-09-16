import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import { loadConfigForEnv } from '../lib/loadConfigForEnv';

vi.mock('node:fs');

const configPath = '/test/config.json';

const configFile = {
  default: {
    account: '111111111111',
    region: 'us-east-1',
    isProduction: false,
    isPersistent: false,
  },
  staging: {
    account: '222222222222',
    isPersistent: true,
  },
  prod: {
    account: '333333333333',
    isProduction: true,
    isPersistent: true,
  },
};

function givenConfigFile(contents: unknown = configFile): void {
  vi.mocked(fs.readFileSync).mockReturnValue(
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CDK_DEFAULT_ACCOUNT;
  delete process.env.VALID_REGIONS;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('loadConfigForEnv', () => {
  test('merges a named environment over the defaults', () => {
    givenConfigFile();

    expect(loadConfigForEnv('prod', configPath)).toEqual({
      account: '333333333333',
      region: 'us-east-1',
      isProduction: true,
      isPersistent: true,
    });
    expect(fs.readFileSync).toHaveBeenCalledWith(configPath, 'utf-8');
  });

  test('falls back to the defaults for an unknown (ephemeral) environment', () => {
    givenConfigFile();

    const config = loadConfigForEnv('pr-123-ab12cd34', configPath);

    expect(config).toEqual(configFile.default);
    expect(config.isProduction).toBe(false);
  });

  test('prefers CDK_DEFAULT_ACCOUNT over the account in the file', () => {
    givenConfigFile();
    process.env.CDK_DEFAULT_ACCOUNT = '999999999999';

    expect(loadConfigForEnv('dev', configPath).account).toBe('999999999999');
  });

  test('throws when no entry and no defaults exist', () => {
    givenConfigFile({ prod: configFile.prod });

    expect(() => loadConfigForEnv('dev', configPath)).toThrow(
      "No configuration for environment 'dev'",
    );
  });

  test('rejects an account that is not 12 digits', () => {
    givenConfigFile({ default: { ...configFile.default, account: 'not-an-account' } });

    expect(() => loadConfigForEnv('dev', configPath)).toThrow('Invalid AWS account ID');
  });

  test('rejects a missing account', () => {
    givenConfigFile({ default: { region: 'us-east-1' } });

    expect(() => loadConfigForEnv('dev', configPath)).toThrow('Configuration account is missing');
  });

  test('rejects a missing region', () => {
    givenConfigFile({ default: { account: '111111111111' } });

    expect(() => loadConfigForEnv('dev', configPath)).toThrow('Configuration region is missing');
  });

  test('rejects a region outside the allowed list', () => {
    givenConfigFile({ default: { ...configFile.default, region: 'ap-south-1' } });

    expect(() => loadConfigForEnv('dev', configPath)).toThrow("Unsupported region 'ap-south-1'");
  });

  test('honours a VALID_REGIONS override', () => {
    givenConfigFile({ default: { ...configFile.default, region: 'ap-south-1' } });
    process.env.VALID_REGIONS = 'ap-south-1, eu-west-1';

    expect(loadConfigForEnv('dev', configPath).region).toBe('ap-south-1');
  });

  test('reports invalid JSON with the file path', () => {
    givenConfigFile('{ not json');

    expect(() => loadConfigForEnv('dev', configPath)).toThrow(
      `Configuration file contains invalid JSON: ${configPath}`,
    );
  });

  test('reports an unreadable file', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => loadConfigForEnv('dev', configPath)).toThrow(
      'Failed to read configuration file at /test/config.json: ENOENT',
    );
  });
});
