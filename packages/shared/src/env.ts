/**
 * Reads a required setting from the environment, or a fallback when one is given.
 * Lambda handlers and the runtime call this once at module load so a misconfigured deployment fails on the first
 * invocation with the name of the missing variable, instead of somewhere deep in a request.
 */
export function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

/** The region every AWS client in this project uses: the Lambda's own region, or the project default. */
export function awsRegion(): string {
  return process.env.AWS_REGION ?? "eu-central-1";
}
