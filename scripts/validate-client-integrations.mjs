import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PUBLIC_MCP_URL = "https://www.yuqi.site/mcp";
const root = resolve(import.meta.dirname, "..");

const files = {
  marketplace: ".agents/plugins/marketplace.json",
  manifest: "plugins/yuqi-portfolio/.codex-plugin/plugin.json",
  codex: "plugins/yuqi-portfolio/.mcp.json",
  claude: "docs/client-configs/claude.mcp.json",
  cursor: "docs/client-configs/cursor.mcp.json",
  gemini: "docs/client-configs/gemini.settings.json",
  vscode: "docs/client-configs/vscode.mcp.json"
};

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPublicUrl(actual, source) {
  assert(actual === PUBLIC_MCP_URL, `${source} must use ${PUBLIC_MCP_URL}`);
}

const manifest = await readJson(files.manifest);
assert(manifest.name === "yuqi-portfolio", "Codex plugin name is invalid");
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "Plugin version must use semver");
assert(manifest.mcpServers === "./.mcp.json", "Plugin must reference its MCP config");
assert(manifest.skills === "./skills/", "Plugin must reference its skills directory");

const marketplace = await readJson(files.marketplace);
assert(marketplace.name === "yuqi-portfolio-platform", "Marketplace name is invalid");
const marketplacePlugin = marketplace.plugins?.find((plugin) => plugin.name === "yuqi-portfolio");
assert(marketplacePlugin, "Marketplace must expose the Codex plugin");
assert(
  marketplacePlugin.source?.path === "./plugins/yuqi-portfolio",
  "Marketplace plugin path is invalid"
);
assert(
  marketplacePlugin.policy?.authentication === "ON_USE",
  "Public plugin should defer connection setup until use"
);

const codex = await readJson(files.codex);
assertPublicUrl(codex.mcpServers?.["yuqi-portfolio"]?.url, "Codex plugin");
assert(codex.mcpServers["yuqi-portfolio"].type === "http", "Codex transport must be HTTP");

const claude = await readJson(files.claude);
assertPublicUrl(claude.mcpServers?.["yuqi-portfolio"]?.url, "Claude config");
assert(claude.mcpServers["yuqi-portfolio"].type === "http", "Claude transport must be HTTP");

const cursor = await readJson(files.cursor);
assertPublicUrl(cursor.mcpServers?.["yuqi-portfolio"]?.url, "Cursor config");

const gemini = await readJson(files.gemini);
assertPublicUrl(gemini.mcpServers?.["yuqi-portfolio"]?.httpUrl, "Gemini config");
assert(gemini.mcpServers["yuqi-portfolio"].trust === false, "Gemini must preserve confirmations");

const vscode = await readJson(files.vscode);
assertPublicUrl(vscode.servers?.yuqiPortfolio?.url, "VS Code config");
assert(vscode.servers.yuqiPortfolio.type === "http", "VS Code transport must be HTTP");

for (const [name, relativePath] of Object.entries(files)) {
  const content = await readFile(resolve(root, relativePath), "utf8");
  assert(!content.includes("/mcp/admin"), `${name} public artifact must not expose the admin endpoint`);
  assert(!/authorization|bearer|token/i.test(content), `${name} public artifact must not contain credentials`);
}

console.log("Validated Codex plugin and five public MCP client configurations.");
