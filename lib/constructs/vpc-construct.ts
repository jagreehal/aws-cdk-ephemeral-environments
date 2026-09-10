import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/** Exported so rules can reference the range without an Fn::GetAtt on the VPC. */
export const VPC_CIDR = '10.0.0.0/16';

export interface VpcConstructProps {
  readonly namePrefix: string;
  readonly isProduction: boolean;
  /** MiniStack has no NAT gateway, EIP or flow log resources — see Config.isLocal. */
  readonly isLocal?: boolean;
}

export class VpcConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly isolatedSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);

    const { namePrefix, isProduction, isLocal = false } = props;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${namePrefix}-vpc`,
      maxAzs: isProduction ? 3 : 2,
      natGateways: isLocal ? 0 : isProduction ? 3 : 1,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      ipAddresses: ec2.IpAddresses.cidr(VPC_CIDR),
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: !isProduction,
        },
        {
          name: 'Private',
          // Without a NAT gateway there is no egress to give these subnets.
          subnetType: isLocal ? ec2.SubnetType.PRIVATE_ISOLATED : ec2.SubnetType.PRIVATE_WITH_EGRESS,
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

    if (!isLocal) {
      this.addFlowLogs();
    }

    // Gateway endpoints only: they are free, and the NAT gateway already carries the rest of the
    // egress. Interface endpoints (ECR/logs/secrets/RDS) are ~$7/AZ/month each — real money on an
    // env that lives for the length of a PR.
    // ponytail: add interface endpoints if you drop the NAT gateway for isolated-subnet tasks.
    new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    new ec2.GatewayVpcEndpoint(this, 'DynamoDbEndpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    cdk.Tags.of(this.vpc).add('Architecture', 'Isolated');
    cdk.Tags.of(this.vpc).add('Network', 'Private');
  }

  /**
   * CloudWatch flow logs on our own log group (the L2 default group has no retention control).
   * `addFlowLog` wires up the delivery role, which the previous hand-rolled `CfnFlowLog` got
   * wrong — it passed `AWS::EC2::VPC` where CloudFormation expects `VPC`.
   */
  private addFlowLogs(): void {
    const logGroup = new logs.LogGroup(this, 'FlowLogsGroup', {
      logGroupName: `/aws/vpc/flowlogs/${cdk.Stack.of(this).stackName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(logGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });
  }
}
