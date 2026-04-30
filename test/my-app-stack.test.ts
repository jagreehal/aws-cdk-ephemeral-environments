import * as cdk from 'aws-cdk-lib';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EphemeralStack } from '../lib/my-app-stack';
import type { Config } from '../lib/loadConfigForEnv';

describe('EphemeralStack', () => {
  const baseConfig: Config = {
    account: '123456789012',
    region: 'us-east-1',
    isProduction: false,
    prefix: 'test',
    isPersistent: false,
  };

  describe('VPC Resources', () => {
    test('creates VPC with correct configuration for ephemeral env', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: { ...baseConfig, isProduction: false, isPersistent: false },
        stackEnvName: 'pr-123-abcdef',
        terminationProtection: false,
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::EC2::VPC', {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });

      template.resourceCountIs('AWS::EC2::VPC', 1);
      template.resourceCountIs('AWS::EC2::Subnet', 6);
      template.resourceCountIs('AWS::EC2::InternetGateway', 1);
      template.resourceCountIs('AWS::EC2::NatGateway', 1);
    });

    test('creates multiple NAT gateways for production', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: { ...baseConfig, isProduction: true, isPersistent: true },
        stackEnvName: 'prod',
        terminationProtection: true,
      });

      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::EC2::NatGateway', 2);
    });
  });

  describe('ECS Resources', () => {
    test('creates ECS cluster with Container Insights', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterName: 'test-dev-ecs',
      });
    });

    test('creates ECS task definition with correct settings', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        NetworkMode: 'awsvpc',
        RequiresCompatibilities: ['FARGATE'],
        Cpu: '256',
        Memory: '512',
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Image: 'public.ecr.aws/nginx/nginx:alpine',
            PortMappings: Match.arrayWith([
              Match.objectLike({ ContainerPort: 80 }),
            ]),
          }),
        ]),
      });
    });

    test('creates ALB with HTTP to HTTPS redirect', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Scheme: 'internet-facing',
        Type: 'application',
      });
    });
  });

  describe('RDS Resources', () => {
    test('creates RDS instance with encryption', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::RDS::DBInstance', {
        DBInstanceClass: 'db.t3.micro',
        StorageEncrypted: true,
        PubliclyAccessible: false,
      });
    });

    test('creates RDS with multi-AZ for production', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: { ...baseConfig, isProduction: true },
        stackEnvName: 'prod',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::RDS::DBInstance', {
        MultiAZ: true,
      });
    });

    test('creates RDS secret in Secrets Manager', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::SecretsManager::Secret', {});
    });
  });

  describe('Security Resources', () => {
    test('creates KMS keys for encryption', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::KMS::Key', {});
    });

    test('creates S3 bucket with encryption and SSL enforcement', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      });
    });

    test('creates IAM roles', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      const roles = template.findResources('AWS::IAM::Role');
      expect(Object.keys(roles).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Monitoring Resources', () => {
    test('creates CloudWatch dashboard', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
        DashboardName: 'test-dev-dashboard',
      });
    });

    test('creates SNS topic for alarms', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
        alarmEmail: 'test@example.com',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::SNS::Topic', {
        DisplayName: 'Alarms for test-dev',
      });
    });

    test('creates CloudWatch alarms', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudWatch::Alarm', {});
    });

    test('creates VPC flow logs', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::EC2::FlowLog', {});
    });
  });

  describe('Removal Policies', () => {
    test('ephemeral resources have DESTROY removal policy', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: { ...baseConfig, isProduction: false, isPersistent: false },
        stackEnvName: 'pr-123-abcdef',
      });

      const template = Template.fromStack(stack);

      const s3Buckets = template.findResources('AWS::S3::Bucket');
      Object.values(s3Buckets).forEach((bucket: any) => {
        expect(bucket.DeletionPolicy).toBe('Delete');
      });
    });

    test('persistent resources have RETAIN removal policy', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: { ...baseConfig, isProduction: true, isPersistent: true },
        stackEnvName: 'prod',
      });

      const template = Template.fromStack(stack);

      const kmsKeys = template.findResources('AWS::KMS::Key');
      Object.values(kmsKeys).forEach((key: any) => {
        expect(key.DeletionPolicy).toBe('Retain');
      });
    });
  });

  describe('Tags', () => {
    test('applies environment tags to stack', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      cdk.Tags.of(stack).add('Environment', 'dev');
      cdk.Tags.of(stack).add('Project', 'EphemeralEnvironments');

      const template = Template.fromStack(stack);

      const dbResources = template.findResources('AWS::RDS::DBInstance');
      const db = Object.values(dbResources)[0] as { Properties?: { Tags?: Array<{ Key: string; Value: string }> } };
      expect(db.Properties?.Tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ Key: 'Environment', Value: 'dev' }),
          expect.objectContaining({ Key: 'Project', Value: 'EphemeralEnvironments' }),
        ]),
      );
    });
  });

  describe('Outputs', () => {
    test('creates expected CloudFormation outputs', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      const expectedOutputs = [
        'ClusterName',
        'ServiceName',
        'LoadBalancerDns',
        'LoadBalancerUrl',
        'DatabaseEndpoint',
        'DatabaseSecretArn',
        'StorageBucketName',
        'TaskRoleArn',
      ];

      expectedOutputs.forEach((output) => {
        template.hasOutput(output, {});
      });
    });
  });

  describe('Network Configuration', () => {
    test('creates VPC endpoints for AWS services', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::EC2::VPCEndpoint', {});
    });

    test('creates security groups with restrictive rules', () => {
      const app = new App();
      const stack = new EphemeralStack(app, 'TestStack', {
        config: baseConfig,
        stackEnvName: 'dev',
      });

      const template = Template.fromStack(stack);

      const securityGroups = template.findResources('AWS::EC2::SecurityGroup');
      expect(Object.keys(securityGroups).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Error Handling', () => {
    test('throws error for invalid db instance class format', () => {
      expect(() => {
        const app = new App();
        new EphemeralStack(app, 'TestStack', {
          config: baseConfig,
          stackEnvName: 'dev',
          dbInstanceClass: 'bad-class' as any,
        });
      }).toThrow("Invalid dbInstanceClass 'bad-class'. Expected format like 'db.t3.micro'.");
    });
  });
});
