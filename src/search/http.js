import { searchContent } from './service.js';

export async function handleSearch(req, res, url, search = searchContent) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  try {
    const types = url.searchParams.get('types');
    const result = await search({ query: url.searchParams.get('q'), types: types ? types.split(',') : undefined,
      limit: Number(url.searchParams.get('limit') || 12), offset: Number(url.searchParams.get('offset') || 0) });
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (error) {
    const invalid = error instanceof RangeError;
    res.writeHead(invalid ? 400 : 503);
    res.end(JSON.stringify({ error: invalid ? error.message : 'Search temporarily unavailable', code: invalid ? 'INVALID_QUERY' : 'SEARCH_UNAVAILABLE' }));
  }
}
