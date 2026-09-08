# Durable MCP Operations

Admin write tools require a stable `_idempotencyKey` and any tool-specific confirmation.
Generate the key once per user intent and preserve it across client/network retries.
Reusing a key with different arguments returns `idempotency_conflict`.

The gateway atomically claims an operation in the Admin PostgreSQL database before
dispatch. The key is scoped to the authenticated actor and tool; results and state
transitions survive process restarts and multiple Cloud Run instances. Owner-account
writes use the same ledger while retaining the owner's verified authentication.

| State | Meaning | Client action |
| --- | --- | --- |
| RUNNING | A worker owns the dispatch | Poll `operation.get_status` |
| SUCCEEDED | The tool returned and its result was persisted | Verify any asynchronous indexing/email effects separately |
| RETRYABLE | Rejected before downstream dispatch | Wait `retryAfterMs`, invoke the original tool with the same key and arguments |
| FAILED_FINAL | Downstream rejected the request | Inspect the error; a corrected user intent needs a new key |
| UNKNOWN | Timeout, worker loss, or uncertain completion | Verify downstream effects; never automatically generate a replacement key |
| PREVIEW | Validated dry run, no downstream invocation | Obtain confirmation before a real write |

`operation.list` and `operation.get_timeline` provide caller-scoped operation metadata
and database-backed transitions. Stale dispatch leases become UNKNOWN, not a retry
permission. There is deliberately no generic force-retry or cancel endpoint for a
write that may already have committed. Use the domain recovery tool after checking
its actual state. Replaying a completed request returns the saved tool result.

The gateway propagates `Idempotency-Key` and `X-Operation-Id` to downstream HTTP
services. Downstream services have different transaction boundaries; this is not a
claim of global exactly-once delivery. Durable admission prevents concurrent MCP
dispatch, and uncertain outcomes require reconciliation.

Each HTTP adapter has a circuit breaker, semaphore bulkhead and rate limiter.
Reads may retry one 502/503/504 response with jitter within the overall timeout.
Writes are not automatically retried inside the adapter. Kafka consumers use bounded
exponential retries and require a successful DLQ/quarantine handoff before committing
the source offset. Indexing jobs stop after eight failures and expose DLQ status.

Alert prepare/apply state is stored in SQL. Applying a change locks its row and commits
the rule, revision and idempotent result in one transaction. Expired and conflicting
changes cannot be applied.

MCP logs contain argument field names and hashed identities, not resume contents,
private answers or raw error bodies. Operation transitions are persisted transactionally.
The broader operation journal is stored in SQL and projected to OpenSearch by recovery
workers; exhausted projection attempts remain available in SQL for investigation.

Email dispatch records SENDING before contacting SMTP. A crash or ambiguous SMTP failure
becomes UNKNOWN and is excluded from automatic retries. This avoids duplicate delivery
at the cost of requiring provider verification for uncertain messages. SENT means SMTP
accepted the message; it is not proof of inbox placement or reading.

## Verification

Run `npm test` for edge contracts. Gateway tests cover replay, changed payloads,
unavailable ledger, uncertain timeout, pre-dispatch rejection, circuit breaking,
write retry prohibition and audit redaction. Admin tests exercise concurrent admission,
restart recovery, principal isolation and stale lease fencing. Analytics and Notification
tests cover durable prepared changes and ambiguous SMTP dispatch.

The deployment test in `scripts/verify-durable-operations.mjs` requires existing
service credentials in environment variables, creates only a disabled test rule,
verifies duplicate/conflicting requests and operation status, and deletes that rule.
It does not send subscriber notifications.
