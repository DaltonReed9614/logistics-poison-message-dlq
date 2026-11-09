export {};

const event = {
  kind: "shipment.delivered",
  shipmentId: "shp_1048",
  orderId: "ord_7821",
  occurredAt: "2026-09-27T08:30:00.000Z",
  proof: {
    objectKey: "proofs/shp_1048/signature.png",
    sha256: "b".repeat(64),
    signedBy: "Lin Chen"
  }
};

const response = await fetch("http://localhost:3000/delivery-events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": `delivery-${event.shipmentId}-${event.occurredAt}`
  },
  body: JSON.stringify(event)
});

console.log(response.status, await response.json());
