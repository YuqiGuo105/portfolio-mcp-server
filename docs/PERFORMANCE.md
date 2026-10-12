# Public MCP latency and cost

The public client still uses the existing MCP protocol and tool names. No new
service, always-on instance, paid model call, or background timer is introduced.

## Request path

- Search refresh overlaps four content-type reads, at most four calls per
  instance, with concurrent searches sharing one refresh. Each read has an
  eight-second deadline; all outcomes settle before returning an error.
- Search projection already reads admin-service directly when its credential is
  configured. It does not always traverse the Java gateway.
- `get_profile` overlaps its independent public-profile and experience reads.
- Other public gateway reads have an eight-second deadline with no automatic
  retry. Admin writes and career operation deadlines remain unchanged.
- JSON text blocks use compact serialization. `structuredContent`, pagination,
  status fields, and all existing tools remain compatible.
- Public read telemetry goes to one structured stdout event, not a synchronous
  POST to admin-service. Authenticated operation auditing is unchanged. Public
  calls therefore no longer appear as new rows in the central operation-event
  store; use Cloud Logging for these read-only performance events.

## Privacy and cost boundaries

The 60-second search metadata TTL and fail-closed refresh behavior are unchanged.
Refresh failures do not return stale access metadata or a partial index. A
refresh invalidated while in flight cannot publish its previous permissions.
Original bodies and lists still perform live authorized reads; the internal
search projection can contain restricted text and is not a public document cache.

Do not extend the TTL or return full bodies from that projection without a
reliable permission-revocation/invalidation design. Similarly, eagerly calling
vector search for every keyword search would increase model calls. Existing
conditional knowledge fallback is retained.

Production stays at zero minimum / one maximum instance, 256 MiB, one CPU and
request-based CPU allocation. No periodic keep-alive or mandatory startup
prefetch: a health check or social-link lookup must not wake Java services just
to fill an unused or soon-expired search cache. This does not eliminate genuine
cold starts, and actual billing depends on traffic and logging volume.

## Evidence without more model calls

- `get_overview` reads a checked-in, dated editorial card. It has no network cost
  and is not a claim about live employment or deployment state.
- `search_portfolio` returns at most three 650-character excerpts. Each uses a
  fresh authorized source read, in parallel; cached full text never leaves the
  ranking engine. `includeSnippets: false` retains metadata-only latency.
  This can add one backend round trip to a cache hit, but avoids an additional
  client/model tool round when the excerpt answers the question.
- `search_knowledge` overlaps its existing semantic call with lexical recall,
  then merges source-deduplicated evidence. It adds no embedding/model calls.
  A semantic outage can return independently verified lexical evidence with an
  explicit coverage warning; no evidence plus an outage is an error, not absence.
- `match_role` accepts at most eight client-extracted requirements. It shares one
  catalog, deduplicates candidate reads, caps them at eight with concurrency three,
  and returns two quotes per requirement at most. No LLM or fit score is used.
- The knowledge service checks current content-table access in bounded batches,
  including publication status and `life_blogs.require_login`. Legacy versioned
  chunks are usable only after that check. Restricted original text is not public
  evidence; separately reviewed PROFILE/OWNER_QA answers keep their own approval gate.

No schema migration, bulk re-embedding, background timer, or larger instance is
required for this change. Per-request reads are bounded but are not literally free.

## Measurement

Run the same small, public, read-only sample before and after a release:

```sh
node scripts/benchmark-public.mjs https://www.yuqi.site/mcp
```

It reports client wall time and text bytes, including the Vercel/MCP transport.
It makes 14 tool calls, including one knowledge lookup; it is not a load test or
a statistically meaningful p95 benchmark. A first request need not be cold.

Cloud Logging filter:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="portfolio-mcp-server"
jsonPayload.event="mcp.public_tool"
```

Events carry `toolName`, `status`, `durationMs`, `responseBytes` on success, an optional validated trace ID,
and bounded `phases`: catalog hit/miss/coalesced, catalog refresh, index build,
projection and gateway calls. No arguments, query text, response body, user
email, IP, tokens or arbitrary correlation headers are logged. Phase times
overlap and must not be summed. Gateway timing includes downstream processing;
it is not a separate measurement of Gemini embedding time. Use sufficient
per-tool samples for p50/p95, splitting hits, refreshes and failed requests.

Cloud Run captures [structured stdout logs](https://docs.cloud.google.com/run/docs/logging).
Under [request-based billing](https://docs.cloud.google.com/run/docs/configuring/billing-settings),
post-response CPU is not guaranteed; telemetry must not rely on an unawaited
background HTTP request.
