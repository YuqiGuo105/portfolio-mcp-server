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
| Homepage Introduction | `media.get_presentation`, `media.set_presentation`, `media.disable_presentation` |

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

If the client's network policy denies the signed storage domain, stop and ask
for that domain to be authorized, or hand the upload to the authorized admin
uploader. A signed URL grants storage authorization; it cannot override the AI
client's own network policy. Do not invent a proxy, fetch private originals, or
report an upload as completed without sending the bytes and completing it.

## Homepage Introduction

The homepage is a named placement, not an article. It now uses the same uploaded
READY video assets; no Mac-only publishing script or additional credentials are
needed. The existing MP4 presentation remains compatible until explicitly replaced.

1. Upload and complete the file as above; wait for `media.get` to report `READY`.
2. Read `media.get_presentation` with `placementKey: "yuqi-intro"`.
3. After the user approves the replacement, call `media.set_presentation` with
   the same placement key, the READY video UUID as `id`, and `expectedRevision`
   from the read. Include `_confirmed: true` and a unique `_idempotencyKey`.
   Optional `title` is 1-300 characters. Optional `chapters` is an array of up to
   30 `{seconds, title}` entries, strictly increasing within the video duration.
   Omission clears chapters rather than copying old timestamps to a different video.
4. Re-read the placement to verify the saved asset and revision, then check the
   homepage after ISR refresh (300-second revalidation interval; refresh occurs
   on a subsequent request). A successful write is not proof of public playback.

Only processed HLS, poster and rendition paths are used. The short preview MP4
is never substituted for the full introduction. The player loads HLS only when
opened, supports Auto/manual quality and stops on close. This operation does not
edit articles, send subscriber notifications or start another transcode.

To hide the entrance, read the current revision and explicitly confirm
`media.disable_presentation`. This preserves the asset, files and audit history.
To restore it, re-read and set the approved asset again. A stale revision rejects
the write; do not overwrite a newer placement by automatically obtaining a new
revision. Concurrent initial creation is also protected.

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

Release order for homepage placements: deploy the compatible frontend player,
then admin-service, then the gateway catalog and MCP edge. The existing media
schema (through `V15__media_management.sql`) is reused without a new migration.
Do not expose the catalog before its API exists. No new credentials, model calls,
or background polling are introduced; HLS uses the already-installed lazy runtime.
Upload/retry use the existing storage and transcode limits and
still incur their normal costs; logical deletion does not reduce storage costs.

Local coverage includes real PostgreSQL migrations, authenticated HTTP metadata
CRUD, row-version concurrency, in-use deletion protection, rollback on audit
failure, article HTML round trips and stale-body protection, publication rollback
for unready video, durable receipt redaction/replay, gateway argument/role/confirmation
checks, and MCP protocol visibility/call tests for public and managed roles.
These checks do not claim a production MCP upload or cloud deletion test.

The opt-in Java `media-e2e` test also binds its real uploaded/transcoded video to
`yuqi-intro` through authenticated HTTP and exports the database presentation row.
The frontend's development-only `/admin/media-placement-preview` reads that row
from `MEDIA_E2E_OUTPUT`. Serve its exported `media/` directory locally to exercise
the actual introduction modal, HLS Auto/manual quality, pause/seek preservation
and close cleanup. The route is always 404 in production and on Vercel. Do not
commit exported fixtures or local filesystem symlinks.

`node scripts/verify-admin-media.mjs` performs read-only deployed checks using
server-side `MCP_GATEWAY_URL`, `MCP_GATEWAY_INTERNAL_TOKEN`, `ADMIN_SERVICE_URL`
and `PUBLIC_MCP_URL`. Optionally supply `MEDIA_VERIFY_PROJECT_ID` to inspect an
existing project's media references. It checks anonymous rejection at all three
layers, all 16 catalog contracts, lesser-role denial, actual ADMIN reads (including
the current homepage placement without changing it), and the
public MCP catalog. Supply secrets in the process environment, never command-line
arguments or Git. The script does not print asset data or credentials and does
not upload, mutate, delete or publish anything.
