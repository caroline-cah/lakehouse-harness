import { randomBytes } from "node:crypto";

export interface TraceHeaders {
  /** W3C `traceparent`, sampled. */
  traceParent: string;
  /** X-Ray `X-Amzn-Trace-Id`, derived from the same trace id. */
  traceId: string;
}

/**
 * A fresh, explicitly sampled trace for the runtime invocation. Without it, calls that originate inside Lambda
 * inherit a not-sampled X-Ray context and the agent's spans are never exported (verified 2026-10-22).
 * X-Ray trace ids embed the epoch in the first 8 hex chars, so both headers come from one id.
 */
export function traceHeaders(now: number = Date.now()): TraceHeaders {
  const epochHex = Math.floor(now / 1000)
    .toString(16)
    .padStart(8, "0");
  const rest = randomBytes(12).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  return {
    traceParent: `00-${epochHex}${rest}-${spanId}-01`,
    traceId: `Root=1-${epochHex}-${rest};Sampled=1`,
  };
}
