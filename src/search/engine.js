import bm25 from 'wink-bm25-text-search';
import { createHash } from 'node:crypto';
import { distance } from 'fastest-levenshtein';

export const FEATURE_NAMES = ['lexical', 'fuzzy', 'titleCoverage', 'tagCoverage', 'summaryCoverage', 'titlePhrase', 'tagPhrase', 'coverage'];
const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
const stopWords = new Set('a an the is are was were of for and or to in on about how what where which does did he she his her it this that tell me please show explain projects articles search 的 了 吗 呢 他 她 它 我 你 是 在 有 哪些 什么 如何 请 介绍 一下 帮我'.split(' '));

export function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim();
}

export function tokens(text) {
  const result = [];
  // Segment records retain the full input; consume them without materializing an array.
  for (const item of segmenter.segment(normalize(text))) {
    if (item.isWordLike && !stopWords.has(item.segment)) result.push(item.segment);
    if (result.length >= 40000) break;
  }
  return result;
}

function grams(text) {
  const result = [];
  for (const token of tokens(text)) {
    const n = /\p{Script=Han}/u.test(token) ? 2 : 3;
    if (token.length < n) { result.push(token); continue; }
    for (let i = 0; i <= token.length - n; i++) result.push(token.slice(i, i + n));
  }
  return result;
}

function overlap(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const haystack = new Set(tokens(text));
  return queryTokens.filter(t => haystack.has(t)).length / queryTokens.length;
}

export function documentKey(doc) { return `${doc.type}:${doc.id}`; }

export function features(query, doc, lexical = 0, fuzzy = 0) {
  const q = normalize(query);
  const terms = tokens(query);
  const tags = doc.tags.join(' ');
  return [lexical, fuzzy, overlap(terms, doc.title), overlap(terms, tags), overlap(terms, doc.summary),
    Number(Boolean(q) && normalize(doc.title).includes(q)),
    Number(Boolean(q) && doc.tags.some(t => normalize(t).includes(q))),
    overlap(terms, `${doc.title} ${tags} ${doc.summary}`)];
}

export function validModel(model) {
  return model?.schemaVersion === 1 && Array.isArray(model.features) && model.features.join('|') === FEATURE_NAMES.join('|')
    && Array.isArray(model.weights) && model.weights.length === FEATURE_NAMES.length && model.weights.every(Number.isFinite)
    && typeof model.version === 'string' && model.version.length > 0 && model.version.length < 100;
}

export function createSearchEngine(documents, model) {
  if (documents.length > 200) throw new Error('Search catalog exceeds bounded capacity');
  const docs = [...new Map(documents.map(d => [documentKey(d), d])).values()];
  const engines = [tokens, grams].map(prepare => {
    if (docs.length < 3) return null;
    const engine = bm25();
    engine.defineConfig({ fldWeights: { title: 4, tags: 3, summary: 1, searchText: 0.5 }, ovFldNames: ['type', 'category'] });
    engine.definePrepTasks([prepare]);
    for (const doc of docs) engine.addDoc({ ...doc, tags: doc.tags.join(' ') }, documentKey(doc));
    if (docs.length) engine.consolidate();
    return engine;
  });
  const byId = new Map(docs.map(d => [documentKey(d), d]));
  const vocabulary = new Set(docs.flatMap(d => tokens(`${d.title} ${d.tags.join(' ')} ${d.summary}`)).slice(0, 10000));
  const version = createHash('sha256').update(JSON.stringify(docs)).digest('hex').slice(0, 16);

  function candidates(query, { types, category } = {}) {
    if (!docs.length || !tokens(query).length) return [];
    const filter = d => (!types?.length || types.includes(d.type)) && (!category || normalize(d.category) === normalize(category));
    const corrected = tokens(query).slice(0, 32).map(word => {
      // Resolve numeralonyms from indexed vocabulary; ambiguous abbreviations stay literal.
      const abbreviation = /^([a-z])(\d{1,2})([a-z])$/.exec(word);
      if (!vocabulary.has(word) && abbreviation) {
        const matches = [...vocabulary].filter(term => /^[a-z]+$/.test(term)
          && term.length === Number(abbreviation[2]) + 2
          && term.startsWith(abbreviation[1]) && term.endsWith(abbreviation[3]));
        if (matches.length === 1) return matches[0];
      }
      if (vocabulary.has(word) || !/^[a-z]{5,30}$/.test(word)) return word;
      const matches = [...vocabulary].filter(term => Math.abs(term.length - word.length) <= 1 && distance(term, word) === 1);
      return matches.length === 1 ? matches[0] : word;
    }).join(' ');
    const smallCorpusSearch = (text, prepare) => {
      const terms = prepare(text);
      return docs.filter(filter).map(doc => {
        const words = new Set(prepare(`${doc.title} ${doc.tags.join(' ')} ${doc.summary} ${doc.searchText ?? ''}`));
        return [doc.key, terms.filter(t => words.has(t)).length / Math.max(1, terms.length)];
      }).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]);
    };
    const lists = engines[0] ? [engines[0].search(corrected, 200, filter), engines[1].search(query, 200, filter)]
      : [smallCorpusSearch(corrected, tokens), smallCorpusSearch(query, grams)];
    const ranks = lists.map(list => new Map(list.map(([id], i) => [id, 1 / (i + 1)])));
    const ids = new Set(lists.flatMap(list => list.map(([id]) => id)));
    const queryGrams = grams(query);
    return [...ids].flatMap(id => {
      const doc = byId.get(id);
      const lex = ranks[0].get(id) ?? 0;
      const gramSet = new Set(grams(`${doc.title} ${doc.tags.join(' ')} ${doc.summary}`));
      const gramCoverage = queryGrams.filter(g => gramSet.has(g)).length / Math.max(1, queryGrams.length);
      // A fuzzy-only hit must cover most of the query, not a coincidental trigram.
      if (!lex && gramCoverage < 0.55) return [];
      const vector = features(corrected, doc, lex, ranks[1].get(id) ?? 0);
      const rrf = (lex ? 1 / (60 + 1 / lex) : 0) + (ranks[1].has(id) ? 1 / (60 + 1 / ranks[1].get(id)) : 0);
      return [{ doc, features: vector, baseline: rrf }];
    });
  }

  function search(query, options = {}) {
    const limit = Math.min(50, Math.max(1, Math.trunc(Number(options.limit) || 12)));
    const offset = Math.min(200, Math.max(0, Math.trunc(Number(options.offset) || 0)));
    const useModel = validModel(model) && options.ranker !== 'baseline';
    const ranked = candidates(query, options).map(hit => ({ ...hit,
      score: useModel ? hit.features.reduce((sum, value, i) => sum + value * model.weights[i], 0) : hit.baseline,
    })).sort((a, b) => b.score - a.score || a.doc.key.localeCompare(b.doc.key));
    return { results: ranked.slice(offset, offset + limit).map(hit => {
      const { searchText, textCoverage, ...preview } = hit.doc;
      return { ...preview, rank: hit.score };
    }),
      total: ranked.length, limit, offset, indexVersion: version,
      coverage: { documents: docs.length, fullText: docs.filter(d => d.textCoverage === 'full').length,
        metadataOnly: docs.filter(d => d.textCoverage === 'metadata_only').length, truncated: docs.filter(d => d.textCoverage === 'truncated').length },
      modelVersion: useModel ? model.version : 'rrf-baseline-v1', searchMode: useModel ? 'bm25_fuzzy_ltr' : 'bm25_fuzzy_rrf' };
  }
  return { search, candidates, version, size: docs.length };
}
