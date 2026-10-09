import domino from '@mixmark-io/domino';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
markdown.use(gfm);
markdown.remove(['script', 'style', 'iframe', 'form']);
const isMermaid = node => /^(DIV|PRE|CODE)$/.test(node.nodeName)
  && /(?:^|\s)(?:mermaid|language-mermaid)(?:\s|$)/i.test(node.getAttribute('class') || '');
markdown.addRule('stored-mermaid', {
  filter: isMermaid,
  replacement: (_content, node) => '\n\n```mermaid\n' + node.textContent.trim() + '\n```\n\n',
});

function documentFor(value) {
  const document = domino.createDocument(String(value ?? ''));
  for (const node of Array.from(document.querySelectorAll('script,style,iframe,form'))) node.parentNode.removeChild(node);
  for (const node of Array.from(document.querySelectorAll('br'))) node.parentNode.replaceChild(document.createTextNode('\n'), node);
  return document;
}

export function plainText(value, max = 2000) {
  if (value == null) return undefined;
  const document = documentFor(value);
  for (const node of Array.from(document.querySelectorAll('p,div,li,h1,h2,h3,h4,tr'))) node.appendChild(document.createTextNode('\n'));
  return document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function contentMarkdown(value) {
  const text = String(value ?? '');
  // Keep existing Markdown unchanged; only HTML documents need conversion.
  if (!/<\/?[a-z][\w:-]*(?:\s[^>]*|\s*)>/i.test(text)) return text;
  const document = documentFor(text);
  for (const node of Array.from(document.querySelectorAll('div.mermaid'))) {
    const pre = document.createElement('pre');
    pre.setAttribute('class', 'mermaid');
    pre.textContent = node.textContent;
    node.parentNode.replaceChild(pre, node);
  }
  return markdown.turndown(document.body);
}

export function storedMermaid(value) {
  const text = String(value ?? '');
  const diagrams = [...text.matchAll(/^[ \t]*```mermaid[^\S\n]*\r?\n([\s\S]*?)^[ \t]*```/gmi)].map(m => m[1].trim());
  for (const node of Array.from(documentFor(text).querySelectorAll('div,pre,code'))) {
    if (isMermaid(node)) diagrams.push(node.textContent.trim());
  }
  return [...new Set(diagrams.filter(Boolean))];
}
