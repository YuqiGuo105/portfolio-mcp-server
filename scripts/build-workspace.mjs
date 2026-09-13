import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const result = await build({ entryPoints: ['web/workspace.js'], bundle: true, format: 'esm', minify: true,
  write: false, outdir: 'dist', loader: { '.png': 'dataurl' }, target: ['es2022'] });
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text.replaceAll('</script', '<\\/script');
const css = result.outputFiles.find(f => f.path.endsWith('.css')).text;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portfolio Admin Workspace</title><style>${css}</style></head><body><div id="workspace"></div><dialog id="detail" aria-label="Record details"></dialog><script type="module">${js}</script></body></html>`;
await mkdir('dist', { recursive: true });
await writeFile('dist/workspace.html', html);
console.log(`Workspace bundle: ${Math.round(Buffer.byteLength(html) / 1024)} KiB, no external assets`);
