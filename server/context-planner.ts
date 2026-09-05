import { createHash, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { ContextOmission, ContextItem, FileChunk, StoredAttachment, WorkspaceData } from './domain';

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 32_000;
export const FILE_CHUNK_CHARACTERS = 4_000;
const EMBEDDING_DIMENSIONS = 64;

export interface PlannerDiagnostics {
  candidateCount: number;
  selectedCount: number;
  elapsedMs: number;
  fallback: boolean;
  budget: number;
  usedTokens: number;
}

export interface PlannerResult {
  omissions?: ContextOmission[];
  items: ContextItem[];
  diagnostics: PlannerDiagnostics;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Deterministic tokenizer suitable for repeatable local FTS tests (Latin words + CJK bi-grams). */
export function tokenize(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  const cjk = cjkRuns.flatMap(run => run.length < 2 ? [run] : [...Array(run.length - 1)].map((_, index) => run.slice(index, index + 2)));
  return [...new Set([...latin, ...cjk])];
}

/** Feature hashing provides an offline, stable embedding without a model/network dependency. */
export function embedTerms(terms: string[]): number[] {
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const term of terms) {
    const digest = createHash('sha256').update(term).digest();
    const index = digest.readUInt16BE(0) % EMBEDDING_DIMENSIONS;
    vector[index] += digest[2] % 2 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / norm);
}

export function chunkText(attachmentId: string, text: string, chunkCharacters = FILE_CHUNK_CHARACTERS): FileChunk[] {
  const chunks: FileChunk[] = [];
  let start = 0;
  let ordinal = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + chunkCharacters);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('。', end), text.lastIndexOf('. ', end));
      if (boundary > start + chunkCharacters / 2) end = boundary + 1;
    }
    const value = text.slice(start, end).trim();
    if (value) {
      const terms = tokenize(value);
      chunks.push({ id: randomUUID(), attachmentId, ordinal, text: value, startOffset: start, endOffset: end, tokens: estimateTokens(value), terms, embedding: embedTerms(terms) });
      ordinal += 1;
    }
    start = Math.max(end, start + 1);
  }
  return chunks;
}

export function summarizeChunks(name: string, chunks: FileChunk[]): string {
  if (!chunks.length) return `${name}（未提取到可检索文本）`;
  const first = chunks[0].text.replace(/\s+/g, ' ').slice(0, 280);
  const last = chunks.length > 1 ? chunks[chunks.length - 1].text.replace(/\s+/g, ' ').slice(0, 180) : '';
  return `${name} · ${chunks.length} chunks：${first}${last ? ` … ${last}` : ''}`;
}

/** Extracts text-showing operators from ordinary and Flate-compressed PDF content streams. */
export function extractPdfText(bytes: Buffer): string {
  const source = bytes.toString('latin1');
  const streams: string[] = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of source.matchAll(streamPattern)) {
    const dictionary = match[1];
    const raw = Buffer.from(match[2], 'latin1');
    try { streams.push(dictionary.includes('/FlateDecode') ? inflateSync(raw).toString('latin1') : match[2]); } catch { /* Ignore a corrupt/unsupported stream and keep ingesting other pages. */ }
  }
  if (!streams.length) streams.push(source);
  const decodeLiteral = (value: string) => value
    .replace(/\\([nrtbf()\\])/g, (_match, escaped: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[escaped] || escaped)
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
  return streams.flatMap(stream => [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g)].map(match => decodeLiteral(match[1])))
    .join('\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function cosine(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0);
}

function graphDistances(workspace: WorkspaceData): Map<string, number> {
  const distances = new Map([[workspace.activeNodeId, 0]]);
  const queue = [workspace.activeNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    const neighbors = workspace.discussionEdges.flatMap(edge => edge.source === id ? [edge.target] : edge.target === id ? [edge.source] : []);
    for (const neighbor of neighbors) if (!distances.has(neighbor)) {
      distances.set(neighbor, distances.get(id)! + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

export interface PlannerCandidate { attachmentId?: string; item: ContextItem; text: string; terms: string[]; embedding: number[]; graphDistance: number }

function candidates(workspace: WorkspaceData): PlannerCandidate[] {
  const distances = graphDistances(workspace);
  const attachmentById = new Map(workspace.attachments.map(item => [item.id, item]));
  const result: PlannerCandidate[] = [];
  for (const node of workspace.discussionNodes) {
    const text = `${node.title}\n${node.summary}\n${workspace.messages.filter(message => message.nodeId === node.id).map(message => message.text).join('\n')}`;
    const terms = tokenize(text);
    result.push({ text, terms, embedding: embedTerms(terms), graphDistance: distances.get(node.id) ?? 8, item: { id: `planner:node:${node.id}`, title: node.title, detail: `讨论节点 · ${node.summary}`, role: 'Reference', status: 'active', tokens: estimateTokens(text), selectionMode: 'AUTO_RETRIEVED', sourceType: 'node', sourceId: node.id, sourceNodeId: node.id, contentVersion: 1, content: text } });
  }
  for (const segment of workspace.segments) {
    const text = workspace.messages.filter(message => message.segmentId === segment.id).map(message => message.text).join('\n') || segment.title;
    const terms = tokenize(text);
    result.push({ text, terms, embedding: embedTerms(terms), graphDistance: distances.get(segment.nodeId) ?? 8, item: { id: `planner:segment:${segment.id}`, title: segment.title, detail: `讨论片段`, role: 'Reference', status: 'active', tokens: estimateTokens(text), selectionMode: 'AUTO_RETRIEVED', sourceType: 'segment', sourceId: segment.id, sourceNodeId: segment.nodeId, contentVersion: 1, content: text } });
  }
  for (const chunk of workspace.fileChunks) {
    const file = attachmentById.get(chunk.attachmentId);
    if (!file) continue;
    result.push({ attachmentId: chunk.attachmentId, text: chunk.text, terms: chunk.terms, embedding: chunk.embedding, graphDistance: 2, item: { id: `planner:chunk:${chunk.id}`, title: `${file.name} · chunk ${chunk.ordinal + 1}`, detail: `文件片段 · 字符 ${chunk.startOffset.toLocaleString()}–${chunk.endOffset.toLocaleString()}`, role: 'Reference', status: 'active', tokens: chunk.tokens, selectionMode: 'AUTO_RETRIEVED', sourceType: 'chunk', sourceId: chunk.id, contentVersion: 1, content: chunk.text } });
  }
  return result;
}

function sourceKey(item: ContextItem): string { return `${item.sourceType || 'reference'}:${item.sourceId || item.id}`; }

function explicitItemContent(workspace: WorkspaceData, item: ContextItem): ContextItem {
  if (item.content) return item;
  if (item.sourceType === 'node') {
    const node = workspace.discussionNodes.find(value => value.id === item.sourceId);
    const content = node ? `${node.summary}\n${workspace.messages.filter(message => message.nodeId === node.id).map(message => message.text).join('\n')}` : item.detail;
    return { ...item, content };
  }
  if (item.sourceType === 'segment') return { ...item, content: workspace.messages.filter(message => message.segmentId === item.sourceId).map(message => message.text).join('\n') || item.detail };
  if (item.sourceType === 'file') return { ...item, content: workspace.attachments.find(file => file.id === item.sourceId)?.summary || item.detail };
  return { ...item, content: item.detail };
}

export function planContext(workspace: WorkspaceData, query: string, attachmentIds: string[] = [], budget = DEFAULT_CONTEXT_TOKEN_BUDGET): PlannerResult {
  return planCandidates({
    mode: workspace.mode, query, attachmentIds, budget,
    selection: workspace.contextItems.map(item => item.status === 'active' ? explicitItemContent(workspace, item) : item),
  }, candidates(workspace));
}

/** Shared deterministic selection. Production indexing supplies this bounded input directly. */
export function planCandidates(input: { mode: WorkspaceData['mode']; query: string; attachmentIds: string[]; budget: number; selection: ContextItem[] }, allCandidates: readonly PlannerCandidate[]): PlannerResult {
  const startedAt = performance.now();
  const { query, attachmentIds, budget } = input;
  const explicit = input.selection.filter(item => item.status === 'active');
  const used = new Set(explicit.map(sourceKey));
  const excluded = new Set(input.selection.filter(item => item.status === 'excluded').flatMap(item => [sourceKey(item), item.sourceId || item.id]));
  const omissions: ContextOmission[] = [];
  const omit = (item: ContextItem, code: ContextOmission['code'], reason: string) => { omissions.push({ sourceType: item.sourceType || 'reference', sourceId: item.sourceId || item.id, title: item.title, tokenCount: item.tokens, code, reason }); };
  for (const item of input.selection.filter(item => item.status === 'excluded')) omit(item, 'excluded', item.reason || '用户明确排除。');
  let usedTokens = explicit.reduce((sum, item) => sum + item.tokens, 0);
  if (input.mode === 'Strict') {
    for (const candidate of allCandidates) if (!used.has(sourceKey(candidate.item)) && !excluded.has(sourceKey(candidate.item))) omit(candidate.item, 'strict', 'Strict 模式只使用显式选择的来源。');
    return { items: explicit, omissions, diagnostics: { candidateCount: allCandidates.length, selectedCount: explicit.length, elapsedMs: performance.now() - startedAt, fallback: false, budget, usedTokens } };
  }

  const queryTerms = tokenize(query);
  const querySet = new Set(queryTerms);
  const queryEmbedding = embedTerms(queryTerms);
  const ranked = allCandidates
    .filter(candidate => !used.has(sourceKey(candidate.item)) && !excluded.has(sourceKey(candidate.item)) && !excluded.has(candidate.item.sourceId || candidate.item.id))
    .map(candidate => {
      const lexical = candidate.terms.filter(term => querySet.has(term)).length / Math.max(1, querySet.size);
      const semantic = Math.max(0, cosine(queryEmbedding, candidate.embedding));
      const proximity = 1 / (1 + candidate.graphDistance);
      const attached = candidate.item.sourceType === 'chunk' && attachmentIds.includes(candidate.attachmentId || '');
      const score = (attached ? 2 : 0) + lexical * 0.55 + semantic * 0.35 + proximity * 0.1;
      const signals = [attached ? '本轮显式附加文件' : '', lexical > 0 ? `词法命中 ${(lexical * 100).toFixed(0)}%` : '', semantic > 0 ? `语义相似度 ${(semantic * 100).toFixed(0)}%` : '', candidate.graphDistance <= 1 ? '邻近当前节点' : ''].filter(Boolean);
      return { ...candidate, score, item: { ...candidate.item, score, selectionMode: attached ? 'USER_SELECTED' as const : 'AUTO_RETRIEVED' as const, reason: signals.join(' · ') || 'Planner 回退相关候选。' } };
    })
    .filter(candidate => { if (candidate.score > 0.05) return true; omit(candidate.item, 'low_score', '与本轮问题的相关性不足。'); return false; })
    .sort((left, right) => right.score - left.score || sourceKey(left.item).localeCompare(sourceKey(right.item)));

  const selected = [...explicit];
  const attachedChunkCounts = new Map<string, number>();
  for (const candidate of ranked) {
    const isAttached = candidate.item.selectionMode === 'USER_SELECTED';
    const attachmentId = candidate.attachmentId;
    if (isAttached && attachmentId && (attachedChunkCounts.get(attachmentId) || 0) >= 4) { omit(candidate.item, 'chunk_limit', '该附件已选入四个优先片段。'); continue; }
    if (usedTokens + candidate.item.tokens > budget) { omit(candidate.item, 'budget', '剩余预算不足；优先保留已选来源。'); continue; }
    selected.push(candidate.item);
    usedTokens += candidate.item.tokens;
    if (isAttached && attachmentId) attachedChunkCounts.set(attachmentId, (attachedChunkCounts.get(attachmentId) || 0) + 1);
  }
  return { items: selected, omissions, diagnostics: { candidateCount: allCandidates.length, selectedCount: selected.length, elapsedMs: performance.now() - startedAt, fallback: false, budget, usedTokens } };
}

export function attachmentContextItem(attachment: StoredAttachment): ContextItem {
  return { id: randomUUID(), title: attachment.name, detail: attachment.summary || `文件 · ${attachment.size.toLocaleString()} bytes`, role: 'Reference', status: 'active', tokens: estimateTokens(attachment.summary || attachment.name), selectionMode: 'USER_SELECTED', sourceType: 'file', sourceId: attachment.id, pinned: false, contentVersion: 1, content: attachment.summary, reason: '由用户显式加入的文件摘要；相关长内容由 Planner 按 chunk 投影。' };
}
