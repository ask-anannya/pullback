import * as z from "zod/v4";
import { env } from "@/lib/env";
import { audit } from "@/audit/log";

/**
 * Provider-agnostic LLM wrapper. Nothing outside src/llm/ imports the Gemini SDK.
 * Every response is validated with Zod; on failure we retry once with the error,
 * then throw LlmUnavailableError so callers can route the item to needs_review.
 */

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export type CompleteArgs<T extends z.ZodType> = {
  model: "reasoning" | "fast";
  system: string;
  prompt: string;
  schema: T;
  promptVersion: string;
  temperature?: number;
  incidentId?: string | null;
  /** Optional images sent with the prompt (vision). Base64 data, no data: prefix. */
  images?: { mimeType: string; data: string }[];
};

type GenAI = {
  models: {
    generateContent(args: unknown): Promise<{
      text?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    }>;
  };
};

let client: GenAI | null = null;
async function getClient(): Promise<GenAI> {
  if (client) return client;
  const { GoogleGenAI } = await import("@google/genai");
  // v1beta: system instructions and responseJsonSchema are not enabled on v1.
  client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, apiVersion: "v1beta" }) as unknown as GenAI;
  return client;
}

/** JSON Schema for Gemini's responseJsonSchema, derived from the Zod schema. */
export function toResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return stripIntBounds(js) as Record<string, unknown>;
}

function stripIntBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripIntBounds);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER) continue;
      out[k] = stripIntBounds(v);
    }
    return out;
  }
  return node;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|timeout|timed out/i.test(msg);
}

async function callOnce(args: {
  model: string;
  system: string;
  prompt: string;
  responseJsonSchema: Record<string, unknown>;
  temperature: number;
  images?: { mimeType: string; data: string }[];
}) {
  const ai = await getClient();
  const contents = args.images?.length
    ? [{ role: "user", parts: [...args.images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })), { text: args.prompt }] }]
    : args.prompt;
  return ai.models.generateContent({
    model: args.model,
    contents,
    config: {
      systemInstruction: args.system,
      responseMimeType: "application/json",
      responseJsonSchema: args.responseJsonSchema,
      temperature: args.temperature,
      httpOptions: { timeout: args.images?.length ? 60_000 : 30_000 },
    },
  });
}

export async function complete<T extends z.ZodType>(args: CompleteArgs<T>): Promise<z.infer<T>> {
  if (!env.geminiConfigured()) throw new LlmUnavailableError("GEMINI_API_KEY is not set");
  const model = args.model === "reasoning" ? env.modelReasoning() : env.modelFast();
  const responseJsonSchema = toResponseSchema(args.schema);
  const temperature = args.temperature ?? 0;

  let prompt = args.prompt;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await callOnce({ model, system: args.system, prompt, responseJsonSchema, temperature, images: args.images });
    } catch (err) {
      if (!isRetryable(err)) throw new LlmUnavailableError(String((err as Error).message ?? err));
      await sleep(1500 * (attempt + 1));
      try {
        res = await callOnce({ model, system: args.system, prompt, responseJsonSchema, temperature, images: args.images });
      } catch (err2) {
        throw new LlmUnavailableError(String((err2 as Error).message ?? err2));
      }
    }

    const usage = res.usageMetadata ?? {};
    let parsed: z.infer<T> | undefined;
    try {
      const json = JSON.parse(res.text ?? "");
      const r = args.schema.safeParse(json);
      if (r.success) parsed = r.data;
      else lastError = z.prettifyError(r.error);
    } catch (e) {
      lastError = `Invalid JSON: ${(e as Error).message}`;
    }

    await audit({
      actor: "agent",
      eventType: "llm_call",
      incidentId: args.incidentId ?? null,
      payload: {
        model,
        promptVersion: args.promptVersion,
        attempt: attempt + 1,
        valid: parsed !== undefined,
        error: parsed === undefined ? lastError : undefined,
        promptTokens: usage.promptTokenCount ?? null,
        outputTokens: usage.candidatesTokenCount ?? null,
        totalTokens: usage.totalTokenCount ?? null,
      },
    });

    if (parsed !== undefined) return parsed;
    prompt = `${args.prompt}\n\nYour previous answer was rejected by validation:\n${lastError}\nReturn JSON that matches the schema exactly.`;
  }
  throw new LlmUnavailableError(`Validation failed twice: ${lastError}`);
}
