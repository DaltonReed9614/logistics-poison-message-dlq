import { z } from "zod";
import { decideDelivery, deliveryEventSchema, type DeliveryDecision } from "./delivery_event.js";
import { infrai } from "./infrai_queue.js";

const consumedMessageSchema = z.object({
  message_id: z.string().min(1),
  payload: z.unknown()
});

const consumeDataSchema = z.object({
  messages: z.array(consumedMessageSchema)
});

export async function handleMessage(
  rawMessage: unknown,
  persist: (decision: DeliveryDecision) => Promise<void>
): Promise<DeliveryDecision> {
  const message = consumedMessageSchema.parse(rawMessage);
  const event = deliveryEventSchema.parse(message.payload);
  const decision = decideDelivery(event);

  await persist(decision);
  await infrai.queue.ack(message.message_id);
  return decision;
}

async function runOnce(): Promise<void> {
  const batch = consumeDataSchema.parse(await infrai.queue.consume(10, 30));

  for (const message of batch.messages) {
    try {
      const decision = await handleMessage(message, async (next) => {
        console.log("storefront fulfillment update", next);
      });
      console.log("acknowledged", message.message_id, decision.action);
    } catch (error) {
      console.error("delivery job left unacknowledged", message.message_id, error);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnce().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
