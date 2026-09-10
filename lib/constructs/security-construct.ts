import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface SecurityConstructProps {
  readonly namePrefix: string;
  readonly isProduction: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
}

export class SecurityConstruct extends Construct {
  public readonly kmsKey: kms.Key;
  public readonly storageBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    const { namePrefix, isProduction, removalPolicy } = props;

    this.kmsKey = new kms.Key(this, 'AppKmsKey', {
      alias: `alias/${namePrefix}-app-kms`,
      description: `KMS key for ${namePrefix} application`,
      removalPolicy,
      enableKeyRotation: isProduction,
      pendingWindow: cdk.Duration.days(isProduction ? 30 : 7),
    });

    this.storageBucket = this.createStorageBucket(removalPolicy, isProduction);
  }

  private createStorageBucket(removalPolicy: cdk.RemovalPolicy, isProduction: boolean): s3.Bucket {
    const bucket = new s3.Bucket(this, 'StorageBucket', {
      removalPolicy,
      autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
      // Production encrypts with the app key created above; ephemeral envs use the free S3-managed
      // key rather than paying for a CMK that dies with the PR.
      ...(isProduction
        ? { encryption: s3.BucketEncryption.KMS, encryptionKey: this.kmsKey }
        : { encryption: s3.BucketEncryption.S3_MANAGED }),
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
}
