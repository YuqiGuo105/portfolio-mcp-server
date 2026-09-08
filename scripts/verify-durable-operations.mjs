import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

const endpoint=new URL(process.env.MCP_E2E_URL || 'https://www.yuqi.site/mcp/admin');
const alertsUrl=process.env.ALERTS_SERVICE_URL;
const cleanupToken=process.env.ALERTS_INTERNAL_TOKEN;
assert.ok(alertsUrl && cleanupToken,'Cleanup credentials must be supplied before any test writes');
const denied=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
assert.equal(denied.status,401);
console.log('PASS anonymous admin access denied');

const state=randomBytes(24).toString('hex');
let resolveCode,rejectCode;
const callbackCode=new Promise((resolve,reject)=>{resolveCode=resolve;rejectCode=reject;});
const callback=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname!='/callback'||url.searchParams.get('state')!==state) {res.writeHead(400).end('Invalid state');return;}
  if(!url.searchParams.get('code')) {res.writeHead(400).end('Authorization failed');rejectCode(new Error('Authorization failed'));return;}
  res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end('Authorized. Return to Codex.');
  resolveCode(url.searchParams.get('code'));
});
await new Promise(resolve=>callback.listen(0,'127.0.0.1',resolve));
const redirectUrl=`http://127.0.0.1:${callback.address().port}/callback`;
let clientInfo,tokens,verifier,client,ruleId;
const runName=`mcp-reliability-e2e-${randomUUID()}`;
const provider={redirectUrl,
  clientMetadata:{client_name:'Yuqi MCP reliability verification',redirect_uris:[redirectUrl],
    grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:'email profile'},
  state:()=>state,clientInformation:()=>clientInfo,saveClientInformation:v=>{clientInfo=v;},
  tokens:()=>tokens,saveTokens:v=>{tokens=v;},saveCodeVerifier:v=>{verifier=v;},codeVerifier:()=>verifier,
  redirectToAuthorization:url=>console.log(`AUTHORIZE ${url.href}`)};
const timer=setTimeout(()=>rejectCode(new Error('OAuth login timed out')),600_000);
function data(result) {
  const value=result.structuredContent || JSON.parse(result.content.find(x=>x.type==='text').text);
  assert.notEqual(result.isError,true,`Tool failed: ${JSON.stringify(value)}`);
  return value;
}
try {
  const login=await auth(provider,{serverUrl:endpoint,scope:'email profile'});
  if(login==='REDIRECT') await auth(provider,{serverUrl:endpoint,authorizationCode:await callbackCode,scope:'email profile'});
  clearTimeout(timer);callback.close();
  client=new Client({name:'yuqi-reliability-e2e',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(endpoint,{authProvider:provider}));
  const deadline=Date.now()+Number(process.env.MCP_E2E_READY_TIMEOUT_MS || 0);
  let catalog=(await client.listTools()).tools;
  if(!catalog.some(t=>t.name==='operation.get_status') && Date.now()<deadline)
    console.log('Waiting for the new MCP catalog deployment');
  while(!catalog.some(t=>t.name==='operation.get_status') && Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,5000));
    catalog=(await client.listTools()).tools;
  }
  for(const name of ['operation.get_status','operation.list','operation.get_timeline','admin.list_failed_operations'])
    assert.ok(catalog.some(t=>t.name===name),`Missing tool ${name}`);
  console.log('PASS OAuth and authenticated MCP discovery');
  data(await client.callTool({name:'admin.list_failed_operations',arguments:{limit:1}}));
  const key=randomUUID();
  const args={action:'CREATE',patch:{siteId:runName,name:runName,eventType:'page_view',geoLevel:'GLOBAL',geoAreaId:'',granularity:'5m',threshold:100,comparator:'>=',cooldownSeconds:60,enabled:false},
    reason:'Automated MCP reliability test; disabled and cleaned up',_idempotencyKey:key};
  const prepared=data(await client.callTool({name:'alerts.prepare_change',arguments:args}));
  assert.equal(prepared.operation.state,'SUCCEEDED');
  const duplicates=await Promise.all(Array.from({length:4},()=>client.callTool({name:'alerts.prepare_change',arguments:args})));
  for(const r of duplicates) {
    const replay=data(r);assert.equal(replay.changeId,prepared.changeId);assert.equal(replay.operation.operationId,prepared.operation.operationId);
  }
  const conflict=await client.callTool({name:'alerts.prepare_change',arguments:{...args,reason:'Different payload'}});
  assert.equal(conflict.isError,true);
  assert.match(JSON.stringify(conflict),/idempotency_conflict/);
  console.log('PASS duplicate replay and changed-payload rejection');
  const applyKey=randomUUID();
  const applyArgs={changeId:prepared.changeId,idempotencyKey:applyKey,_idempotencyKey:applyKey,_confirmed:true};
  const applied=data(await client.callTool({name:'alerts.apply_change',arguments:applyArgs}));
  ruleId=applied.ruleId;
  const again=data(await client.callTool({name:'alerts.apply_change',arguments:applyArgs}));
  assert.equal(again.ruleId,ruleId);assert.equal(again.version,applied.version);
  const rule=data(await client.callTool({name:'alerts.get_rule',arguments:{ruleId}}));
  assert.equal(rule.enabled,false);assert.equal(rule.name,runName);
  const status=data(await client.callTool({name:'operation.get_status',arguments:{id:applied.operation.operationId}}));
  assert.equal(status.state,'SUCCEEDED');assert.equal(status.attempt,1);
  const timeline=data(await client.callTool({name:'operation.get_timeline',arguments:{id:applied.operation.operationId}}));
  assert.deepEqual(timeline.transitions.map(x=>x.state),['RUNNING','SUCCEEDED']);
  console.log(JSON.stringify({result:'PASS',transport:'OAuth -> production MCP -> Gateway -> Alerts/Admin -> PostgreSQL',
    operationId:applied.operation.operationId,ruleId,duplicateResults:4,attempts:status.attempt}));
} finally {
  clearTimeout(timer);callback.close();await client?.close();
  // Query by unique test name too: a lost apply response must not leave a test rule behind.
  const response=await fetch(`${alertsUrl}/api/alert-rules?name=${encodeURIComponent(runName)}`,{headers:{'X-Internal-Token':cleanupToken}});
  assert.ok(response.ok,'Could not verify test rule cleanup');
  const rules=await response.json();
  for(const rule of rules.filter(r=>r.name===runName && r.siteId===runName && r.enabled===false)) {
    const removed=await fetch(`${alertsUrl}/api/alert-rules/${rule.ruleId}`,{method:'DELETE',headers:{'X-Internal-Token':cleanupToken}});
    assert.ok(removed.ok,'Failed to delete disabled test rule');
  }
  tokens=undefined;verifier=undefined;clientInfo=undefined;
  console.log('PASS test rule cleanup; no subscriber notifications requested');
}
