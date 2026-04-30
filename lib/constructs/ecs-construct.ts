import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { VpcConstruct } from './vpc-construct';

export interface EcsConstructProps {
  readonly prefix: string;
  readonly stackEnvName: string;
  readonly vpcConstruct: VpcConstruct;
  readonly isProduction: boolean;
  readonly isEphemeral: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly appImage: string;
  readonly containerPort: number;
  readonly desiredCount: number;
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
      prefix,
      stackEnvName,
      vpcConstruct,
      isProduction,
      isEphemeral,
      removalPolicy,
      appImage,
      containerPort,
      desiredCount,
    } = props;

    this.executionRole = this.createExecutionRole(prefix, stackEnvName);
    this.taskRole = this.createTaskRole(prefix, stackEnvName);
    this.taskDefinition = this.createTaskDefinition(
      prefix,
      stackEnvName,
      isProduction,
      removalPolicy,
      appImage,
      containerPort,
    );
    this.cluster = this.createCluster(prefix, stackEnvName, vpcConstruct);
    this.containerSecurityGroup = this.createSecurityGroup(prefix, stackEnvName, vpcConstruct);
    this.albSecurityGroup = this.createAlbSecurityGroup(prefix, stackEnvName, vpcConstruct);
    this.loadBalancer = this.createLoadBalancer(prefix, stackEnvName, vpcConstruct);
    this.targetGroup = this.createTargetGroup(prefix, stackEnvName, vpcConstruct, containerPort);
    this.service = this.createService(prefix, stackEnvName, isEphemeral, desiredCount);
    this.setupListeners();
  }

  private createExecutionRole(prefix: string, stackEnvName: string): iam.Role {
    const role = new iam.Role(this, 'ExecutionRole', {
      roleName: `${prefix}-${stackEnvName}-ecs-exec-${cdk.Stack.of(this).account}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
      }),
    );

    return role;
  }

  private createTaskRole(prefix: string, stackEnvName: string): iam.Role {
    const role = new iam.Role(this, 'TaskRole', {
      roleName: `${prefix}-${stackEnvName}-ecs-task-${cdk.Stack.of(this).account}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: ['*'],
      }),
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );

    return role;
  }

  private createTaskDefinition(
    prefix: string,
    stackEnvName: string,
    isProduction: boolean,
    removalPolicy: cdk.RemovalPolicy,
    appImage: string,
    containerPort: number,
  ): ecs.FargateTaskDefinition {
    const logGroup = new logs.LogGroup(this, 'TaskLogGroup', {
      logGroupName: `/ecs/${prefix}/${stackEnvName}/task`,
      removalPolicy,
      retention: isProduction ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_WEEK,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: `${prefix}-${stackEnvName}`,
      cpu: isProduction ? 512 : 256,
      memoryLimitMiB: isProduction ? 1024 : 512,
      executionRole: this.executionRole,
      taskRole: this.taskRole,
    });

    taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry(appImage),
      portMappings: [{ containerPort }],
      environment: {
        APP_ENV: stackEnvName,
        APP_PREFIX: prefix,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs',
        logGroup,
      }),
    });

    return taskDefinition;
  }

  private createCluster(
    prefix: string,
    stackEnvName: string,
    vpcConstruct: VpcConstruct,
  ): ecs.Cluster {
    return new ecs.Cluster(this, 'Cluster', {
      clusterName: `${prefix}-${stackEnvName}-ecs`,
      vpc: vpcConstruct.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
  }

  private createSecurityGroup(prefix: string, stackEnvName: string, vpcConstruct: VpcConstruct): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, 'ContainerSecurityGroup', {
      securityGroupName: `${prefix}-${stackEnvName}-ecs-sg`,
      vpc: vpcConstruct.vpc,
      allowAllOutbound: false,
    });

    sg.addIngressRule(
      ec2.Peer.ipv4(vpcConstruct.vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow HTTP from VPC',
    );

    return sg;
  }

  private createAlbSecurityGroup(prefix: string, stackEnvName: string, vpcConstruct: VpcConstruct): ec2.SecurityGroup {
    return new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      securityGroupName: `${prefix}-${stackEnvName}-alb-sg`,
      vpc: vpcConstruct.vpc,
      allowAllOutbound: true,
    });
  }

  private createLoadBalancer(prefix: string, stackEnvName: string, vpcConstruct: VpcConstruct): elbv2.ApplicationLoadBalancer {
    const lb = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: vpcConstruct.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
    });

    this.containerSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.albSecurityGroup.securityGroupId),
      ec2.Port.tcp(80),
      'Allow traffic from ALB',
    );

    return lb;
  }

  private createTargetGroup(
    prefix: string,
    stackEnvName: string,
    vpcConstruct: VpcConstruct,
    containerPort: number,
  ): elbv2.ApplicationTargetGroup {
    return new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: vpcConstruct.vpc,
      port: containerPort,
      targetType: elbv2.TargetType.IP,
    });
  }

  private createService(
    prefix: string,
    stackEnvName: string,
    isEphemeral: boolean,
    desiredCount: number,
  ): ecs.FargateService {
    const service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: isEphemeral ? 1 : desiredCount,
      securityGroups: [this.containerSecurityGroup],
      circuitBreaker: {
        rollback: true,
      },
    });

    return service;
  }

  private setupListeners(): void {
    const listener = this.loadBalancer.addListener('Listener', {
      port: 80,
    });

    listener.addTargetGroups('DefaultTargetGroup', {
      targetGroups: [this.targetGroup],
    });

    this.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });
  }
}
