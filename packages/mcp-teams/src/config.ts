export interface TeamsMcpConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TeamsMcpConfig {
  return {
    tenantId:     requireEnv(env, "TEAMS_TENANT_ID"),
    clientId:     requireEnv(env, "TEAMS_CLIENT_ID"),
    clientSecret: requireEnv(env, "TEAMS_CLIENT_SECRET"),
  };
}
