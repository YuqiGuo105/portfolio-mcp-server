# Admin media tools

These tools come from the Java gateway catalog. They are registered only on the
authenticated Admin MCP surface for a managed `ADMIN` role. Public MCP clients,
`VIEWER`, `EDITOR`, and `PUBLISHER` cannot discover or call them. The gateway and
the media HTTP API also enforce authorization independently.

| Operation | Tools |
|---|---|
| Inspect | `media.list`, `media.get`, `media.get_upload_limits` |
| Upload | `media.start_upload`, `media.resume_upload`, `media.complete_upload` |
| Edit title/description | `media.update` |
| Check references / logically delete | `media.check_delete`, `media.delete` |
| Retry failed processing | `media.retry_processing` |
| Article video references | `media.get_article`, `media.attach_to_article`, `media.detach_from_article` |

All writes require explicit user approval (`_confirmed: true`) and a stable
`_idempotencyKey` (8-200 characters). Retries of the same action use the same key
and unchanged arguments. An uncertain outcome is not permission to start a new
upload or transcode: inspect `operation.get_status` and `media.get` first.

## Upload

1. Read `media.get_upload_limits` and confirm the local file and potential costs.
2. Call `media.start_upload` with filename, MIME type, size in bytes, kind `VIDEO`,
   and optional title. Do not pass a remote URL or base64 video in tool arguments.
3. A file-capable client PUTs each binary part directly to the returned temporary
   signed URL. A chat client without file-transfer capability can manage media
   but must use the existing admin media uploader to transfer the file.
4. Call `media.complete_upload` with the returned `assetId` as `id` and `uploadId`.
5. Poll `media.get` until `READY`, and inspect the playback manifest and jobs.
   `PROCESSING` means queued work, not successful playback. Uploading does not
   attach the video to a homepage or article.

Signed PUT URLs are short-lived capabilities. Never expose them in prose or
logs. Durable operation receipts retain upload identifiers, not the signed
URLs. After a successful replay, use `media.resume_upload` with a fresh key to
renew URLs for the same unfinished upload; do not start another upload.

## Article publishing

For a project or technical blog, use the existing article content and publishing
workflow. No project-specific video URL is hardcoded into the frontend.

1. Create the article with the existing admin content tools, if it does not exist.
2. Upload the video and wait for `media.get` to report `READY`.
3. Read `media.get_article` with `sourceType: PROJECT` or `BLOG` and the article's
   `sourceId`. It returns current video/media IDs and a `contentHash`.
4. Call `media.attach_to_article` with those identifiers, the video `id`, and
   `expectedContentHash`. `position` is `START` (default) or `END`. This inserts a
   `<figure class="media-asset" data-media-id="..." data-media-kind="VIDEO"></figure>`
   into the database article HTML, leaving the other bytes, including Mermaid
   source, unchanged. Reattaching the same video does not duplicate the figure.
5. Review the article, then explicitly invoke the existing
   `admin.publish_content` tool only with the user's publication approval.
   Publication validates referenced media before producing versions, indexing
   jobs, and notification outbox events. Unfinished, deleted, or missing media
   cause the publication transaction to roll back.

`media.detach_from_article` removes the figure reference, not the video. It also
requires the latest `expectedContentHash`. A concurrent edit returns a conflict;
reread the article and obtain confirmation instead of overwriting newer text.
Attach/detach require `ADMIN`, write confirmation and an idempotency key. They
write the existing content audit trail but do not publish or notify subscribers.
Edits to an already-public article can become visible after page-cache refresh.

Only private **originals** are kept private. A `READY` processed video can already
be fetched via the public media catalog, independently of the article's draft
state. Do not use this workflow for confidential draft footage. Life blogs and
homepage video placements are not changed by these article tools.

The existing renderer resolves database asset IDs into the processed playback
manifest and shared adaptive player. Attaching a reference does not re-encode the
video or add a background polling loop to public pages.

## Editing and deletion

Read the current `metadataVersion` with `media.get`. Pass it as `expectedVersion`
to `media.update` or `media.delete`; stale versions fail with a conflict. Metadata
updates replace title and description only, without modifying bytes or queuing
another transcode. Omitted description clears it.

Run `media.check_delete` before requesting confirmation. Deletion rechecks active
jobs and tracked homepage/article/draft references. Only unused `READY` or
`FAILED` assets can be deleted. This is **logical deletion**, not a storage purge:
the library and public catalog hide the asset, but originals, processed files,
and cached playback URLs are retained. Untracked external copies cannot be
detected or revoked. No permanent-delete tool is exposed.

Metadata changes and deletions write an audit record in the same transaction.
Failed audit writes roll back the change. Upload and transcode operations also
retain the existing durable MCP operation receipts.

## Release and verification

Release order: admin-service with Flyway `V15__media_management.sql`, then the
gateway catalog, then this MCP edge. Do not expose the catalog before its API
exists. No new credentials, model calls, background polling, or frontend bundle
are introduced. Upload/retry use the existing storage and transcode limits and
still incur their normal costs; logical deletion does not reduce storage costs.

Local coverage includes real PostgreSQL migrations, authenticated HTTP metadata
CRUD, row-version concurrency, in-use deletion protection, rollback on audit
failure, article HTML round trips and stale-body protection, publication rollback
for unready video, durable receipt redaction/replay, gateway argument/role/confirmation
checks, and MCP protocol visibility/call tests for public and managed roles.
These checks do not claim a production MCP upload or cloud deletion test.

`node scripts/verify-admin-media.mjs` performs read-only deployed checks using
server-side `MCP_GATEWAY_URL`, `MCP_GATEWAY_INTERNAL_TOKEN`, `ADMIN_SERVICE_URL`
and `PUBLIC_MCP_URL`. Optionally supply `MEDIA_VERIFY_PROJECT_ID` to inspect an
existing project's media references. It checks anonymous rejection at all three
layers, all 13 catalog contracts, lesser-role denial, actual ADMIN reads and the
public MCP catalog. Supply secrets in the process environment, never command-line
arguments or Git. The script does not print asset data or credentials and does
not upload, mutate, delete or publish anything.
