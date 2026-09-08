const PROFILE_CONFIG = [
  ['github', 'GitHub', 'PUBLIC_GITHUB_URL'],
  ['leetcode', 'LeetCode', 'PUBLIC_LEETCODE_URL'],
  ['instagram', 'Instagram', 'PUBLIC_INSTAGRAM_URL'],
];

export function publicSocialProfiles(env = process.env) {
  return PROFILE_CONFIG.flatMap(([id, label, envName]) => {
    const url = validatedPublicUrl(env[envName]);
    return url ? [{ id, label, url }] : [];
  });
}

export function validatedPublicUrl(value) {
  if (!value || typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
