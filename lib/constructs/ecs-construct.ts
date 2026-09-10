import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { VpcConstruct, VPC_CIDR } from './vpc-construct';

export interface EcsConstructProps {
  readonly namePrefix: string;
  readonly envName: string;
  readonly vpcConstruct: VpcConstruct;
  readonly isProduction: boolean;
  readonly isEphemeral: boolean;
  /** MiniStack has no standalone AWS::EC2::SecurityGroupIngress — see Config.isLocal. */
  readonly isLocal?: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly appImage: string;
  readonly containerPort: number;
  readonly desiredCount: number;
  /** Granted read/write to the task role. */
  readonly storageBucket: s3.IBucket;
  /** Granted encrypt/decrypt to the task role. */
  readonly kmsKey: kms.IKey;
}

export class EcsConstruct extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly taskRole: iam.Role;
  public readonly executionRole: iam.Role;
  public readonly containerSecurityGroup: ec2.SecurityGroup;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: EcsConstructProps) {
    super(scope, id);

    const {
      namePrefix,
      envName,
      vpcConstruct,
      isProduction,
      isEphemeral,
      isLocal = false,
      removalPolicy,
      appImage,
      containerPort,
      desiredCount,
      storageBucket,
      kmsKey,
    } = props;

    const vpc = vpcConstruct.vpc;

    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: `${namePrefix}-ecs-exec`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    this.taskRole = new iam.Role(this, 'TaskRole', {
      roleName: `${namePrefix}-ecs-task`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    storageBucket.grantReadWrite(this.taskRole);
    kmsKey.grantEncryptDecrypt(this.taskRole);
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'], // PutMetricData has no resource-level permissions.
      }),
    );

    this.taskDefinition = this.createTaskDefinition(
      namePrefix,
      envName,
      isProduction,
      removalPolicy,
      appImage,
      containerPort,
    );

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${namePrefix}-ecs`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      securityGroupName: `${namePrefix}-alb-sg`,
      vpc,
      allowAllOutbound: true,
    });

    // Tasks run in private subnets behind the NAT gateway and need egress to pull the image, ship
    // logs and reach RDS. Ingress is the ALB only (added below).
    this.containerSecurityGroup = new ec2.SecurityGroup(this, 'ContainerSecurityGroup', {
      securityGroupName: `${namePrefix}-ecs-sg`,
      vpc,
      allowAllOutbound: true,
    });

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      // Locally the ALB shares the task group: attaching the service makes CDK open the target
      // port from the load balancer, and a cross-group rule would be a standalone resource.
      securityGroup: isLocal ? this.containerSecurityGroup : this.albSecurityGroup,
    });

    // A security-group peer becomes a standalone AWS::EC2::SecurityGroupIngress resource; a CIDR
    // peer is inlined into the group itself, which is all MiniStack supports. The literal range
    // avoids an Fn::GetAtt on the VPC, which MiniStack's schema does not answer either.
    this.containerSecurityGroup.addIngressRule(
      isLocal ? ec2.Peer.ipv4(VPC_CIDR) : this.albSecurityGroup,
      ec2.Port.tcp(containerPort),
      'Allow traffic from ALB',
    );

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: containerPort,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: isEphemeral ? 1 : desiredCount,
      securityGroups: [this.containerSecurityGroup],
      // A one-task ephemeral env has no spare capacity to keep healthy during a deploy.
      minHealthyPercent: isEphemeral ? 0 : 50,
      circuitBreaker: { rollback: true },
    });

    // Without this the target group stays empty and the ALB serves 503s. Attaching makes CDK open
    // the target port from the load balancer, and a security-group-to-security-group rule is a
    // standalone AWS::EC2::SecurityGroupIngress, which MiniStack does not implement — so locally
    // the ALB deploys but routes nowhere. Reach the task through its own container instead.
    if (!isLocal) {
      this.service.attachToApplicationTargetGroup(this.targetGroup);
    }

    this.loadBalancer
      .addListener('Listener', { port: 80 })
      .addTargetGroups('DefaultTargetGroup', { targetGroups: [this.targetGroup] });
  }

  private createTaskDefinition(
    namePrefix: string,
    envName: string,
    isProduction: boolean,
    removalPolicy: cdk.RemovalPolicy,
    appImage: string,
    containerPort: number,
  ): ecs.FargateTaskDefinition {
    const logGroup = new logs.LogGroup(this, 'TaskLogGroup', {
      logGroupName: `/ecs/${namePrefix}/task`,
      removalPolicy,
      retention: isProduction ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_WEEK,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: namePrefix,
      cpu: isProduction ? 512 : 256,
      memoryLimitMiB: isProduction ? 1024 : 512,
      executionRole: this.executionRole,
      taskRole: this.taskRole,
    });

    taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry(appImage),
      portMappings: [{ containerPort }],
      environment: {
        APP_ENV: envName,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs',
        logGroup,
      }),
    });

    return taskDefinition;
  }
}
