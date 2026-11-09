import assert from "node:assert/strict";
import test from "node:test";
import { decideDelivery, deliveryEventSchema } from "../src/delivery_event.js";

test("a damaged parcel opens an exception instead of recording delivery", () => {
  const event = deliveryEventSchema.parse({
    kind: "shipment.exception",
    shipmentId: "shp_1048",
    orderId: "ord_7821",
    occurredAt: "2026-09-27T08:30:00.000Z",
    exception: {
      code: "PARCEL_DAMAGED",
      note: "Outer carton crushed at the depot"
    }
  });

  assert.deepEqual(decideDelivery(event), {
    action: "open-exception",
    orderId: "ord_7821",
    exceptionCode: "PARCEL_DAMAGED"
  });
});
