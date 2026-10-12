# Portfolio Search: Retrieval and Learning to Rank

This is a bounded, small-corpus MLE search implementation, not an LLM trained on
private articles. The website and existing MCP search tools share one service.

```text
Authenticated content API (4 bounded collection reads)
  -> versioned in-memory catalog, canonical URLs, access flags
Query -> Unicode/word normalization -> vocabulary-based typo correction
  -> BM25 + character-ngram recall -> candidate union
  -> pairwise-trained linear ranker (RRF fallback)
  -> public title/summary/link + sign-in indicator
  -> website search overlay / MCP search tools

Versioned relevance judgments -> feature extraction -> offline training
  -> development regression gate -> versioned JSON model -> serving
Consented click events -> request/model/position/content IDs for later analysis
```

## Implemented

- Existing BLOG, PROJECT, LIFE_BLOG and EXPERIENCE records; superseded drafts are
  excluded. Chinese/English aliases come from owner-managed content tags, not a
  city dictionary in application code.
- Established BM25 and edit-distance libraries; eight ranking features and a
  scikit-learn pairwise logistic model. Serving is a local dot product.
- An ADMIN-only `/api/admin/content/search-projection` endpoint returns nested
  `search: {schemaVersion, text, requiresLogin, truncated}`. Normal Admin/MCP
  content lists stay compact and do not carry original bodies. The projection
  supports body recall in one batch, without per-result detail calls.
- Search previews never serialize the internal body, raw records or credentials.
  Login-gated originals remain protected by the existing detail-page auth check.
- Source/category filters, stable pagination, model/index versions, coverage and
  request IDs. Invalid queries return 400; upstream failures return 503, not an
  incorrect empty-success response.
- Website click telemetry reuses existing consent/privacy gates. No raw query is
  collected. Clicks alone are not unbiased relevance labels or automatic training.

## Cost and Limits

No new always-on service, vector database, GPU or query-time paid model is needed
for website search. The existing MCP public-knowledge fallback is retained and
may still incur its existing embedding/retrieval cost.
It is capped at 8 seconds. If it fails after article matches are found, those
previews remain available with `evidenceStatus: UNAVAILABLE`; no verified answer
is claimed. If neither retrieval path is available, the tool returns an error.

The serving catalog has a 60-second single-flight cache and a 10-second failure
backoff. Four content-type reads run in parallel, with an eight-second deadline
per request inside a twelve-second I/O budget. All reads settle before publishing
the complete index or returning a failure. See [latency and cost](PERFORMANCE.md).
Word segmentation consumes each record immediately instead of retaining segment
objects for entire articles. A 64 MB heap regression test rebuilds sixteen
40,000-character bilingual documents twice and verifies tail-term recall.
Expired permission metadata is not served on refresh failure. Body projection is
capped at 40,000 characters with explicit truncation metadata. A collection with
50 or more rows fails explicitly until paginated ingestion is implemented;
this release is sized for the current 16 active records, not a large corpus.

Public discoverability of restricted article metadata is intentional. A search
hit can imply that a term occurs in a restricted article. Do not index genuinely
private records; body access is a separate permission boundary.

## Model Evidence

`evaluation/search/corpus.json` contains real discoverable metadata captured for
reproducible tests, not the live production data source. Judgments are provisional
agent-curated labels. Train/evaluation topics are disjoint, but development queries
were inspected while fixing recall. The 13-query regression set is not an unbiased
held-out benchmark. Candidate and RRF both score 1.0 on NDCG@5, MRR and Recall@5;
this demonstrates no regression on these examples, **not ranking uplift**.

Next validation: owner-reviewed relevance labels, a larger untouched benchmark,
and latency/zero-result/click analysis. Do not auto-promote from biased clicks.

## Run and Verify

```sh
npm ci
npm run build
npm test
python3 -m venv .venv-search
.venv-search/bin/pip install -r evaluation/search/requirements.txt
.venv-search/bin/python scripts/train-search.py
SEARCH_PREVIEW_URL=http://127.0.0.1:3092 node scripts/verify-search-browser.mjs
```

Use `CHROMIUM_CHANNEL=chrome` for an installed Chrome instead of Playwright's
downloaded Chromium. Browser checks cover desktop/mobile, bilingual and typo
queries, filters, errors, keyboard focus, and the anonymous original-article gate.

Runtime: existing `MCP_GATEWAY_URL` and `MCP_GATEWAY_INTERNAL_TOKEN`, plus
`ADMIN_SERVICE_URL` and `SEARCH_PROJECTION_ADMIN_SECRET` for the ADMIN-only
projection. Without projection configuration (or with an old server returning
404), search falls back to metadata and reports that coverage explicitly.
Authorization errors and outages do not silently bypass this boundary.
The current older Admin deployment maps the missing projection route to 500
rather than 404. Until step 1 is deployed, leave the projection secret unset for
an explicitly metadata-only local preview. Do not treat arbitrary 500s as a
compatibility fallback.
The deployment binds this secret to the existing `ADMIN_SECRET` in Secret
Manager. It is not interchangeable with `INTERNAL_API_TOKEN` and is never sent
to browsers or models.
Frontend: `MCP_SEARCH_URL` points to this server's `/api/search`.
Set `SEARCH_RANKER=baseline` to use RRF without replacing the model artifact.

## Release Order

1. Deploy Admin Service's authenticated full-text projection and test its shape.
2. Deploy MCP search and smoke-test `/api/search` plus `search_articles`.
3. Deploy the frontend and verify anonymous sign-in-gated navigation.
4. Deploy the indexer schema/body fix and explicitly reindex when authorized.

Before step 1, serving supports existing metadata only and reports
`coverage.metadataOnly`; it must not be described as full-text production search.
The indexer schema fix does not resolve unrelated Kafka/SQL infrastructure errors.

## Local Verification (2026-09-16)

- MCP: 88 tests passed, including real HTTP/MCP transport parity, catalog failure,
  permissions, public-body exclusion and ranking regression checks.
- Admin/indexer: 80 tests passed; 9 independent PostgreSQL tests were skipped.
  Local Java 25 required `-Dnet.bytebuddy.experimental=true`; production targets
  the repository's Java version, not a runtime upgrade.
- Frontend proxy: 4 tests passed. Production build passed with pre-existing lint
  warnings. Modified search components passed focused lint without warnings.
- Chrome: 1440px and 390px checks passed for Chinese/English/typo queries,
  categories, empty results, 503 recovery, keyboard focus and layout. Anonymous
  navigation to the production travel article still required sign-in.
- The built local preview uses the real deployed metadata catalog (16 active
  records), not fixture results. Full-text projection was checked through the
  protected local HTTP controller contract and retrieval tests; it is not yet
  available on production. No deployment or commit was performed.

Observed loopback latency for one 10-request metadata sample: first refresh
about 5 seconds, subsequent requests 3-4ms. This is not production p95 latency.

References: [OpenSearch relevance evaluation](https://docs.opensearch.org/latest/search-plugins/search-relevance/evaluate-search-quality/),
[RRF](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/rrf/).
