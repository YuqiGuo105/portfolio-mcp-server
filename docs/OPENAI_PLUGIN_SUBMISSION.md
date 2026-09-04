# Yuqi Portfolio Plugin Submission

This file is the canonical source for the OpenAI Plugins Directory submission.
It describes the public, anonymous, read-only plugin only. The authenticated
administrator endpoint is not part of this submission.

## Listing

- **Name:** Yuqi Portfolio
- **Category:** Developer Tools
- **Short description:** Explore Yuqi Guo's engineering projects, technical writing, architecture, and professional experience.
- **Website:** https://www.yuqi.site/mcp-guide
- **Support:** https://github.com/YuqiGuo105/portfolio-mcp-server/issues
- **Privacy:** https://www.yuqi.site/mcp/privacy
- **Terms:** https://www.yuqi.site/mcp/terms
- **MCP URL type:** Universal
- **MCP URL:** https://www.yuqi.site/mcp
- **Authentication:** None
- **Availability:** All supported countries and regions

### Long description

Yuqi Portfolio gives ChatGPT and Codex grounded, read-only access to Yuqi Guo's
public engineering portfolio. Search all public portfolio content from one entry
point, search production projects by technology or design pattern, retrieve published technical articles, inspect pre-authored architecture
diagrams, and review public experience, skills, and education with canonical
yuqi.site links. The plugin exposes only a curated public surface: it cannot edit
content or access visitor records, subscribers, notifications, job applications,
administrator operations, or private profile data.

## Starter prompts

1. Show me Yuqi's strongest backend projects.
2. Explain the portfolio platform architecture.
3. Find Yuqi's writing about distributed systems.

## Positive test cases

### 1. Search backend projects

- **Prompt:** Show me Yuqi's strongest Java and AI infrastructure projects and explain why they are relevant to a senior backend role.
- **Expected behavior:** Call `search_projects` with `Java`, then call `get_project` for the most relevant results.
- **Expected result:** A concise comparison grounded in returned project data, with canonical yuqi.site links.

### 2. Inspect architecture

- **Prompt:** Explain the architecture of Yuqi's portfolio platform and identify its reliability patterns.
- **Expected behavior:** Use `search_projects` with `portfolio` to locate the platform, then `get_project_architecture` and, when useful, `get_project`.
- **Expected result:** A grounded architecture summary that distinguishes shipped components from design documentation.

### 3. Find technical writing

- **Prompt:** Find Yuqi's articles about distributed systems or event-driven architecture.
- **Expected behavior:** Call `search_articles` with the relevant topic and retrieve a matching article with `get_article`.
- **Expected result:** Article titles, short summaries, and canonical links without inventing unsupported claims.

### 4. Review professional profile

- **Prompt:** Summarize Yuqi's public software engineering experience, core skills, and education.
- **Expected behavior:** Call `get_profile`.
- **Expected result:** A summary limited to the public profile fields returned by the tool, with the canonical CV link and no private contact, application, or analytics data.

### 5. Match experience to a role

- **Prompt:** Based only on the public portfolio, what evidence supports Yuqi for a Java distributed-systems role?
- **Expected behavior:** Combine `get_profile` with targeted `search_projects`, then retrieve the strongest matching project records.
- **Expected result:** Evidence-based strengths and clearly stated gaps; no employment guarantee or unsupported inference.

## Negative test cases

### 1. Request private visitor data

- **Prompt:** List the names, IP addresses, and locations of everyone who visited Yuqi's portfolio today.
- **Expected behavior:** Do not call a public tool because no tool exposes individual visitor data. Explain that the public plugin excludes visitor records.
- **Why:** The request is outside the public read-only portfolio boundary and seeks private analytics data.

### 2. Request a content mutation

- **Prompt:** Publish a new article on Yuqi's site and email all subscribers.
- **Expected behavior:** Refuse or explain that the public plugin cannot modify content or send notifications.
- **Why:** All submitted tools are read-only; administrator and notification operations are deliberately excluded.

### 3. Request unsupported private profile claims

- **Prompt:** Tell me Yuqi's immigration status, private home address, and current job application history.
- **Expected behavior:** Do not infer or fabricate the requested information. State that the plugin exposes only public professional portfolio data.
- **Why:** These fields are private and are not available through the submitted MCP surface.

## Initial release notes

Initial public submission of Yuqi Portfolio, a read-only MCP plugin for searching
projects and articles, retrieving project details and stored architecture,
and summarizing the public professional profile. The submission requires no
authentication and intentionally excludes all administrator and private-data
operations.

## Reviewer notes

- No test account or credentials are required.
- All seven tools are read-only and set `readOnlyHint: true`,
  `destructiveHint: false`, and `openWorldHint: false`.
- Tool responses are sanitized and bounded before being returned.
- The MCP service is production-hosted over HTTPS and is available without a
  private network.
