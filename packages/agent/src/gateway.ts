import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { McpClient } from "@strands-agents/sdk";

export interface GatewayConfig {
  gatewayUrl: string;
  tokenUrl: string;
  clientId: string;
  secretParam: string;
  region: string;
  scope?: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cached: CachedToken | undefined;
let secretCache: string | undefined;

async function clientSecret(cfg: GatewayConfig): Promise<string> {
  if (secretCache) return secretCache;
  const ssm = new SSMClient({ region: cfg.region });
  const r = await ssm.send(new GetParameterCommand({ Name: cfg.secretParam, WithDecryption: true }));
  secretCache = r.Parameter?.Value ?? "";
  if (!secretCache) throw new Error(`SSM parameter ${cfg.secretParam} is empty`);
  return secretCache;
}

/** Client-credentials token from Cognito, cached until five minutes before expiry. */
export async function gatewayToken(cfg: GatewayConfig, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.value;
  const secret = await clientSecret(cfg);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: cfg.scope ?? "lakehouse-gateway/invoke",
  });
  const r = await fetchImpl(cfg.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${cfg.clientId}:${secret}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!r.ok) throw new Error(`Cognito token request failed: ${r.status} ${await r.text()}`);
  const json = (await r.json()) as { access_token: string; expires_in: number };
  cached = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.value;
}

/** The gateway as a Strands tool source. One client per invocation; the caller disconnects when done. */
export async function gatewayTools(cfg: GatewayConfig): Promise<McpClient> {
  const token = await gatewayToken(cfg);
  return new McpClient({
    url: cfg.gatewayUrl,
    headers: { Authorization: `Bearer ${token}` },
    applicationName: "lakehouse-agent",
  });
}
