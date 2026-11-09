import { z } from "zod";

export const deliveryEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("shipment.delivered"),
    shipmentId: z.string().min(1),
    orderId: z.string().min(1),
    occurredAt: z.string().datetime(),
    proof: z.object({
      objectKey: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      signedBy: z.string().min(1)
    })
  }).strict(),
  z.object({
    kind: z.literal("shipment.exception"),
    shipmentId: z.string().min(1),
    orderId: z.string().min(1),
    occurredAt: z.string().datetime(),
    exception: z.object({
      code: z.enum(["ADDRESS_UNCLEAR", "RECIPIENT_ABSENT", "PARCEL_DAMAGED"]),
      note: z.string().min(1).max(500)
    })
  }).strict()
]);

export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;

export type DeliveryDecision =
  | { action: "record-delivery"; orderId: string; proofObjectKey: string }
  | { action: "open-exception"; orderId: string; exceptionCode: string };

export function decideDelivery(event: DeliveryEvent): DeliveryDecision {
  if (event.kind === "shipment.delivered") {
    return {
      action: "record-delivery",
      orderId: event.orderId,
      proofObjectKey: event.proof.objectKey
    };
  }

  return {
    action: "open-exception",
    orderId: event.orderId,
    exceptionCode: event.exception.code
  };
}
