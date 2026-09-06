import ReactDOM from 'react-dom/client';
import { App } from '../App';
import { api } from '../api';
import { initialContext } from '../data';
import type { WorkspaceSnapshot } from '../types';
import { contextHistoryFixture } from './context-history-fixture';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/dm-mono/400.css';
import '../../app/static/css/tokens.css';
import '../../app/static/css/app.css';

// Isolated visual fixture: the production App consumes fixed API responses.
const workspace: WorkspaceSnapshot = { projectId: 'workspace-fixture', nodeId: 'node-fixture', activeNodeId: 'node-fixture', mode: 'Assisted', contextItems: initialContext, messages: [], attachments: [], discussionEdges: [], anchors: [], manifests: [], segments: [], updatedAt: '2026-09-06T02:00:00.000Z', discussionNodes: [{ id: 'node-fixture', title: '信息架构方向', summary: '探索首屏的内容层级、上下文入口与专业能力的渐进呈现方式。', kind: 'main', status: 'active', x: 0, y: 0, createdAt: '2026-09-06T02:00:00.000Z', updatedAt: '2026-09-06T02:00:00.000Z' }] };
workspace.manifests = [contextHistoryFixture.manifest];
workspace.messages = [
  { id: 'fixture-user', nodeId: workspace.activeNodeId, kind: 'user', text: '首屏应该如何兼顾专业用户和首次进入的用户？', createdAt: contextHistoryFixture.manifest.createdAt },
  { id: 'fixture-assistant', nodeId: workspace.activeNodeId, kind: 'assistant', text: '建议以当前讨论为中心，逐步展示上下文来源和讨论图谱。\n\n访谈证据支持这一方向；固定的可访问性约束也保留在本轮输入中。', manifestId: contextHistoryFixture.manifest.id, replyToMessageId: 'fixture-user', createdAt: contextHistoryFixture.manifest.createdAt },
];
const providerCatalog = { providers: [], models: [], activeModelId: null };
api.getWorkspace = async () => ({ workspace, provider: { configured: true, name: 'Test Provider', model: 'context-model', baseUrl: '' }, providerCatalog });
api.getProviders = async () => ({ catalog: providerCatalog, presets: {} });
api.listWorkspaces = async () => ({ workspaces: [] });
api.getMessageContext = async () => structuredClone(contextHistoryFixture);
if (new URLSearchParams(location.search).has('narrow')) document.documentElement.style.setProperty('--context-width', '270px');
ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
