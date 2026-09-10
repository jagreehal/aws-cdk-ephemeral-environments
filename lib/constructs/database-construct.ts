import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { VpcConstruct } from './vpc-construct';

export interface DatabaseConstructProps {
  readonly namePrefix: string;
  readonly vpcConstruct: VpcConstruct;
  readonly isProduction: boolean;
  readonly isEphemeral: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly dbInstanceClass: string;
  readonly dbAllocatedStorage: number;
  readonly ecsSecurityGroup?: ec2.SecurityGroup;
}

const DB_PORT = 5432;
const INSTANCE_CLASS_PATTERN = /^db\.([a-z0-9]+)\.([a-z0-9]+)$/i;

export class DatabaseConstruct extends Construct {
  public readonly database: rds.DatabaseInstance;
  public readonly secret: secretsmanager.ISecret;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const {
      namePrefix,
      vpcConstruct,
      isProduction,
      isEphemeral,
      removalPolicy,
      dbInstanceClass,
      dbAllocatedStorage,
      ecsSecurityGroup,
    } = props;

    this.securityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      securityGroupName: `${namePrefix}-rds-sg`,
      vpc: vpcConstruct.vpc,
      allowAllOutbound: false,
      description: `Security group for ${namePrefix} RDS database`,
    });

    const kmsKey = new kms.Key(this, 'DatabaseKmsKey', {
      alias: `alias/${namePrefix}-rds-kms`,
      description: `KMS key for ${namePrefix} RDS database`,
      removalPolicy,
      enableKeyRotation: isProduction,
      pendingWindow: cdk.Duration.days(isProduction ? 30 : 7),
    });

    this.secret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `/${namePrefix}/rds/credentials`,
      removalPolicy,
      encryptionKey: kmsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'app_user' }),
        excludeCharacters: '"@/\\',
        generateStringKey: 'password',
      },
    });

    this.database = this.createDatabase({
      vpcConstruct,
      kmsKey,
      removalPolicy,
      isProduction,
      isEphemeral,
      dbInstanceClass,
      dbAllocatedStorage,
    });

    if (ecsSecurityGroup) {
      this.securityGroup.addIngressRule(
        ecsSecurityGroup,
        ec2.Port.tcp(DB_PORT),
        'Allow PostgreSQL from ECS containers',
      );
    } else {
      this.securityGroup.addIngressRule(
        ec2.Peer.ipv4(vpcConstruct.vpc.vpcCidrBlock),
        ec2.Port.tcp(DB_PORT),
        'Allow PostgreSQL from VPC',
      );
    }
  }

  /** Parse `db.t3.micro` into a CDK instance type, failing at synth rather than at deploy. */
  private parseInstanceType(dbInstanceClass: string): ec2.InstanceType {
    const match = INSTANCE_CLASS_PATTERN.exec(dbInstanceClass.trim());

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

    return ec2.InstanceType.of(ec2.InstanceClass[instanceClass], ec2.InstanceSize[instanceSize]);
  }

  private createDatabase(opts: {
    vpcConstruct: VpcConstruct;
    kmsKey: kms.Key;
    removalPolicy: cdk.RemovalPolicy;
    isProduction: boolean;
    isEphemeral: boolean;
    dbInstanceClass: string;
    dbAllocatedStorage: number;
  }): rds.DatabaseInstance {
    const {
      vpcConstruct,
      kmsKey,
      removalPolicy,
      isProduction,
      isEphemeral,
      dbInstanceClass,
      dbAllocatedStorage,
    } = opts;

    return new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: this.parseInstanceType(dbInstanceClass),
      storageEncrypted: true,
      // `kmsKey` is not a DatabaseInstance prop — the old spread silently dropped it, so prod was
      // encrypted with the default AWS-managed key rather than the CMK created above.
      storageEncryptionKey: isProduction ? kmsKey : undefined,
      multiAz: isProduction,
      allocatedStorage: dbAllocatedStorage,
      maxAllocatedStorage: isProduction ? dbAllocatedStorage * 2 : dbAllocatedStorage,
      publiclyAccessible: false,
      vpc: vpcConstruct.vpc,
      vpcSubnets: { subnets: vpcConstruct.isolatedSubnets },
      securityGroups: [this.securityGroup],
      credentials: rds.Credentials.fromSecret(this.secret),
      // Enhanced monitoring and Performance Insights beyond the free 7 days are both billed —
      // production only, an env that lives for one PR does not need them.
      monitoringInterval: isProduction ? cdk.Duration.minutes(1) : undefined,
      enablePerformanceInsights: isProduction,
      performanceInsightRetention: isProduction
        ? rds.PerformanceInsightRetention.DEFAULT
        : undefined,
      autoMinorVersionUpgrade: true,
      allowMajorVersionUpgrade: !isEphemeral,
      deleteAutomatedBackups: !isProduction,
      backupRetention: isProduction ? cdk.Duration.days(14) : cdk.Duration.days(1),
      networkType: rds.NetworkType.IPV4,
      removalPolicy,
    });
  }
}
