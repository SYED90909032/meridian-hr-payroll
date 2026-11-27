import { GetSecretValueCommand, SecretsManagerClient, type SecretsManagerClientConfig } from '@aws-sdk/client-secrets-manager';
import type { Config } from '../config.js';

export interface SecretStore { get(name: string): Promise<string | undefined>; }
export class EnvSecretStore implements SecretStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async get(name: string): Promise<string | undefined> { return this.env[name]; }
}
export class AwsSecretsManagerStore implements SecretStore {
  private readonly client: SecretsManagerClient;
  constructor(private readonly secretId: string, region: string, endpoint?: string) {
    const cfg: SecretsManagerClientConfig = { region, ...(endpoint ? { endpoint } : {}) };
    this.client = new SecretsManagerClient(cfg);
  }
  async get(name: string): Promise<string | undefined> {
    const r = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretId }));
    if (!r.SecretString) return undefined;
    try {
      const value: unknown = JSON.parse(r.SecretString);
      if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>)[name] !== 'string') return undefined;
      return (value as Record<string, string>)[name];
    } catch { return undefined; }
  }
}
export function createSecretStore(cfg: Config): SecretStore {
  if (cfg.SECRETS_PROVIDER === 'aws-secrets-manager') return new AwsSecretsManagerStore(cfg.AWS_SECRETS_MANAGER_SECRET_ID!, cfg.KMS_REGION, cfg.KMS_ENDPOINT);
  return new EnvSecretStore();
}
