import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { deliveryEventSchema } from "./delivery_event.js";
import { InfraiError, infrai } from "./infrai_queue.js";

const port = Number(process.env.PORT ?? 3000);
const queueName = process.env.LOGISTICS_QUEUE ?? "storefront-logistics";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/delivery-events") {
      const event = deliveryEventSchema.parse(await readJson(request));
      const idempotencyKey = request.headers["idempotency-key"] ?? `shipment-${event.shipmentId}-${event.occurredAt}`;
      const result = await infrai.queue.publish(event, String(idempotencyKey));
      json(response, 202, { accepted: true, result });
      return;
    }

    if (request.method === "GET" && request.url === "/dead-letters") {
      json(response, 200, { deadLetters: await infrai.queue.dlq.list(queueName) });
      return;
    }

    if (request.method === "POST" && request.url === "/dead-letters/redrive") {
      const result = await infrai.queue.dlq.redrive(queueName, `redrive-${randomUUID()}`);
      json(response, 202, { redriven: true, result });
      return;
    }

    json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      json(response, 400, { error: "Invalid delivery event" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      json(response, status, { error: error.code });
      return;
    }
    console.error(error);
    json(response, 500, { error: "Request failed" });
  }
});

server.listen(port, () => {
  console.log(`logistics service listening on http://localhost:${port}`);
});
