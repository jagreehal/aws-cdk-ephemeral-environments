import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Config } from './loadConfigForEnv';
import { nameFor } from './constants';
import { VpcConstruct } from './constructs/vpc-construct';
import { EcsConstruct } from './constructs/ecs-construct';
import { DatabaseConstruct } from './constructs/database-construct';
import { SecurityConstruct } from './constructs/security-construct';
import { MonitoringConstruct } from './constructs/monitoring-construct';

export interface EphemeralStackProps extends cdk.StackProps {
  config: Config;
  /** Environment name: `dev`, `prod`, or a CI-generated `pr-123-ab12` / `branch-foo-ab12`. */
  envName: string;
  appImage?: string;
  containerPort?: number;
  desiredCount?: number;
  dbInstanceClass?: string;
  dbAllocatedStorage?: number;
  alarmEmail?: string;
}

export class EphemeralStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EphemeralStackProps) {
    super(scope, id, props);

    const {
      config,
      envName,
      appImage = 'public.ecr.aws/nginx/nginx:alpine',
      containerPort = 80,
      desiredCount = 2,
      dbInstanceClass = 'db.t3.micro',
      dbAllocatedStorage = 20,
      alarmEmail,
    } = props;

    const isEphemeral = !config.isProduction && !config.isPersistent;
    const isLocal = config.isLocal ?? false;
    const removalPolicy = isEphemeral ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;
    const namePrefix = nameFor(envName);

    this.applyRemovalPolicy(removalPolicy);

    const vpcConstruct = new VpcConstruct(this, 'Vpc', {
      namePrefix,
      isProduction: config.isProduction,
      isLocal,
    });

    const securityConstruct = new SecurityConstruct(this, 'Security', {
      namePrefix,
      isProduction: config.isProduction,
      removalPolicy,
      isLocal,
    });

    const ecsConstruct = new EcsConstruct(this, 'Ecs', {
      namePrefix,
      envName,
      vpcConstruct,
      isProduction: config.isProduction,
      isEphemeral,
      isLocal,
      removalPolicy,
      appImage,
      containerPort,
      desiredCount,
      storageBucket: securityConstruct.storageBucket,
      kmsKey: securityConstruct.kmsKey,
    });

    // MiniStack has no AWS::RDS::DBSubnetGroup, which CDK always creates for a VPC-placed
    // instance, so a local deploy runs the app without a database.
    const databaseConstruct = isLocal
      ? undefined
      : new DatabaseConstruct(this, 'Database', {
          namePrefix,
          vpcConstruct,
          isProduction: config.isProduction,
          isEphemeral,
          removalPolicy,
          dbInstanceClass,
          dbAllocatedStorage,
          ecsSecurityGroup: ecsConstruct.containerSecurityGroup,
        });

    new MonitoringConstruct(this, 'Monitoring', {
      namePrefix,
      isProduction: config.isProduction,
      removalPolicy,
      alarmEmail,
      albName: ecsConstruct.loadBalancer.loadBalancerFullName,
      ecsClusterName: ecsConstruct.cluster.clusterName,
      rdsIdentifier: databaseConstruct?.database.instanceIdentifier,
    });

    this.outputReferences(ecsConstruct, databaseConstruct, securityConstruct);
    this.applyTags(config, envName, isEphemeral);
  }

  private applyRemovalPolicy(policy: RemovalPolicy): void {
    cdk.Aspects.of(this).add({
      visit(node) {
        if (node instanceof cdk.CfnResource) {
          node.applyRemovalPolicy(policy);
        }
      },
    });
  }

  private outputReferences(
    ecs: EcsConstruct,
    database: DatabaseConstruct | undefined,
    security: SecurityConstruct,
  ): void {
    new cdk.CfnOutput(this, 'ClusterName', {
      value: ecs.cluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: ecs.service.serviceName,
      description: 'ECS Service Name',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: ecs.loadBalancer.loadBalancerDnsName,
      description: 'Application Load Balancer DNS Name',
    });

    new cdk.CfnOutput(this, 'LoadBalancerUrl', {
      value: `http://${ecs.loadBalancer.loadBalancerDnsName}`,
      description: 'Application Load Balancer URL',
    });

    if (database) {
      new cdk.CfnOutput(this, 'DatabaseEndpoint', {
        value: database.database.dbInstanceEndpointAddress,
        description: 'RDS Database Endpoint',
      });

      new cdk.CfnOutput(this, 'DatabaseSecretArn', {
        value: database.secret.secretArn,
        description: 'RDS Database Secret ARN',
      });
    }

    new cdk.CfnOutput(this, 'StorageBucketName', {
      value: security.storageBucket.bucketName,
      description: 'S3 Storage Bucket Name',
    });

    new cdk.CfnOutput(this, 'TaskRoleArn', {
      value: ecs.taskRole.roleArn,
      description: 'ECS Task Role ARN',
    });
  }

  private applyTags(config: Config, envName: string, isEphemeral: boolean): void {
    const tags: Record<string, string> = {
      Environment: envName,
      EnvironmentType: isEphemeral ? 'Ephemeral' : 'Persistent',
      ManagedBy: 'CDK',
      Project: 'EphemeralEnvironments',
    };

    if (config.isProduction) {
      tags.CostCenter = 'Production';
    }

    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
