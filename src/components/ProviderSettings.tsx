import { Check, Cloud, LoaderCircle, Pin, Plus, RefreshCw, Save, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ProviderCatalog, ProviderPreset, ProviderPresetInfo } from '../types';
import { presentErrorText } from '../error-presentation';

export interface ProviderFormState { id?: string; preset: ProviderPreset; name: string; baseUrl: string; apiKey: string; allowNoKey: boolean; modelId: string }
const blankForm: ProviderFormState = { preset: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', allowNoKey: false, modelId: 'gpt-4.1-mini' };

export function ProviderSettings({ catalog, presets, onClose, onSave, onDiscover, onToggleModel, onSelectModel }: {
  catalog: ProviderCatalog; presets: Record<string, ProviderPresetInfo>; onClose: () => void;
  onSave: (form: ProviderFormState) => Promise<void>; onDiscover: (providerId: string) => Promise<void>;
  onToggleModel: (modelId: string, changes: { favorite?: boolean; pinned?: boolean }) => Promise<void>; onSelectModel: (modelId: string) => Promise<void>;
}) {
  const [form, setForm] = useState<ProviderFormState>(blankForm);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const selectedProvider = catalog.providers.find(provider => provider.id === form.id);
  const models = useMemo(() => catalog.models.filter(model => !form.id || model.providerId === form.id), [catalog.models, form.id]);

  useEffect(() => {
    if (!catalog.providers.length || form.id) return;
    const provider = catalog.providers[0];
    setForm({ id: provider.id, preset: provider.preset, name: provider.name, baseUrl: provider.baseUrl, apiKey: '', allowNoKey: provider.allowNoKey, modelId: '' });
  }, [catalog.providers, form.id]);

  const selectProvider = (id: string) => {
    const provider = catalog.providers.find(item => item.id === id)!;
    setForm({ id, preset: provider.preset, name: provider.name, baseUrl: provider.baseUrl, apiKey: '', allowNoKey: provider.allowNoKey, modelId: '' });
    setNotice('');
  };
  const selectPreset = (preset: ProviderPreset) => {
    const value = presets[preset];
    setForm(current => ({ ...current, preset, ...(value ? { name: value.name, baseUrl: value.baseUrl, allowNoKey: value.allowNoKey } : {}) }));
  };
  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key); setNotice('');
    try { await action(); setNotice(success); } catch (error) { setNotice(presentErrorText(error, { message: '无法完成该操作。', recovery: '请检查配置后重试。' })); } finally { setBusy(''); }
  };

  return <div className="settings-backdrop" role="presentation"><section className="provider-settings" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
    <header className="settings-header"><div><span className="eyebrow">MODEL REGISTRY</span><h2 id="provider-settings-title">模型与 API</h2><p>密钥在本机后端加密保存，浏览器不会再次读取。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={18}/></button></header>
    <div className="settings-body">
      <aside className="provider-list"><div className="provider-list-title"><span>供应商</span><button onClick={() => setForm(blankForm)} aria-label="新增供应商"><Plus size={14}/></button></div>
        {catalog.providers.map(provider => <button className={provider.id === form.id ? 'provider-row active' : 'provider-row'} key={provider.id} onClick={() => selectProvider(provider.id)}><span className={`provider-signal ${provider.configured ? 'online' : ''}`}/><span><strong>{provider.name}</strong><small>{provider.configured ? '已配置' : '需要密钥'}</small></span></button>)}
      </aside>
      <div className="settings-main">
        <section className="settings-section api-form"><div className="settings-section-title"><span><Cloud size={14}/>供应商连接</span><small>{form.id ? '编辑' : '新增'}</small></div>
          <div className="preset-row">{(['openai','openrouter','deepseek','siliconflow','ollama','custom'] as ProviderPreset[]).map(preset => <button key={preset} className={form.preset === preset ? 'active' : ''} onClick={() => selectPreset(preset)}>{presets[preset]?.name || '自定义'}</button>)}</div>
          <form className="field-grid" autoComplete="off" onSubmit={event => event.preventDefault()}><label><span>名称</span><input name="provider-name" autoComplete="organization" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label className="wide"><span>Base URL</span><input name="provider-url" autoComplete="url" value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })}/></label><label className="wide"><span>API Key {selectedProvider?.hasApiKey && <small>已安全保存，留空则保持不变</small>}</span><input name="provider-key" type="password" autoComplete="new-password" value={form.apiKey} placeholder={selectedProvider?.hasApiKey ? '••••••••••••••••' : 'sk-…'} onChange={event => setForm({ ...form, apiKey: event.target.value })}/></label><label><span>手动添加模型</span><input name="model-id" autoComplete="off" value={form.modelId} placeholder="model-id" onChange={event => setForm({ ...form, modelId: event.target.value })}/></label><label className="checkbox-field"><input type="checkbox" checked={form.allowNoKey} onChange={event => setForm({ ...form, allowNoKey: event.target.checked })}/><span>允许无密钥连接（仅本地服务）</span></label></form>
          <div className="form-actions"><button className="primary-button" disabled={Boolean(busy)} onClick={() => run('save', () => onSave(form), '供应商配置已保存。')}>{busy === 'save' ? <LoaderCircle className="spin" size={14}/> : <Save size={14}/>}保存配置</button>{form.id && <button className="ghost-button" disabled={Boolean(busy)} onClick={() => run('discover', () => onDiscover(form.id!), '模型目录已同步。')}>{busy === 'discover' ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>}获取模型</button>}<span className="settings-notice" role="status">{notice}</span></div>
        </section>
        <section className="settings-section model-library"><div className="settings-section-title"><span>模型目录</span><small>{models.length} models</small></div>
          <div className="model-table">{models.length ? models.map(model => <article className={model.id === catalog.activeModelId ? 'model-row current' : 'model-row'} key={model.id}><button className="model-main" onClick={() => onSelectModel(model.id)}><span className="model-radio">{model.id === catalog.activeModelId && <Check size={11}/>}</span><span><strong>{model.displayName}</strong><small>{model.modelId}</small></span></button><button className={model.favorite ? 'model-mark active' : 'model-mark'} onClick={() => onToggleModel(model.id, { favorite: !model.favorite })} aria-label={`${model.favorite ? '取消收藏' : '收藏'} ${model.displayName}`}><Star size={14} fill={model.favorite ? 'currentColor' : 'none'}/></button><button className={model.pinned ? 'model-mark active' : 'model-mark'} onClick={() => onToggleModel(model.id, { pinned: !model.pinned })} aria-label={`${model.pinned ? '取消置顶' : '置顶'} ${model.displayName}`}><Pin size={14}/></button></article>) : <div className="library-empty">保存一个模型 ID，或从供应商同步模型目录。</div>}</div>
        </section>
      </div>
    </div>
  </section></div>;
}
