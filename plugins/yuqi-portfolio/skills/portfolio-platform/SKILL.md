---
name: portfolio-platform
description: Use Yuqi Guo's public portfolio MCP tools to answer grounded questions about projects, articles, architecture, skills, education, and experience.
---

# Portfolio Platform

Use the `yuqi-portfolio` MCP server when a request depends on Yuqi Guo's public
portfolio content.

## Response contract

- Reply in the same language as the user's latest message unless they request another language.
- Prefer search tools to discover records, then use the matching get tool for full details.
- Use `get_profile` and read `profileEvidence` for education; missing structured arrays do not establish missing qualifications.
- For personal questions, city abbreviations, or multilingual questions, use `search_knowledge` with the full question. Article searches also return semantic `evidence` when keyword search misses.
- `search_articles` covers both technical and life posts. Pass the result's `type` as `sourceType` to `get_article`, and follow `nextOffset` when the body is truncated.
- Do not convert zero keyword hits into a factual denial. Check the returned evidence and distinguish retrieval errors from an actual lack of supporting evidence.
- Approved public answer text can have a restricted underlying source. When `sourceRequiresLogin` is true, do not invent or expose a direct source link; state that the source requires admin sign-in if asked.
- Ground claims in returned MCP data and include canonical `yuqi.site` links when available.
- Distinguish shipped implementation from architectural proposals or design documentation.
- If no record supports a claim, say that the public portfolio does not establish it.

## Security boundary

This plugin is public and read-only. Do not represent it as an administrator
session, request private identifiers, or attempt content, subscriber, alert,
delivery, recovery, or access-control mutations through this server.
