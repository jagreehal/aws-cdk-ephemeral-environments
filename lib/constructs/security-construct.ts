import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface SecurityConstructProps {
  readonly prefix: string;
  readonly stackEnvName: string;
  readonly isProduction: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
}

export class SecurityConstruct extends Construct {
  public readonly appRole: iam.Role;
  public readonly kmsKey: kms.Key;
  public readonly storageBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    const { prefix, stackEnvName, isProduction, removalPolicy } = props;

    this.kmsKey = this.createKmsKey(prefix, stackEnvName, removalPolicy, isProduction);
    this.storageBucket = this.createStorageBucket(prefix, stackEnvName, removalPolicy, isProduction);
    this.appRole = this.createAppRole(prefix, stackEnvName);
  }

  private createKmsKey(
    prefix: string,
    stackEnvName: string,
    removalPolicy: cdk.RemovalPolicy,
    isProduction: boolean,
  ): kms.Key {
    return new kms.Key(this, 'AppKmsKey', {
      alias: `alias/${prefix}-${stackEnvName}-app-kms`,
      description: `KMS key for ${prefix}-${stackEnvName} application`,
      removalPolicy,
      enableKeyRotation: isProduction,
      pendingWindow: cdk.Duration.days(isProduction ? 30 : 7),
    });
  }

  private createStorageBucket(
    prefix: string,
    stackEnvName: string,
    removalPolicy: cdk.RemovalPolicy,
    isProduction: boolean,
  ): s3.Bucket {
    const bucket = new s3.Bucket(this, 'StorageBucket', {
      removalPolicy,
      autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
      encryption: isProduction ? s3.BucketEncryption.KMS_MANAGED : s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: isProduction,
    });

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.StarPrincipal()],
        actions: ['s3:*'],
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      }),
    );

    bucket.addLifecycleRule({
      id: 'abort-incomplete-uploads',
      enabled: true,
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
    });

    if (isProduction) {
      bucket.addLifecycleRule({
        id: 'intelligent-tiering',
        enabled: true,
        transitions: [
          {
            storageClass: s3.StorageClass.INTELLIGENT_TIERING,
            transitionAfter: cdk.Duration.days(30),
          },
          {
            storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
            transitionAfter: cdk.Duration.days(90),
          },
        ],
      });
    }

    return bucket;
  }

  private createAppRole(prefix: string, stackEnvName: string): iam.Role {
    const role = new iam.Role(this, 'AppRole', {
      roleName: `${prefix}-${stackEnvName}-app-${cdk.Stack.of(this).account}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [this.storageBucket.bucketArn, `${this.storageBucket.bucketArn}/*`],
      }),
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
        resources: [this.kmsKey.keyArn],
      }),
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:${prefix}/${stackEnvName}/*`],
      }),
    );

    return role;
  }
}