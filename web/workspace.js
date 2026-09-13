import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { createElement, Users, Workflow, Database, RefreshCw, ArrowUpRight, ChevronRight, ChevronLeft, X, Search, LockKeyhole, RotateCcw, Check, AlertTriangle, Clock } from 'lucide';
import logo from '../plugins/yuqi-portfolio/assets/icon.png';
import './workspace.css';

const app = new App({ name: 'Portfolio Admin Workspace', version: '1.0.0' }, {});
const icons = { visitors: Users, operations: Workflow, knowledge: Database };
const titles = { visitors: 'Visitor activity', operations: 'Operations', knowledge: 'Knowledge base' };
const state = { view: 'visitors', data: null, busy: false, connected: false, error: '', query: '', country: '', city: '',
  hours: 24, scope: 'OWNED', page: 0, sequence: 0, review: null, pendingWrites: new Map() };
const root = document.getElementById('workspace');
const dialog = document.getElementById('detail');
let detailSequence = 0;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== undefined && child !== null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const icon = data => createElement(data, { width: 17, height: 17, 'aria-hidden': 'true' });
function button(label, symbol, action, attrs = {}) {
  return el('button', { type: 'button', title: label, 'aria-label': label, onclick: action, ...attrs }, icon(symbol), attrs.class === 'icon-button' ? null : label);
}
function human(value) { return String(value ?? 'Unavailable').replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()); }
function date(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Time unavailable';
  return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
function badge(value) { return el('span', { class: `badge ${/failed|dead|unknown|verify|unavailable/i.test(value) ? 'warning' : /success|active|completed|accepted/i.test(value) ? 'success' : ''}` }, human(value)); }
function location(item) { return [item.city, item.region, item.country].filter(Boolean).join(', ') || 'Location unavailable'; }
function safeLink(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : null; } catch { return null; }
}
function path(value) { try { return new URL(value).pathname; } catch { return value || '/'; } }
function errorMessage(result) { return result.structuredContent?.message || 'Request failed. Check your admin connection and try again.'; }
async function call(name, args) {
  if (!state.connected) throw new Error('Open this workspace from your authenticated MCP connection.');
  return app.callServerTool({ name, arguments: args }, { timeout: 55000 });
}
function accept(result) {
  if (result.isError) throw new Error(errorMessage(result));
  const data = result._meta?.workspace;
  if (!data) throw new Error('This client did not provide workspace data. Use the admin console.');
  state.data = data;
  state.view = data.view || state.view;
  state.page = data.page?.number ?? 0;
  state.query = data.filter?.query || '';
  state.country = data.filter?.country || '';
  state.city = data.filter?.city || '';
  state.scope = data.filter?.scope || state.scope;
  state.error = '';
}
async function load({ reset = false, page = state.page } = {}) {
  const seq = ++state.sequence;
  state.busy = true; state.error = ''; render();
  const request = { view: state.view, filter: { query: state.query, country: state.country, city: state.city, scope: state.scope },
    page: { number: page, size: 15 }, window: !reset && state.data?.window ? state.data.window : { hours: state.hours } };
  try { const result = await call('workspace.get_view_data', request); if (seq === state.sequence) accept(result); }
  catch (error) { if (seq === state.sequence) state.error = error.message; }
  finally { if (seq === state.sequence) { state.busy = false; render(); } }
}
function openConsole() {
  const url = safeLink(state.data?.consoleUrl) || 'https://www.yuqi.site/admin';
  if (state.connected) app.openLink({ url }).catch(() => { state.error = 'Open the admin console from the link in the tool response.'; render(); });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
function selectView(view) {
  if (state.view === view || state.busy) return;
  state.view = view; state.data = null; state.page = 0; state.query = ''; state.country = ''; state.city = '';
  load({ reset: true, page: 0 });
}
function input(label, value, key, placeholder = label) {
  return el('label', { class: 'field' }, el('span', {}, label), el('input', { value, placeholder, maxlength: 200,
    oninput: event => { state[key] = event.target.value; }, disabled: state.busy }));
}
function filters() {
  const fields = [input('Search', state.query, 'query', state.view === 'knowledge' ? 'Title or content' : 'Page, event, or session')];
  if (state.view === 'visitors') {
    fields.push(input('Country', state.country, 'country', 'US'), input('City', state.city, 'city', 'Any city'));
    const select = el('select', { 'aria-label': 'Time window', onchange: e => { state.hours = Number(e.target.value); }, disabled: state.busy },
      ...[24, 168, 720].map(h => el('option', { value: h, selected: h === state.hours }, h === 24 ? 'Last 24 hours' : h === 168 ? 'Last 7 days' : 'Last 30 days')));
    fields.push(el('label', { class: 'field' }, el('span', {}, 'Time window'), select));
  } else if (state.view === 'knowledge') {
    fields.push(el('label', { class: 'field' }, el('span', {}, 'Sources'), el('select', { 'aria-label': 'Sources', onchange: e => { state.scope = e.target.value; } },
      ...['OWNED', 'INDEXED', 'ALL'].map(s => el('option', { value: s, selected: s === state.scope }, human(s))))));
  }
  const search = () => load({ reset: true, page: 0 });
  fields.push(el('button', { type: 'button', onclick: search, disabled: state.busy || !state.connected, class: 'primary' }, icon(Search), 'Search'));
  return el('div', { class: 'filters', role: 'search', onkeydown: e => {
    if (e.key === 'Enter' && !state.busy) { e.preventDefault(); search(); }
  } }, fields);
}
function metrics() {
  const d = state.data;
  const entries = state.view === 'visitors' ? [['Events', d?.summary?.totalEvents], ['Visitors', d?.summary?.uniqueVisitors], ['Cities', d?.summary?.cities]]
    : state.view === 'operations' ? [['Recent operations', d?.items?.length], ['Failed tasks', d?.failures?.length], ['Needs verification', d?.items?.filter(i => i.ambiguousOutcome).length]]
      : [['Matching records', d?.page?.totalElements], ['On this page', d?.items?.length], ['Sources', human(state.scope)]];
  return el('section', { class: 'metrics', 'aria-label': 'Summary' }, entries.map(([label, value]) => el('div', {}, el('span', {}, label), el('strong', {}, value ?? '—'))));
}
function rows() {
  const items = state.data?.items || [];
  if (!items.length) return el('div', { class: 'empty' }, icon(icons[state.view]), el('strong', {}, state.busy ? 'Loading records...' : 'No matching records'), el('span', {}, state.busy ? 'Waiting for the service' : 'Nothing found in this view.'));
  return el('div', { class: 'record-list', 'aria-label': titles[state.view] }, items.map(item => {
    let heading, sub, end, id;
    if (state.view === 'visitors') {
      heading = human(item.eventName); sub = `${path(item.pageUrl)} · ${location(item)}`; end = date(item.eventTime); id = item.sessionId;
    } else if (state.view === 'knowledge') {
      heading = item.title || 'Untitled record'; sub = item.preview || human(item.sourceType); end = badge(item.status); id = item.id;
    } else { heading = item.tool || 'Operation'; sub = `${date(item.updatedAt)} · Attempt ${item.attempt ?? 1}`; end = badge(item.state); id = item.operationId; }
    return el('button', { class: 'record', type: 'button', onclick: () => showDetail(item, id), disabled: state.busy || !id },
      el('span', { class: 'record-icon' }, icon(icons[state.view])), el('span', { class: 'record-copy' }, el('strong', {}, heading), el('span', {}, sub)),
      el('span', { class: 'record-end' }, end), icon(ChevronRight));
  }));
}
function failures() {
  if (state.view !== 'operations') return null;
  return el('section', { class: 'failed-tasks' }, el('h2', {}, 'Failed workflow tasks'),
    (state.data?.failures || []).map(item => {
      const pending = state.pendingWrites.has(`${item.kind}:${item.id}`);
      return el('div', { class: 'failed-record' }, el('div', { class: 'record-copy' }, el('strong', {}, item.operation || human(item.kind)),
        el('span', {}, `${item.sourceType || item.topic || 'Workflow'} · ${date(item.updatedAt)} · ${item.retryCount ?? 0} retries`)),
        badge(item.status), button(pending ? 'Verify outcome' : 'Review retry', pending ? Clock : RotateCcw,
          () => pending ? showPending(item) : prepareRetry(item), { disabled: state.busy }));
    }), !state.data?.failures?.length ? el('p', { class: 'muted' }, state.data?.unavailable?.includes('failures') ? 'Failed tasks unavailable' : 'No failed tasks in the latest records.') : null);
}
function render() {
  const busy = state.busy;
  root.replaceChildren(
    el('header', {}, el('div', { class: 'brand' }, el('img', { src: logo, alt: '', width: 32, height: 32 }),
      el('div', {}, el('span', { class: 'eyebrow' }, 'YUQI.SITE'), el('h1', {}, 'Admin Workspace'))),
      el('div', { class: 'header-actions' }, el('span', { class: 'access' }, icon(LockKeyhole), 'Admin only'),
        button('Open admin console', ArrowUpRight, openConsole, { class: 'icon-button' }))),
    el('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Workspace views' }, Object.keys(titles).map(view => button(titles[view], icons[view], () => selectView(view),
      { role: 'tab', 'aria-selected': state.view === view, disabled: busy, class: state.view === view ? 'active' : '' }))),
    el('main', { 'aria-busy': busy },
      el('div', { class: 'section-heading' }, el('div', {}, el('h2', {}, titles[state.view]), el('span', { class: 'muted updated', role: 'status' }, busy ? 'Loading...' : state.data ? `Updated ${date(state.data.updatedAt)}` : state.connected ? 'Waiting for data' : 'Connecting to MCP host...')),
        button('Refresh', RefreshCw, () => load({ reset: true, page: 0 }), { disabled: busy || !state.connected, class: 'icon-button' })),
      state.error ? el('div', { class: 'error', role: 'alert' }, icon(AlertTriangle), state.error) : null,
      state.data?.status === 'partial' ? el('div', { class: 'error', role: 'alert' }, 'Some services are unavailable. Visible records may be incomplete.') : null,
      metrics(), state.view !== 'operations' ? filters() : null, failures(),
      state.view === 'operations' ? el('h2', { class: 'list-heading' }, 'Recent MCP operations') : null, rows(),
      state.view !== 'operations' ? el('div', { class: 'pagination' }, el('span', {}, `Page ${state.page + 1}`),
        button('Previous page', ChevronLeft, () => load({ page: state.page - 1 }), { disabled: busy || state.page === 0, class: 'icon-button' }),
        button('Next page', ChevronRight, () => load({ page: state.page + 1 }), { disabled: busy || !state.data?.hasMore, class: 'icon-button' })) : null),
    el('footer', {}, icon(LockKeyhole), state.data?.notice || 'Administrator authentication required.'));
}
function openDialog(title, ...content) {
  dialog.replaceChildren(el('div', { class: 'dialog-heading' }, el('h2', {}, title), button('Close details', X, () => dialog.close(), { class: 'icon-button' })),
    el('div', { class: 'dialog-body' }, content));
  if (!dialog.open) dialog.showModal();
}
function facts(entries) {
  return el('dl', {}, entries.filter(([, v]) => v !== undefined && v !== null && v !== '').flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))]));
}
function timeline(items) {
  return el('ol', { class: 'timeline' }, items.map(item => el('li', {}, el('strong', {}, human(item.eventName || item.state || item.eventType || item.type)),
    el('time', {}, date(item.eventTime || item.createdAt || item.occurredAt || item.occurred_at)),
    item.pageUrl ? el('p', {}, path(item.pageUrl)) : null,
    item.city || item.country ? el('p', {}, location(item)) : null,
    item.automationEvidence ? badge(item.automationEvidence.verdict) : null)));
}
async function showDetail(item, id) {
  const sequence = ++detailSequence;
  const view = state.view;
  openDialog(view === 'knowledge' ? item.title || 'Knowledge record' : view === 'visitors' ? 'Session timeline' : 'Operation timeline', el('p', { role: 'status' }, 'Loading details...'));
  try {
    const result = await call('workspace.get_item', { view, id, ...(view === 'visitors' ? { window: state.data.window } : {}) });
    if (result.isError) throw new Error(errorMessage(result));
    if (!dialog.open || sequence !== detailSequence) return;
    const d = result._meta?.workspace?.detail;
    if (!d) throw new Error('Detail data unavailable');
    if (view === 'knowledge') openDialog(item.title || 'Knowledge record',
      facts([['Status', d.status || item.status], ['Revision', d.revision], ['Indexing', d.indexing?.status], ['Source', d.sourceType || item.sourceType], ['Answer visibility', d.answerVisibility || item.answerVisibility]]),
      el('h3', {}, 'Source content'), el('div', { class: 'source-content' }, typeof d.content === 'string' ? d.content : 'Content unavailable'),
      d.metadata?.question ? facts([['Question', d.metadata.question]]) : null);
    else if (view === 'visitors') openDialog('Session timeline',
      el('p', { class: 'muted' }, `Showing up to 25 events, newest first. ${d.page?.totalElements ?? d.items?.length ?? 0} matching events.`),
      timeline(d.items || []), el('details', {}, el('summary', {}, 'Visitor identifiers'),
        facts([['Session ID', id], ['IP addresses', [...new Set((d.items || []).map(e => e.ipAddress).filter(Boolean))].join(', ')], ['Browser', item.browser], ['Device', item.deviceType]])));
    else openDialog('Operation timeline', facts([['Operation ID', id], ['Idempotency key', d.idempotencyKey || item.idempotencyKey], ['Tool', d.tool || item.tool], ['State', d.state || d.operation?.state || item.state], ['Next action', d.nextAction || d.operation?.nextAction || item.nextAction], ['Safe to retry', d.safeToRetry === undefined ? undefined : d.safeToRetry ? 'Yes, with the original key and payload' : 'No']]),
      timeline(d.transitions || d.events || d.timeline || d.items || []), el('p', { class: 'muted' }, 'Unknown or unverified outcomes must be inspected before retrying.'));
  } catch (error) { if (dialog.open && sequence === detailSequence) openDialog('Details unavailable', el('p', { role: 'alert' }, error.message)); }
}
function showPending(item) {
  const receipt = state.pendingWrites.get(`${item.kind}:${item.id}`);
  openDialog('Verify retry outcome', el('p', {}, 'This retry was already submitted. Check the operation timeline before taking another action.'),
    facts([['Idempotency key', receipt.idempotencyKey], ['Status', receipt.status]]), button('Open admin console', ArrowUpRight, openConsole));
}
async function prepareRetry(item) {
  const sequence = ++detailSequence;
  openDialog('Review retry', el('p', { role: 'status' }, 'Checking current task state...'));
  try {
    const result = await call('workspace.prepare_retry', { kind: item.kind, id: item.id });
    if (result.isError) throw new Error(errorMessage(result));
    if (!dialog.open || sequence !== detailSequence) return;
    const review = result._meta?.workspace?.review;
    if (!review) throw new Error('Review data unavailable');
    state.review = review;
    openDialog('Review retry', facts([['Task', review.target.operation || human(item.kind)], ['ID', item.id], ['Current status', review.target.status], ['Review expires', date(new Date(review.expiresAt).toISOString())]]),
      el('p', { class: 'review-effect' }, review.effect), el('div', { class: 'dialog-actions' },
        button('Cancel', X, () => dialog.close()), button('Confirm retry', Check, () => confirmRetry(review), { class: 'primary', id: 'confirm-retry' })));
  } catch (error) { if (dialog.open && sequence === detailSequence) openDialog('Retry unavailable', el('p', { role: 'alert' }, error.message)); }
}
async function confirmRetry(review) {
  const key = `${review.action.kind}:${review.action.id}`;
  if (state.pendingWrites.has(key)) return;
  state.pendingWrites.set(key, { idempotencyKey: review.idempotencyKey, status: 'pending' });
  openDialog('Submitting retry', el('p', { role: 'status' }, 'Waiting for a durable operation receipt...'));
  try {
    const result = await call('workspace.confirm_retry', { ticket: review.ticket, confirmed: true });
    state.pendingWrites.set(key, result.structuredContent || { status: 'verify_required', idempotencyKey: review.idempotencyKey });
    openDialog(result.isError ? 'Verification required' : 'Retry accepted', el('p', { role: result.isError ? 'alert' : 'status' }, result.structuredContent?.message || 'Check Operations for the final outcome.'),
      facts([['Idempotency key', review.idempotencyKey]]), button('View operations', Workflow, () => { dialog.close(); load({ reset: true }); }));
  } catch {
    state.pendingWrites.set(key, { idempotencyKey: review.idempotencyKey, status: 'verify_required' });
    openDialog('Verification required', el('p', { role: 'alert' }, 'The connection ended before the result was verified. Do not submit another retry.'), facts([['Idempotency key', review.idempotencyKey]]));
  }
  render();
}
app.ontoolresult = result => {
  ++state.sequence;
  try { accept(result); } catch (error) { state.error = error.message; }
  state.busy = false; render();
};
app.onhostcontextchanged = context => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.locale) document.documentElement.lang = context.locale;
};
app.onerror = () => { state.error = 'MCP connection interrupted. Reconnect or use the admin console.'; render(); };
dialog.addEventListener('close', () => { state.review = null; ++detailSequence; });
render();
app.connect(undefined, { timeout: 10000 }).then(() => {
  state.connected = true;
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.locale) document.documentElement.lang = context.locale;
  render();
}).catch(() => { state.error = 'Open this workspace through an authenticated MCP Apps client, or use the admin console.'; render(); });
