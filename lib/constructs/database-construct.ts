import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { VpcConstruct } from './vpc-construct';

export interface DatabaseConstructProps {
  readonly prefix: string;
  readonly stackEnvName: string;
  readonly vpcConstruct: VpcConstruct;
  readonly isProduction: boolean;
  readonly isEphemeral: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly dbInstanceClass: string;
  readonly dbAllocatedStorage: number;
  readonly ecsSecurityGroup?: ec2.SecurityGroup;
}

export class DatabaseConstruct extends Construct {
  public readonly database: rds.DatabaseInstance;
  public readonly secret: secretsmanager.ISecret;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const {
      prefix,
      stackEnvName,
      vpcConstruct,
      isProduction,
      isEphemeral,
      removalPolicy,
      dbInstanceClass,
      dbAllocatedStorage,
      ecsSecurityGroup,
    } = props;

    this.securityGroup = new ec2.SecurityGroup(
      this,
      'DatabaseSecurityGroup',
      {
        securityGroupName: `${prefix}-${stackEnvName}-rds-sg`,
        vpc: vpcConstruct.vpc,
        allowAllOutbound: false,
        description: `Security group for ${prefix}-${stackEnvName} RDS database`,
      },
    );

    const kmsKey = this.createKmsKey(prefix, stackEnvName, removalPolicy, isProduction);
    this.secret = this.createSecret(prefix, stackEnvName, kmsKey, removalPolicy);

    this.database = this.createDatabase(
      prefix,
      stackEnvName,
      vpcConstruct,
      kmsKey,
      removalPolicy,
      isProduction,
      isEphemeral,
      dbInstanceClass,
      dbAllocatedStorage,
    );

    if (ecsSecurityGroup) {
      this.securityGroup.addIngressRule(
        ec2.Peer.securityGroupId(ecsSecurityGroup.securityGroupId),
        ec2.Port.tcp(5432),
        'Allow PostgreSQL from ECS containers',
      );
    } else {
      this.securityGroup.addIngressRule(
        ec2.Peer.ipv4(vpcConstruct.vpc.vpcCidrBlock),
        ec2.Port.tcp(5432),
        'Allow PostgreSQL from VPC',
      );
    }
  }

  private createKmsKey(
    prefix: string,
    stackEnvName: string,
    removalPolicy: cdk.RemovalPolicy,
    isProduction: boolean,
  ): kms.Key {
    return new kms.Key(this, 'DatabaseKmsKey', {
      alias: `alias/${prefix}-${stackEnvName}-rds-kms`,
      description: `KMS key for ${prefix}-${stackEnvName} RDS database`,
      removalPolicy,
      enableKeyRotation: isProduction,
      pendingWindow: cdk.Duration.days(isProduction ? 30 : 7),
    });
  }

  private createSecret(
    prefix: string,
    stackEnvName: string,
    kmsKey: kms.Key,
    removalPolicy: cdk.RemovalPolicy,
  ): secretsmanager.Secret {
    return new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `/${prefix}/${stackEnvName}/rds/credentials`,
      removalPolicy,
      encryptionKey: kmsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'app_user',
        }),
        excludeCharacters: '"@/\\',
        generateStringKey: 'password',
      },
    });
  }

  private createDatabase(
    prefix: string,
    stackEnvName: string,
    vpcConstruct: VpcConstruct,
    kmsKey: kms.Key,
    removalPolicy: cdk.RemovalPolicy,
    isProduction: boolean,
    isEphemeral: boolean,
    dbInstanceClass: string,
    dbAllocatedStorage: number,
  ): rds.DatabaseInstance {
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_16_4,
    });

    const parsedInstanceType = ec2.InstanceType.of(
      ec2.InstanceClass.T3,
      ec2.InstanceSize.MICRO,
    );
    const match = /^db\.([a-z0-9]+)\.([a-z0-9]+)$/i.exec(dbInstanceClass.trim());
    if (!match) {
      throw new Error(
        `Invalid dbInstanceClass '${dbInstanceClass}'. Expected format like 'db.t3.micro'.`,
      );
    }
    const [, family, size] = match;
    const instanceClass = family.toUpperCase() as keyof typeof ec2.InstanceClass;
    const instanceSize = size.toUpperCase() as keyof typeof ec2.InstanceSize;
    if (!(instanceClass in ec2.InstanceClass) || !(instanceSize in ec2.InstanceSize)) {
      throw new Error(`Unsupported dbInstanceClass '${dbInstanceClass}'.`);
    }

    const databaseProps: rds.DatabaseInstanceProps = {
      engine,
      instanceType:
        ec2.InstanceType.of(ec2.InstanceClass[instanceClass], ec2.InstanceSize[instanceSize]) ??
        parsedInstanceType,
      storageEncrypted: true,
      multiAz: isProduction,
      allocatedStorage: dbAllocatedStorage,
      maxAllocatedStorage: isProduction ? dbAllocatedStorage * 2 : dbAllocatedStorage,
      publiclyAccessible: false,
      vpc: vpcConstruct.vpc,
      vpcSubnets: {
        subnets: vpcConstruct.isolatedSubnets,
      },
      securityGroups: [this.securityGroup],
      credentials: rds.Credentials.fromSecret(this.secret),
      monitoringInterval: cdk.Duration.minutes(isProduction ? 1 : 5),
      enablePerformanceInsights: true,
      performanceInsightRetention: isProduction
        ? rds.PerformanceInsightRetention.DEFAULT
        : rds.PerformanceInsightRetention.MONTHS_7,
      autoMinorVersionUpgrade: true,
      allowMajorVersionUpgrade: !isEphemeral,
      deleteAutomatedBackups: !isProduction,
      backupRetention: isProduction ? cdk.Duration.days(14) : cdk.Duration.days(1),
      networkType: rds.NetworkType.IPV4,
    };

    const finalProps = isProduction
      ? { ...databaseProps, kmsKey }
      : databaseProps;

    if (isEphemeral) {
      return new rds.DatabaseInstance(this, 'Database', {
        ...finalProps,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    return new rds.DatabaseInstance(this, 'Database', {
      ...finalProps,
      removalPolicy,
    });
  }
}
