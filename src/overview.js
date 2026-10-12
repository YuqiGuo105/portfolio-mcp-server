// Editorial, source-linked card. Update reviewedAt with each factual review.
export const overview = {
  name: 'Yuqi Guo',
  headline: 'Software engineer focused on backend systems, AI tooling, and reliability.',
  reviewedAt: '2026-10-11',
  currentRole: { company: 'Goldman Sachs', title: 'Software Engineer', since: '2024-12', source: 'https://www.yuqi.site/cv' },
  projects: [
    { id: '7c3715bf-7722-4df5-9e83-5d7e9493ea2c', title: 'Portfolio Platform',
      outcome: 'Connects content publishing, search, AI assistance, and visitor analytics through an event-driven platform.',
      url: 'https://www.yuqi.site/work-single/7c3715bf-7722-4df5-9e83-5d7e9493ea2c' },
    { id: '0470298d-c74d-4d4b-be33-d948b033002a', title: 'Open Source Reliability Engineering',
      outcome: 'Upstream contributions to workflow recovery, bounded provider retries, and Kubernetes client examples.',
      url: 'https://www.yuqi.site/work-single/0470298d-c74d-4d4b-be33-d948b033002a' },
    { id: 'da8e70ff-57f5-4a76-9250-b93677dae43c', title: 'Application Copilot',
      outcome: 'Combines a Chrome extension and authenticated MCP workflows with explicit review gates for application assistance.',
      url: 'https://www.yuqi.site/work-single/da8e70ff-57f5-4a76-9250-b93677dae43c' },
  ],
  contributions: [
    { project: 'Spring AI Alibaba', url: 'https://github.com/alibaba/spring-ai-alibaba/pull/4491' },
    { project: 'Google LangExtract', url: 'https://github.com/google/langextract/pull/385' },
    { project: 'Kubernetes Java Client', url: 'https://github.com/kubernetes-client/java/pull/4868' },
  ],
  links: { profile: 'https://www.yuqi.site/cv', github: 'https://github.com/YuqiGuo105', mcp: 'https://www.yuqi.site/mcp-guide' },
  freshness: 'Maintained overview, not a live employment or deployment check. Use get_profile or source pages for current details.',
};
