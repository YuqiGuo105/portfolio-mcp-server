import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVisitorTraffic } from '../src/visitor-traffic-analysis.js';

const admin = { role: 'ADMIN' };
const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const meta = 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)';
const body = (items, total = items.length, number = 0) => ({ items, page: { number, size: 100, totalElements: total } });
const analyze = response => analyzeVisitorTraffic('visitor.search_events', response, admin);

test('crawler evidence overrides neither stored flags nor uncertainty about operator identity', () => {
  const input = body([{ eventId: 'event-a', sessionId: 'session-a', bot: false, userAgent: `${browser} (compatible; ${meta})` }]);
  const result = analyze(input);
  assert.equal(result.items[0].bot, false);
  assert.equal(result.items[0].automationEvidence.verdict, 'AUTOMATION_INDICATED');
  assert.equal(result.items[0].automationEvidence.storedFlagDisagrees, true);
  assert.equal(result.items[0].automationEvidence.operatorVerified, false);
  assert.equal(result.trafficAnalysis.counts.storedFlagConflicts, 1);
  assert.equal(result.trafficAnalysis.detector, 'isbot@5.2.2');
  assert.equal(result.trafficAnalysis.completeWindow, true);
  assert.equal(input.items[0].automationEvidence, undefined);
});

test('known bot names without the literal bot suffix remain detectable', () => {
  for (const userAgent of [meta, 'meta-externalfetcher/1.1', 'facebookexternalhit/1.1', 'Googlebot/2.1', 'GPTBot/1.0']) {
    assert.equal(analyze(body([{ userAgent }])).trafficAnalysis.verdict, 'AUTOMATION_INDICATED');
  }
});

test('normal browsers, missing user agents and empty results never assert a human', () => {
  for (const items of [[], [{ bot: false, userAgent: browser }], [{ bot: false }], [{ bot: true }]]) {
    const result = analyze(body(items));
    assert.equal(result.trafficAnalysis.verdict, 'UNDETERMINED');
    assert.equal(result.trafficAnalysis.humanVerification, 'NOT_PERFORMED');
  }
});

test('pagination and missing totals explicitly prevent claims about a complete population', () => {
  for (const input of [body([{ userAgent: meta }], 20), body([{ userAgent: meta }], 1, 1), { items: [] }]) {
    const result = analyze(input);
    assert.equal(result.trafficAnalysis.completeWindow, false);
    assert.equal(result.trafficAnalysis.scope, 'RETURNED_EVENTS_ONLY');
    assert.match(result.trafficAnalysis.nextAction, /NEXT_PAGE/);
  }
});

test('session observations use event time and do not equate scrolling with a human', () => {
  const items = [25, 50, 75, 100].map((progressPercent, index) => ({ sessionId: 'a',
    ipAddress: `192.0.2.${index + 1}`, userAgent: meta, eventName: 'read_progress',
    eventTime: `2026-09-10T12:00:00.${String(index * 100).padStart(3, '0')}Z`,
    serverTime: '2026-09-11T12:00:00Z', properties: { progressPercent } }));
  items.push({ sessionId: 'a', userAgent: meta, eventName: 'engaged_time',
    eventTime: '2026-09-10T12:00:14Z', properties: { engagedSeconds: 14 } });
  const result = analyze(body(items));
  const session = result.trafficAnalysis.sessions[0];
  assert.equal(session.readProgressSpanMs, 300);
  assert.equal(session.observedSpanMs, 14000);
  assert.equal(session.distinctIpCount, 4);
  assert.deepEqual(session.reportedEngagedSeconds, [14]);
  assert.equal(result.trafficAnalysis.verdict, 'AUTOMATION_INDICATED');
});

test('mixed browser and automated requests remain mixed; geo and IP are not classification inputs', () => {
  const items = [meta, browser].map(userAgent => ({ userAgent, city: 'Dallas', ipAddress: '192.0.2.1', bot: false }));
  const result = analyze(body(items));
  assert.equal(result.trafficAnalysis.verdict, 'MIXED_OR_INCOMPLETE_EVIDENCE');
  assert.equal(result.trafficAnalysis.counts.undetermined, 1);
  assert.equal(result.trafficAnalysis.sessions.length, 2);
});

test('diagnostics fail closed for non-admins and never decorate unrelated tools', () => {
  for (const role of [undefined, 'VIEWER', 'EDITOR', 'PUBLISHER']) {
    assert.throws(() => analyzeVisitorTraffic('visitor.search_events', body([]), { role }), /Administrator/);
  }
  const input = { data: [] };
  assert.equal(analyzeVisitorTraffic('analytics.get_visitor_summary', input, {}), input);
});

test('diagnostics bound input work and tolerate untrusted event names and timestamps', () => {
  assert.throws(() => analyze({ items: Array(101).fill({}) }), /limit/);
  assert.throws(() => analyze({}), /invalid/);
  const result = analyze(body([{ eventName: '__proto__', eventTime: 'bad date', userAgent: browser.repeat(100) }]));
  assert.equal(result.items[0].automationEvidence.userAgentTruncated, true);
  assert.equal(result.trafficAnalysis.sessions[0].eventTypes.__proto__, 1);
  assert.equal(result.trafficAnalysis.sessions[0].observedSpanMs, null);
});
