import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MonitoringConstructProps {
  readonly namePrefix: string;
  readonly isProduction: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly alarmEmail?: string;
  readonly albName?: string;
  readonly ecsClusterName?: string;
  readonly rdsIdentifier?: string;
}

/** Alarm when free storage drops below this. */
const RDS_LOW_STORAGE_BYTES = 2 * 1024 ** 3;

export class MonitoringConstruct extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly logGroup: logs.LogGroup;
  public readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    const {
      namePrefix,
      isProduction,
      removalPolicy,
      alarmEmail,
      albName,
      ecsClusterName,
      rdsIdentifier,
    } = props;

    this.logGroup = new logs.LogGroup(this, 'MonitoringLogGroup', {
      logGroupName: `/aws/ephemeral-envs/${namePrefix}`,
      removalPolicy,
      retention: isProduction ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_WEEK,
    });

    this.topic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${namePrefix}-alarms`,
      displayName: `Alarms for ${namePrefix}`,
    });

    if (alarmEmail) {
      new sns.Subscription(this, 'EmailSubscription', {
        topic: this.topic,
        endpoint: alarmEmail,
        protocol: sns.SubscriptionProtocol.EMAIL,
      });
    }

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${namePrefix}-dashboard`,
    });

    if (albName) {
      this.addAlbWidgets(albName);
    }

    if (ecsClusterName) {
      this.addEcsWidgets(ecsClusterName);
    }

    if (rdsIdentifier) {
      this.addRdsWidgets(rdsIdentifier);
    }
  }

  private addAlbWidgets(albName: string): void {
    const healthyHosts = new cloudwatch.Metric({
      metricName: 'HealthyHosts',
      namespace: 'AWS/ApplicationELB',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { LoadBalancer: albName },
    });

    const unhealthyHosts = new cloudwatch.Metric({
      metricName: 'UnHealthyHosts',
      namespace: 'AWS/ApplicationELB',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { LoadBalancer: albName },
    });

    const targetResponseTime = new cloudwatch.Metric({
      metricName: 'TargetResponseTime',
      namespace: 'AWS/ApplicationELB',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { LoadBalancer: albName },
    });

    const requestCount = new cloudwatch.Metric({
      metricName: 'RequestCount',
      namespace: 'AWS/ApplicationELB',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { LoadBalancer: albName },
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB - Host Health',
        left: [healthyHosts, unhealthyHosts],
        period: cdk.Duration.minutes(5),
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB - Response Time',
        left: [targetResponseTime],
        period: cdk.Duration.minutes(5),
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB - Request Count',
        left: [requestCount],
        period: cdk.Duration.minutes(5),
        width: 12,
      }),
    );
  }

  private addEcsWidgets(clusterName: string): void {
    const cpuUtilization = new cloudwatch.Metric({
      metricName: 'CPUUtilization',
      namespace: 'AWS/ECS',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { ClusterName: clusterName },
    });

    const memoryUtilization = new cloudwatch.Metric({
      metricName: 'MemoryUtilization',
      namespace: 'AWS/ECS',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { ClusterName: clusterName },
    });

    const runningTasks = new cloudwatch.Metric({
      metricName: 'RunningTaskCount',
      namespace: 'ECS/ContainerInsights',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { ClusterName: clusterName },
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS - CPU & Memory',
        left: [cpuUtilization, memoryUtilization],
        period: cdk.Duration.minutes(5),
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS - Running Tasks',
        left: [runningTasks],
        period: cdk.Duration.minutes(5),
        width: 12,
      }),
    );

    this.createEcsAlarms(clusterName, cpuUtilization, memoryUtilization);
  }

  private addRdsWidgets(rdsIdentifier: string): void {
    const cpuUtilization = new cloudwatch.Metric({
      metricName: 'CPUUtilization',
      namespace: 'AWS/RDS',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { DBInstanceIdentifier: rdsIdentifier },
    });

    const connections = new cloudwatch.Metric({
      metricName: 'DatabaseConnections',
      namespace: 'AWS/RDS',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { DBInstanceIdentifier: rdsIdentifier },
    });

    const freeStorage = new cloudwatch.Metric({
      metricName: 'FreeStorageSpace',
      namespace: 'AWS/RDS',
      statistic: 'Minimum',
      period: cdk.Duration.minutes(5),
      dimensionsMap: { DBInstanceIdentifier: rdsIdentifier },
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RDS - CPU & Connections',
        left: [cpuUtilization, connections],
        period: cdk.Duration.minutes(5),
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS - Free Storage',
        left: [freeStorage],
        period: cdk.Duration.minutes(5),
        width: 12,
      }),
    );

    this.createRdsAlarms(rdsIdentifier, cpuUtilization, freeStorage);
  }

  private createEcsAlarms(
    clusterName: string,
    cpuMetric: cloudwatch.Metric,
    memoryMetric: cloudwatch.Metric,
  ): void {
    const cpuAlarm = new cloudwatch.Alarm(this, 'EcsCpuAlarm', {
      metric: cpuMetric,
      threshold: 80,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      alarmDescription: 'ECS CPU utilization is high',
      alarmName: `${clusterName}-cpu-high`,
    });

    const memoryAlarm = new cloudwatch.Alarm(this, 'EcsMemoryAlarm', {
      metric: memoryMetric,
      threshold: 80,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      alarmDescription: 'ECS Memory utilization is high',
      alarmName: `${clusterName}-memory-high`,
    });

    cpuAlarm.addAlarmAction(new cwActions.SnsAction(this.topic));
    memoryAlarm.addAlarmAction(new cwActions.SnsAction(this.topic));
  }

  private createRdsAlarms(
    rdsIdentifier: string,
    cpuMetric: cloudwatch.Metric,
    storageMetric: cloudwatch.Metric,
  ): void {
    const cpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      metric: cpuMetric,
      threshold: 90,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      alarmDescription: 'RDS CPU utilization is high',
      alarmName: `${rdsIdentifier}-cpu-high`,
    });

    const storageAlarm = new cloudwatch.Alarm(this, 'RdsStorageAlarm', {
      metric: storageMetric,
      threshold: RDS_LOW_STORAGE_BYTES,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      alarmDescription: 'RDS free storage is low',
      alarmName: `${rdsIdentifier}-storage-low`,
    });

    cpuAlarm.addAlarmAction(new cwActions.SnsAction(this.topic));
    storageAlarm.addAlarmAction(new cwActions.SnsAction(this.topic));
  }
}
