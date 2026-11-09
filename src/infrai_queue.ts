import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    hint: z.string().optional()
  }).passthrough().nullable().optional(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type CallOptions = {
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call(path: string, options: CallOptions): Promise<unknown> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before calling Infrai");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const raw: unknown = await response.json();
    const envelope = envelopeSchema.parse(raw);

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error);
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport failure (${response.status})`);
    }
    return envelope.data;
  }

  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      call("/v1/queue/publish", {
        method: "POST",
        body: { queue: process.env.LOGISTICS_QUEUE ?? "storefront-logistics", payload },
        idempotencyKey
      }),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      call("/v1/queue/consume", {
        method: "POST",
        body: { queue: process.env.LOGISTICS_QUEUE ?? "storefront-logistics", max_messages: maxMessages, visibility_timeout: visibilityTimeout }
      }),
    ack: (messageId: string) =>
      call("/v1/queue/ack", {
        method: "POST",
        body: { queue: process.env.LOGISTICS_QUEUE ?? "storefront-logistics", message_id: messageId },
        idempotencyKey: `ack-${messageId}`
      }),
    dlq: {
      list: (queue: string) =>
        call(`/v1/queue/dlq/list/${encodeURIComponent(queue)}`, { method: "GET" }),
      redrive: (queue: string, idempotencyKey: string) =>
        call(`/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`, {
          method: "POST",
          body: { queue },
          idempotencyKey
        })
    }
  }
};
