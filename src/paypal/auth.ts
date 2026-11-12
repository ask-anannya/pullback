import * as z from "zod/v4";
import { env } from "@/lib/env";
import { audit } from "@/audit/log";

/**
 * PayPal REST client: OAuth client-credentials token cache plus a typed fetch.
 * The sandbox is the only supported environment for this project.
 */

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
    public debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
  get issue(): string | undefined {
    const b = this.body as { details?: { issue?: string }[]; name?: string } | undefined;
    return b?.details?.[0]?.issue ?? b?.name;
  }
}

let cached: { token: string; expiresAt: number } | null = null;

export function resetTokenCache() {
  cached = null;
}

const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });

export async function getAccessToken(force = false): Promise<string> {
  if (!env.paypalConfigured()) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set");
  if (!force && cached && Date.now() < cached.expiresAt) return cached.token;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${env.paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError(`OAuth token request failed (${res.status})`, res.status, body);
  const t = TokenResponse.parse(body);
  // Refresh 60 seconds before PayPal's stated expiry.
  cached = { token: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
  return cached.token;
}

export type PayPalFetchOptions<T extends z.ZodType> = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  schema?: T;
  /** Short label for the audit log, e.g. "refund_capture". */
  label: string;
  incidentId?: string | null;
};

export async function paypalFetch<T extends z.ZodType = z.ZodUnknown>(
  path: string,
  opts: PayPalFetchOptions<T>,
): Promise<z.infer<T>> {
  const url = new URL(env.paypalBaseUrl() + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const doFetch = async (token: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...opts.headers };
    if (opts.idempotencyKey) headers["PayPal-Request-Id"] = opts.idempotencyKey;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    return fetch(url, { method: opts.method ?? "GET", headers, body });
  };

  let res = await doFetch(await getAccessToken());
  if (res.status === 401) res = await doFetch(await getAccessToken(true));

  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;

  await audit({
    actor: "system",
    eventType: "paypal_call",
    incidentId: opts.incidentId ?? null,
    payload: {
      label: opts.label,
      method: opts.method ?? "GET",
      path,
      status: res.status,
      idempotencyKey: opts.idempotencyKey,
      debugId,
      // PayPal's error body (name, message, details) so failures are diagnosable from the log.
      ...(res.ok ? {} : { error: json as Record<string, unknown> }),
    },
  });

  if (!res.ok) {
    const b = json as { message?: string; name?: string };
    throw new PayPalError(`${opts.label} failed (${res.status}): ${b?.name ?? ""} ${b?.message ?? ""}`.trim(), res.status, json, debugId);
  }
  return (opts.schema ? opts.schema.parse(json) : json) as z.infer<T>;
}
