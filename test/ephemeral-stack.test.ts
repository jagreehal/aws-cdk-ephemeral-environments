import { describe, expect, test } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EphemeralStack, type EphemeralStackProps } from '../lib/ephemeral-stack';
import type { Config } from '../lib/loadConfigForEnv';

const baseConfig: Config = {
  account: '123456789012',
  region: 'us-east-1',
  isProduction: false,
  isPersistent: false,
};

/** Synth a stack from partial props; every test needs one and only a couple of fields differ. */
function synth(props: Partial<EphemeralStackProps> = {}): Template {
  const app = new App();
  const stack = new EphemeralStack(app, 'TestStack', {
    config: baseConfig,
    envName: 'dev',
    ...props,
  });

  return Template.fromStack(stack);
}

const prod: Partial<EphemeralStackProps> = {
  config: { ...baseConfig, isProduction: true, isPersistent: true },
  envName: 'prod',
};

const local: Partial<EphemeralStackProps> = {
  config: { ...baseConfig, isLocal: true },
  envName: 'local',
};

describe('EphemeralStack', () => {
  // MiniStack's CloudFormation engine implements a subset of AWS. Local mode exists to stay inside
  // it, so these assert the absence of the resource types that made a local deploy fail.
  describe('local mode (MiniStack)', () => {
    test('emits none of the resource types MiniStack cannot provision', () => {
      const template = synth(local);

      for (const type of [
        'AWS::EC2::NatGateway',
        'AWS::EC2::EIP',
        'AWS::EC2::FlowLog',
        'AWS::EC2::SecurityGroupIngress',
        'AWS::RDS::DBSubnetGroup',
        'AWS::SecretsManager::SecretTargetAttachment',
        'AWS::RDS::DBInstance',
      ]) {
        template.resourceCountIs(type, 0);
      }
    });

    test('emits no Lambda-backed custom resources, which MiniStack never completes', () => {
      const resources = synth(local).toJSON().Resources as Record<string, { Type: string }>;

      expect(
        Object.values(resources).filter(
          (r) => r.Type.startsWith('Custom::') || r.Type === 'AWS::Lambda::Function',
        ),
      ).toHaveLength(0);
    });

    test('still deploys the app: cluster, service, task definition and load balancer', () => {
      const template = synth(local);

      template.resourceCountIs('AWS::ECS::Cluster', 1);
      template.resourceCountIs('AWS::ECS::Service', 1);
      template.resourceCountIs('AWS::ECS::TaskDefinition', 1);
      template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    });

    test('leaves the AWS deploy untouched', () => {
      const template = synth();

      template.resourceCountIs('AWS::EC2::NatGateway', 1);
      template.resourceCountIs('AWS::EC2::FlowLog', 1);
      template.resourceCountIs('AWS::RDS::DBInstance', 1);
    });
  });

  describe('naming', () => {
    test('names resources from the env name, with no duplicated prefix', () => {
      const template = synth({ envName: 'pr-123-abcdef' });

      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterName: 'pr-123-abcdef-ephemeral-ecs',
      });
      template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
        DashboardName: 'pr-123-abcdef-ephemeral-dashboard',
      });
      template.hasResourceProperties('AWS::EC2::VPC', {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'Name', Value: 'pr-123-abcdef-ephemeral-vpc' }),
        ]),
      });
    });

    test('keeps IAM role names inside the 64-character limit for long branch envs', () => {
      const template = synth({ envName: 'branch-a-very-long-feature-name-abcd1234' });
      const roles = template.findResources('AWS::IAM::Role');

      for (const role of Object.values(roles)) {
        const name = (role as { Properties?: { RoleName?: string } }).Properties?.RoleName;
        if (name) {
          expect(name.length).toBeLessThanOrEqual(64);
        }
      }
    });
  });

  describe('VPC', () => {
    test('creates an ephemeral VPC with a single NAT gateway', () => {
      const template = synth();

      template.hasResourceProperties('AWS::EC2::VPC', {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
      template.resourceCountIs('AWS::EC2::VPC', 1);
      template.resourceCountIs('AWS::EC2::Subnet', 6);
      template.resourceCountIs('AWS::EC2::NatGateway', 1);
      template.hasResourceProperties('AWS::EC2::FlowLog', {});
    });

    test('creates more NAT gateways for production', () => {
      const template = synth(prod);

      template.resourceCountIs('AWS::EC2::NatGateway', 2);
    });

    test('creates only the free gateway endpoints', () => {
      const template = synth();
      const endpoints = Object.values(template.findResources('AWS::EC2::VPCEndpoint'));

      expect(endpoints).toHaveLength(2);
      for (const endpoint of endpoints) {
        expect(
          (endpoint as { Properties: { VpcEndpointType: string } }).Properties.VpcEndpointType,
        ).toBe('Gateway');
      }
    });
  });

  describe('ECS', () => {
    test('creates a Fargate task definition sized for the environment', () => {
      const template = synth();

      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        NetworkMode: 'awsvpc',
        RequiresCompatibilities: ['FARGATE'],
        Cpu: '256',
        Memory: '512',
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Image: 'public.ecr.aws/nginx/nginx:alpine',
            PortMappings: Match.arrayWith([Match.objectLike({ ContainerPort: 80 })]),
          }),
        ]),
      });
    });

    test('registers the service with the ALB target group', () => {
      const template = synth();

      template.hasResourceProperties('AWS::ECS::Service', {
        LoadBalancers: Match.arrayWith([
          Match.objectLike({ ContainerName: 'AppContainer', ContainerPort: 80 }),
        ]),
      });
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        HealthCheckPath: '/health',
        TargetType: 'ip',
      });
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Scheme: 'internet-facing',
        Type: 'application',
      });
    });

    test('runs a single task in ephemeral envs regardless of desiredCount', () => {
      const template = synth({ desiredCount: 4 });

      template.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
    });

    test('honours desiredCount for persistent envs', () => {
      const template = synth({ ...prod, desiredCount: 4 });

      template.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 4 });
    });
  });

  describe('RDS', () => {
    test('creates an encrypted, private instance with a generated secret', () => {
      const template = synth();

      template.hasResourceProperties('AWS::RDS::DBInstance', {
        DBInstanceClass: 'db.t3.micro',
        StorageEncrypted: true,
        PubliclyAccessible: false,
      });
      template.hasResourceProperties('AWS::SecretsManager::Secret', {});
    });

    test('enables multi-AZ and Performance Insights only for production', () => {
      synth(prod).hasResourceProperties('AWS::RDS::DBInstance', {
        MultiAZ: true,
        EnablePerformanceInsights: true,
      });

      synth().hasResourceProperties('AWS::RDS::DBInstance', {
        MultiAZ: false,
        EnablePerformanceInsights: false,
      });
    });

    test('rejects a malformed instance class at synth time', () => {
      expect(() => synth({ dbInstanceClass: 'bad-class' })).toThrow(
        "Invalid dbInstanceClass 'bad-class'. Expected format like 'db.t3.micro'.",
      );
    });
  });

  describe('security', () => {
    test('encrypts the bucket with S3-managed keys in ephemeral envs', () => {
      const template = synth();

      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        },
      });
    });

    test('encrypts the bucket with the app CMK in production', () => {
      const template = synth(prod);

      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({
              ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }),
            }),
          ],
        },
      });
    });

    test('creates security groups for the ALB, tasks and database', () => {
      const template = synth();

      expect(Object.keys(template.findResources('AWS::EC2::SecurityGroup'))).toHaveLength(3);
    });
  });

  describe('removal policies', () => {
    test('destroys ephemeral resources with the stack', () => {
      const template = synth({ envName: 'pr-123-abcdef' });

      for (const bucket of Object.values(template.findResources('AWS::S3::Bucket'))) {
        expect((bucket as { DeletionPolicy: string }).DeletionPolicy).toBe('Delete');
      }
    });

    test('retains persistent resources', () => {
      const template = synth(prod);

      for (const key of Object.values(template.findResources('AWS::KMS::Key'))) {
        expect((key as { DeletionPolicy: string }).DeletionPolicy).toBe('Retain');
      }
    });
  });

  describe('tags and outputs', () => {
    test('tags resources with the environment and its type', () => {
      const template = synth({ envName: 'pr-123-abcdef' });
      const [db] = Object.values(template.findResources('AWS::RDS::DBInstance')) as Array<{
        Properties?: { Tags?: Array<{ Key: string; Value: string }> };
      }>;

      expect(db.Properties?.Tags).toEqual(
        expect.arrayContaining([
          { Key: 'Environment', Value: 'pr-123-abcdef' },
          { Key: 'EnvironmentType', Value: 'Ephemeral' },
          { Key: 'Project', Value: 'EphemeralEnvironments' },
        ]),
      );
    });

    test('exports the references CI and developers need', () => {
      const template = synth();

      for (const output of [
        'ClusterName',
        'ServiceName',
        'LoadBalancerDns',
        'LoadBalancerUrl',
        'DatabaseEndpoint',
        'DatabaseSecretArn',
        'StorageBucketName',
        'TaskRoleArn',
      ]) {
        template.hasOutput(output, {});
      }
    });
  });
});
