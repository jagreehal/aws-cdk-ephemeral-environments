import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SsmConfigConstructProps {
  readonly prefix: string;
  readonly stackEnvName: string;
  readonly removalPolicy: cdk.RemovalPolicy;
}

export class SsmConfigConstruct extends Construct {
  public readonly databasePassword: ssm.StringParameter;
  public readonly apiKey: ssm.StringParameter;
  public readonly sentryDsn: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: SsmConfigConstructProps) {
    super(scope, id);

    const { prefix, stackEnvName, removalPolicy } = props;

    this.databasePassword = this.createSecureParameter(
      `${prefix}-${stackEnvName}/database/password`,
      'Database password',
      removalPolicy,
    );

    this.apiKey = this.createSecureParameter(
      `${prefix}-${stackEnvName}/api/key`,
      'API key',
      removalPolicy,
    );

    this.sentryDsn = this.createParameter(
      `${prefix}-${stackEnvName}/sentry/dsn`,
      'Sentry DSN',
      removalPolicy,
    );
  }

  private createSecureParameter(
    name: string,
    description: string,
    removalPolicy: cdk.RemovalPolicy,
  ): ssm.StringParameter {
    return new ssm.StringParameter(this, name.replace(/[\/]/g, '-'), {
      parameterName: `/${name}`,
      description: `${description} for ${name}`,
      stringValue: 'placeholder-value-change-me',
      tier: ssm.ParameterTier.STANDARD,
    });
  }

  private createParameter(
    name: string,
    description: string,
    removalPolicy: cdk.RemovalPolicy,
  ): ssm.StringParameter {
    return new ssm.StringParameter(this, name.replace(/[\/]/g, '-'), {
      parameterName: `/${name}`,
      description: `${description} for ${name}`,
      stringValue: 'placeholder-value-change-me',
    });
  }
}