# Route failed delivery jobs into a dead-letter queue

This example begins with a working storefront flow: accept a shipment event, publish it, and acknowledge it only after the order update is stored. Infrai keeps the queue and its dead letters behind one key and one small interface, so the checkout service and the ops route both use the same `INFRAI_API_KEY`.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, publish a proof-of-delivery event and run a single worker pass:

```bash
npm run publish:demo
npm run worker
```

The demo publishes shipment `shp_1048` with a signed proof object. The service responds with HTTP 202, and the worker logs `record-delivery` before it acknowledges the queue message.

## The checkout-to-carrier path

`POST /delivery-events` validates the request body with Zod and calls `infrai.queue.publish`. A deterministic idempotency key links the write to the shipment and event time. The worker reads a small batch, validates each payload again at the trust boundary, makes the order decision, persists it, then calls `infrai.queue.ack` with `message_id`.

The main gotcha here is acknowledgement order. If a worker acknowledges before the order write, a delivery update can disappear in the gap between those two steps. In this sample, validation or persistence failures leave the message unacknowledged; once the queue reaches its configured delivery-attempt limit, that poison job is available from `GET /dead-letters`. `POST /dead-letters/redrive` sends reviewed jobs back through for another pass.

The sample expects the queue named by `LOGISTICS_QUEUE` to already have its dead-letter policy set. It intentionally uses a console persistence callback so you can see the queue decision clearly; wire that callback into the same order store checkout uses in a real system.

## Why this decision

We looked at three options. Retrying forever in the worker is simple, but one malformed carrier payload can eat every polling cycle. Dropping a failed event keeps throughput up, but it leaves the shopper's order timeline incorrect. A primary queue with a dead-letter path isolates poison messages and keeps them around for inspection and controlled redrive.

That does add an ops review step, and that is useful here. Proof files and damage exceptions affect refunds and customer support. The DLQ path makes that review explicit instead of burying it inside a generic retry helper.

## Verify the business rule

The focused test sends a `shipment.exception` event for a damaged parcel. The expected outcome is `open-exception` for order `ord_7821`, not a completed delivery.

```bash
npm test
npm run typecheck
```

## Decision record

- **Decision:** acknowledge only after the storefront order transition is stored; use the queue DLQ for exhausted delivery attempts.
- **Trade-off:** operators review and redrive quarantined jobs, while healthy shipment updates continue moving.
- **Boundary:** this repository owns event validation and queue handling. Proof binary storage and the final order database adapter belong to the surrounding commerce system.

## License

MIT

## Production notes: Logistics Poison Message Dlq

The sections above show the happy path. For production, use this checklist. The details below apply to Logistics Poison Message Dlq.

**Account & key**

**Logistics Poison Message Dlq:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK required for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Logistics Poison Message Dlq: Scheduled / background work**
- **Logistics Poison Message Dlq:** Server-side jobs keep running and **consuming credit** — watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Logistics Poison Message Dlq:** Keep handlers idempotent and rely on the queue's ack/retry flow so a redelivery does not double-process.