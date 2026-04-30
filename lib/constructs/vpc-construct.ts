import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface VpcConstructProps {
  readonly prefix: string;
  readonly stackEnvName: string;
  readonly isProduction: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
}

export class VpcConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly isolatedSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);

    const { prefix, stackEnvName, isProduction, removalPolicy } = props;

    const vpcName = `${prefix}-${stackEnvName}-vpc`;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName,
      maxAzs: isProduction ? 3 : 2,
      natGateways: isProduction ? 3 : 1,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: !isProduction,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    this.privateSubnets = this.vpc.privateSubnets;
    this.publicSubnets = this.vpc.publicSubnets;
    this.isolatedSubnets = this.vpc.isolatedSubnets;

    this.addFlowLogs();
    this.addVpcEndpoints();
    this.applyTags();
  }

  private addFlowLogs(): void {
    const flowLogsGroup = new logs.LogGroup(this, 'FlowLogsGroup', {
      logGroupName: `/aws/vpc/flowlogs/${cdk.Stack.of(this).stackName}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const flowLogsRole = new iam.Role(this, 'FlowLogsRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
      inlinePolicies: {
        FlowLogsToCloudWatch: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    new ec2.CfnFlowLog(this, 'FlowLog', {
      resourceType: 'AWS::EC2::VPC',
      resourceId: this.vpc.vpcId,
      trafficType: ec2.FlowLogTrafficType.ALL,
      logDestinationType: 'cloud-watch-logs',
      logGroupName: flowLogsGroup.logGroupName,
      deliverLogsPermissionArn: flowLogsRole.roleArn,
    });
  }

  private addVpcEndpoints(): void {
    new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    new ec2.GatewayVpcEndpoint(this, 'DynamoDbEndpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    new ec2.InterfaceVpcEndpoint(this, 'EcrApiEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      subnets: {
        subnets: this.isolatedSubnets,
      },
      privateDnsEnabled: false,
    });

    new ec2.InterfaceVpcEndpoint(this, 'EcrDockerEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: {
        subnets: this.isolatedSubnets,
      },
      privateDnsEnabled: false,
    });

    new ec2.InterfaceVpcEndpoint(this, 'CloudWatchEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: {
        subnets: this.isolatedSubnets,
      },
      privateDnsEnabled: false,
    });

    new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: {
        subnets: this.isolatedSubnets,
      },
      privateDnsEnabled: false,
    });

    new ec2.InterfaceVpcEndpoint(this, 'RdsEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.RDS,
      subnets: {
        subnets: this.isolatedSubnets,
      },
      privateDnsEnabled: false,
    });
  }

  private applyTags(): void {
    cdk.Tags.of(this.vpc).add('Architecture', 'Isolated');
    cdk.Tags.of(this.vpc).add('Network', 'Private');
  }
}
