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
- Ground claims in returned MCP data and include canonical `yuqi.site` links when available.
- Distinguish shipped implementation from architectural proposals or design documentation.
- If no record supports a claim, say that the public portfolio does not establish it.

## Security boundary

This plugin is public and read-only. Do not represent it as an administrator
session, request private identifiers, or attempt content, subscriber, alert,
delivery, recovery, or access-control mutations through this server.
