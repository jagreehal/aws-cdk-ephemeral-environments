import { loadConfigForEnv } from '../lib/loadConfigForEnv';
import * as fs from 'node:fs';
import * as path from 'node:path';

jest.mock('node:fs');

describe('loadConfigForEnv', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;
  const configPath = '/test/config.json';

  const validConfig = {
    dev: {
      account: '123456789012',
      region: 'us-east-1',
      isProduction: false,
      prefix: 'dev',
      isPersistent: false,
    },
    staging: {
      account: '123456789012',
      region: 'us-east-1',
      isProduction: false,
      prefix: 'stage',
      isPersistent: true,
    },
    prod: {
      account: '123456789012',
      region: 'us-east-1',
      isProduction: true,
      prefix: 'prod',
      isPersistent: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('successful config loading', () => {
    test('loads valid dev config', async () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validConfig));

      const config = await loadConfigForEnv('dev', configPath);

      expect(config).toEqual(validConfig.dev);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(configPath, 'utf-8');
    });

    test('loads valid staging config', async () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validConfig));

      const config = await loadConfigForEnv('staging', configPath);

      expect(config).toEqual(validConfig.staging);
    });

    test('loads valid prod config', async () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validConfig));

      const config = await loadConfigForEnv('prod', configPath);

      expect(config).toEqual(validConfig.prod);
    });
  });

  describe('config validation', () => {
    test('throws error for missing environment', async () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validConfig));

      await expect(loadConfigForEnv('nonexistent', configPath)).rejects.toThrow(
        "Configuration for environment 'nonexistent' not found",
      );
    });

    test('throws error for missing account', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          dev: {
            account: '',
            region: 'us-east-1',
            isProduction: false,
            prefix: 'dev',
          },
        }),
      );

      await expect(loadConfigForEnv('dev', configPath)).rejects.toThrow(
        'Configuration account is missing or empty',
      );
    });

    test('throws error for invalid account format', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          dev: {
            account: 'invalid',
            region: 'us-east-1',
            isProduction: false,
            prefix: 'dev',
          },
        }),
      );

      await expect(loadConfigForEnv('dev', configPath)).rejects.toThrow(
        'Invalid AWS account ID: must be a 12-digit numeric string',
      );
    });

    test('throws error for missing region', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          dev: {
            account: '123456789012',
            region: '',
            isProduction: false,
            prefix: 'dev',
          },
        }),
      );

      await expect(loadConfigForEnv('dev', configPath)).rejects.toThrow(
        'Configuration region is missing or empty',
      );
    });

    test('throws error for unsupported region', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          dev: {
            account: '123456789012',
            region: 'ap-south-1',
            isProduction: false,
            prefix: 'dev',
          },
        }),
      );

      await expect(loadConfigForEnv('dev', configPath)).rejects.toThrow(
        "Unsupported region 'ap-south-1'",
      );
    });

    test('allows custom regions via VALID_REGIONS env var', async () => {
      process.env.VALID_REGIONS = 'us-east-1,eu-west-1,ap-south-1';

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          dev: {
            account: '123456789012',
            region: 'ap-south-1',
            isProduction: false,
            prefix: 'dev',
          },
        }),
      );

      const config = await loadConfigForEnv('dev', configPath);

      expect(config.region).toBe('ap-south-1');

      delete process.env.VALID_REGIONS;
    });
  });

  describe('file operations', () => {
    test('throws error for missing config file', async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      await expect(loadConfigForEnv('dev', configPath)).rejects.toThrow(
        'Failed to read configuration file',
      );
    });

    test('throws error for invalid JSON', async () => {
      mockFs.readFileSync.mockReturnValue('invalid json {{{');

      await expect(loadConfigForEnv('dev', configPath)).rejects.toThrow(
        'Configuration file contains invalid JSON',
      );
    });
  });

  describe('SSM configuration', () => {
    test('loads config with useSsmConfig flag', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          dev: {
            account: '123456789012',
            region: 'us-east-1',
            isProduction: false,
            prefix: 'dev',
            useSsmConfig: true,
          },
        }),
      );

      const config = await loadConfigForEnv('dev', configPath);

      expect(config.useSsmConfig).toBe(true);
    });
  });

  describe('account ID from environment variable', () => {
    test('uses SSM_ACCOUNT_DEV env var when valid', async () => {
      process.env.SSM_ACCOUNT_DEV = '999888777666';

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          dev: {
            account: 'invalid',
            region: 'us-east-1',
            isProduction: false,
            prefix: 'dev',
          },
        }),
      );

      const config = await loadConfigForEnv('dev', configPath);

      expect(config.account).toBe('999888777666');

      delete process.env.SSM_ACCOUNT_DEV;
    });

    test('uses SSM_ACCOUNT_STAGING env var for staging', async () => {
      process.env.SSM_ACCOUNT_STAGING = '111222333444';

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          staging: {
            account: 'invalid',
            region: 'us-east-1',
            isProduction: false,
            prefix: 'stage',
          },
        }),
      );

      const config = await loadConfigForEnv('staging', configPath);

      expect(config.account).toBe('111222333444');

      delete process.env.SSM_ACCOUNT_STAGING;
    });
  });
});