import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const rpc = async (method, params) => {
  const result = await fetch('/host/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }) }).then(r => r.json());
  if (result.error) throw new Error(result.error.message);
  return result.result;
};
const resources = await rpc('resources/read', { uri: 'ui://yuqi-admin/workspace-v1.html' });
const frame = document.getElementById('app');
const bridge = new AppBridge(null, { name: 'Portfolio E2E reference host', version: '1.0.0' }, { serverTools: {}, openLinks: {} },
  { hostContext: { theme: 'light', locale: 'en-US', displayMode: 'inline' } });
bridge.oncalltool = params => rpc('tools/call', params);
bridge.onopenlink = async () => ({});
bridge.onsizechange = ({ height }) => { frame.style.height = Math.min(950, height) + 'px'; };
bridge.oninitialized = async () => {
  const args = { view: new URLSearchParams(location.search).get('view') || 'visitors' };
  await bridge.sendToolInput({ arguments: args });
  await bridge.sendToolResult(await rpc('tools/call', { name: 'workspace.open_view', arguments: args }));
};
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.srcdoc = resources.contents[0].text.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'">');
document.getElementById('theme').onclick = () => bridge.setHostContext({ theme: 'dark', locale: 'en-US', displayMode: 'inline' });
