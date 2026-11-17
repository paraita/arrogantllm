import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setCsrfToken } from './api.js';
import './styles.css';

const NAV_ITEMS = [
  ['overview', 'Overview', '◫'],
  ['models', 'Models', '◇'],
  ['marketplace', 'Marketplace', '⌕'],
  ['tokens', 'API Tokens', '⌑'],
  ['settings', 'Settings', '⚙'],
  ['api', 'API Guide', '↗'],
];

function Icon({ name, size = 18 }) {
  const paths = {
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.spark}</svg>;
}

function ErrorBanner({ children, onDismiss }) {
  if (!children) return null;
  return <div className="notice notice-error" role="alert"><span>{children}</span><button className="icon-button" aria-label="Dismiss message" onClick={onDismiss}><Icon name="close" size={16}/></button></div>;
}

function Modal({ title, children, onClose, wide = false, role = 'dialog' }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = () => [...dialog.querySelectorAll(focusableSelector)]
      .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
    const focusable = focusableElements();
    (focusable[0] || dialog).focus();
    const onKeyDown = (event) => {
      const modalBackdrops = document.querySelectorAll('.modal-backdrop');
      if (modalBackdrops[modalBackdrops.length - 1] !== dialog.closest('.modal-backdrop')) return;
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={`modal${wide ? ' modal-wide' : ''}`} role={role} aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="modal-heading"><div><span className="eyebrow">ADMIN CONSOLE</span><h2>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close"/></button></div>
      {children}
    </section>
  </div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onLogin({ username, password }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="login-shell">
    <div className="login-aside"><div className="brand-mark"><Icon name="spark" size={24}/></div><p className="eyebrow">A VERY SERIOUS SIMULATOR</p><h1>All the confidence.<br/><em>None of the inference.</em></h1><p className="login-copy">A pretend model service for real development work. Plug it in, test your app, enjoy the suspiciously thoughtful pauses.</p><div className="login-aside-bottom"><span className="live-dot"/> MOCK SYSTEM · LOCAL FIRST</div></div>
    <div className="login-main"><div className="login-card"><span className="eyebrow">PRIVATE WORKSPACE</span><h2>Sign in to your console</h2><p>Manage your fictional fleet of very capable models.</p>
      <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>
      <form onSubmit={submit} className="stack-form"><label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></label><button className="button button-primary button-wide" disabled={busy}>{busy ? 'Signing in…' : 'Enter console'}<Icon name="arrow"/></button></form>
      <div className="login-footnote"><span className="lock-mark">⌑</span> Admin access is separate from API consumer tokens.</div>
    </div><p className="login-caption">No actual models are harmed in this simulation.</p></div>
  </main>;
}

function MetricCard({ label, value, hint, tone = '' }) {
  return <article className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-dot"/></div><strong>{value}</strong><p>{hint}</p></article>;
}

function formatNumber(value) { return new Intl.NumberFormat('en-US').format(value || 0); }
function metadataValue(model, key) { return model?.metadata?.[key]?.value ?? model?.metadata?.[key] ?? null; }
function formatContext(value) { return value ? `${formatNumber(value)} tokens` : 'Unknown'; }
function formatParameters(value) {
  if (!value) return 'Unknown';
  if (value >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  return formatNumber(value);
}

function Overview({ models, tokens, summary, navigate }) {
  const endpoints = Object.entries(summary?.requestsByEndpoint || {}).sort((a, b) => b[1] - a[1]);
  const maxEndpoint = Math.max(...endpoints.map(([, count]) => count), 1);
  const activeCount = models.filter((model) => model.active).length;
  return <>
    <div className="page-intro"><div><span className="eyebrow">THE MOCK CONTROL ROOM</span><h1>Model overview</h1><p>Your fictional fleet is ready to confidently answer anything.</p></div><span className="status-pill"><span className="live-dot"/> Simulation mode</span></div>
    <div className="metric-grid"><MetricCard label="Requests served" value={formatNumber(summary?.totalRequests)} hint="Since this process started" tone="metric-lime"/><MetricCard label="Active models" value={`${activeCount} / ${models.length}`} hint="Available to API clients"/><MetricCard label="API tokens" value={tokens.length} hint="Credentials with access"/><MetricCard label="Average confidence" value="100%" hint="Evidence not included" tone="metric-lavender"/></div>
    <div className="overview-grid"><section className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">LIVE TRAFFIC</span><h2>Endpoint activity</h2></div><span className="subtle-label">Memory only</span></div>
      {endpoints.length ? <div className="activity-list">{endpoints.map(([route, count]) => <div className="activity-row" key={route}><div className="activity-label"><code>{route}</code><b>{formatNumber(count)}</b></div><div className="activity-track"><span style={{ width: `${Math.max(5, count / maxEndpoint * 100)}%` }}/></div></div>)}</div> : <div className="empty-state compact"><div className="empty-icon"><Icon name="spark"/></div><h3>No requests yet</h3><p>Once a client calls the API, its endpoint activity will appear here.</p></div>}
      <div className="activity-foot"><span>Last request</span><strong>{summary?.lastRequestAt ? new Date(summary.lastRequestAt).toLocaleString() : 'Nothing to report'}</strong></div></section>
      <section className="panel spotlight-panel"><div className="spotlight-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="orb-core"><Icon name="spark" size={28}/></div><span className="orbit-label">FAKE IT TILL YOU SHIP IT</span></div><div className="spotlight-copy"><span className="eyebrow">DEVELOPMENT MODE</span><h2>Real integrations.<br/>Entirely fictional brains.</h2><p>Test retries, streaming, tools, and auth without calling a real model.</p><button className="text-button" onClick={() => navigate('api')}>Explore the API guide <Icon name="arrow" size={16}/></button></div></section>
    </div>
    <section className="panel model-preview"><div className="panel-heading"><div><span className="eyebrow">YOUR CATALOG</span><h2>Model lineup</h2></div><button className="button button-quiet" onClick={() => navigate('models')}>Manage models <Icon name="arrow" size={15}/></button></div>
      {models.length ? <div className="preview-models">{models.slice(0, 3).map((model) => <div className="preview-model" key={model.id}><span className={`model-orb ${model.active ? 'orb-active' : ''}`}><Icon name="spark" size={17}/></span><div><strong>{model.name}</strong><small>{model.id}</small></div><span className={`state-chip ${model.active ? 'state-on' : 'state-off'}`}>{model.active ? 'Active' : 'Paused'}</span></div>)}</div> : <p className="muted-copy">No models configured yet.</p>}
    </section>
  </>;
}

function ModelDialog({ model, onClose, onSave, onDelete }) {
  const [id, setId] = useState(model?.id || '');
  const [name, setName] = useState(model?.name || '');
  const [contextLength, setContextLength] = useState(metadataValue(model, 'contextLength') || '');
  const [task, setTask] = useState(metadataValue(model, 'task') || 'text-generation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave({ id: id.trim(), name: name.trim(), contextLength: contextLength ? Number(contextLength) : null, task }); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title={model ? 'Edit model' : 'Add a fake model'} onClose={onClose}>
    <p className="modal-lede">Give your simulator a convincing name. No weights or inference required.</p><ErrorBanner>{error}</ErrorBanner>
    <form className="stack-form" onSubmit={submit}><label>Model ID<input aria-label="Model ID" value={id} onChange={(event) => setId(event.target.value)} disabled={Boolean(model)} placeholder="example-model:7b" required/></label><label>Display name<input aria-label="Display name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Example Model 7B" required/></label><div className="form-row"><label>Context length<input type="number" min="1" value={contextLength} onChange={(event) => setContextLength(event.target.value)} placeholder="Unknown"/></label><label>Task<select value={task} onChange={(event) => setTask(event.target.value)}><option value="text-generation">Text generation</option><option value="text-to-image">Text to image</option><option value="embeddings">Embeddings</option><option value="chat-completion">Chat completion</option><option value="other">Other</option></select></label></div>
      <div className="modal-actions">{model && <button type="button" className="button button-danger-quiet" onClick={onDelete}>Delete model</button>}<button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save model'}</button></div></form>
  </Modal>;
}

function ModelsPage({ models, onToggle, onEdit, onAdd }) {
  return <><div className="page-intro"><div><span className="eyebrow">THE CATALOG</span><h1>Models</h1><p>Choose which fictional models your clients can see.</p></div><button className="button button-primary" onClick={onAdd}><Icon name="plus"/> Add model</button></div>
    <section className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">MODEL REGISTRY</span><h2>{models.length} {models.length === 1 ? 'model' : 'models'}</h2></div><span className="subtle-label">Only active models appear in the API</span></div>
      {models.length ? <div className="model-table-wrap"><table className="model-table"><thead><tr><th>Model</th><th>Source</th><th>Context</th><th>Model details</th><th>Status</th><th>Expose</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{models.map((model) => { const details = [metadataValue(model, 'quantizer'), metadataValue(model, 'version'), metadataValue(model, 'flavor')].filter(Boolean); return <tr key={model.id}><td><div className="table-model"><span className={`model-orb ${model.active ? 'orb-active' : ''}`}><Icon name="spark" size={16}/></span><div><strong>{model.name}</strong><code>{model.id}</code></div></div></td><td><span className="source-chip">{model.source === 'huggingface' ? 'Hugging Face' : 'Manual'}</span></td><td>{formatContext(metadataValue(model, 'contextLength'))}</td><td>{details.length ? details.join(' · ') : '—'}</td><td><span className={`state-chip ${model.active ? 'state-on' : 'state-off'}`}><span/> {model.active ? 'Active' : 'Paused'}</span></td><td><label className="switch"><input type="checkbox" checked={model.active} onChange={(event) => onToggle(model, event.target.checked)} aria-label={`${model.active ? 'Deactivate' : 'Activate'} ${model.name}`}/><span className="switch-track"/></label></td><td><button className="button button-quiet button-small" aria-label={`Edit ${model.name}`} onClick={() => onEdit(model)}>Edit</button></td></tr>; })}</tbody></table></div> : <div className="empty-state"><div className="empty-icon"><Icon name="spark"/></div><h3>Your catalog is wonderfully empty</h3><p>Add a fake model by hand or pull its public metadata from Hugging Face.</p><button className="button button-primary" onClick={onAdd}>Add your first model</button></div>}
    </section></>;
}

function Provenance({ item }) {
  const provenance = item?.provenance || 'unknown';
  return <span className={`provenance provenance-${provenance}`}>{provenance}</span>;
}

function MarketplacePage({ onImport }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  async function search(event) {
    event.preventDefault(); if (!query.trim()) return;
    setBusy(true); setError(''); setSearched(true);
    try { setResults(await api.searchModels(query.trim())); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <><div className="page-intro"><div><span className="eyebrow">PUBLIC METADATA ONLY</span><h1>Marketplace</h1><p>Browse Hugging Face model cards. Pull metadata, never model weights.</p></div><span className="source-chip source-hub"><span className="hub-dot">H</span> Hugging Face Hub</span></div>
    <section className="market-search panel"><div className="search-copy"><span className="eyebrow">FIND YOUR NEXT PRETEND BRAIN</span><h2>Search the model universe</h2><p>We fetch public repository details and context hints. The actual model stays right where it is.</p></div><form onSubmit={search} className="search-form"><label className="sr-only" htmlFor="hub-search">Search models</label><div className="search-input-wrap"><span>⌕</span><input id="hub-search" aria-label="Search models" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “instruct 7b” or “tiny llama”"/><button className="button button-primary" disabled={busy || !query.trim()}>{busy ? 'Searching…' : 'Search Hub'}</button></div><small>Searches are limited to 20 results. Metadata may be incomplete.</small></form></section>
    <ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>
    <div className="results-heading"><div><span className="eyebrow">DISCOVERED REPOSITORIES</span><h2>{busy ? 'Searching…' : results.length ? `${results.length} results` : 'Metadata results'}</h2></div><span className="subtle-label">No downloads · No inference</span></div>
    {results.length ? <div className="market-grid">{results.map((model) => <article className="market-card" key={model.repoId}><div className="market-card-top"><span className="source-chip source-hub"><span className="hub-dot">H</span> Hugging Face</span><a href={model.sourceUrl} target="_blank" rel="noreferrer" className="icon-button" aria-label={`Open ${model.repoId} on Hugging Face`}><Icon name="external" size={15}/></a></div><h3>{model.repoId}</h3><p className="market-task">{model.task?.value || 'Task unknown'} <Provenance item={model.task}/></p><div className="market-facts"><div><span>Context</span><b>{formatContext(model.contextLength?.value)} <Provenance item={model.contextLength}/></b></div><div><span>Parameters</span><b>{formatParameters(model.parameterCount?.value)} <Provenance item={model.parameterCount}/></b></div><div><span>Quantizer</span><b>{model.quantizer?.value || 'Unknown'} <Provenance item={model.quantizer}/></b></div><div><span>Version</span><b>{model.version?.value || 'Unknown'} <Provenance item={model.version}/></b></div><div><span>Flavor</span><b>{model.flavor?.value || 'Unknown'} <Provenance item={model.flavor}/></b></div><div><span>Downloads / license</span><b>{formatNumber(model.downloads?.value)} · {model.license?.value || 'Unknown'}</b></div></div><button className="button button-outline button-wide" onClick={() => onImport(model)}>Import as inactive <Icon name="arrow" size={15}/></button></article>)}</div> : <section className="empty-state market-empty"><div className="empty-icon"><Icon name="spark"/></div><h3>{searched ? 'No repositories found' : 'Ready when you are'}</h3><p>{searched ? 'Try another term. Hub metadata varies from repository to repository.' : 'Search Hugging Face to see public model metadata without downloading anything.'}</p></section>}
    <div className="fine-print"><span>i</span><p>Context, quantization, version, and flavor are shown only when a repository publishes them or when a clearly labeled inference can be made. Imported models start inactive.</p></div>
  </>;
}

function TokensPage({ tokens, onCreate, onRevoke, newToken, dismissToken }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revokeTarget, setRevokeTarget] = useState(null);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onCreate(name.trim()); setName(''); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <><div className="page-intro"><div><span className="eyebrow">CONSUMER ACCESS</span><h1>API Tokens</h1><p>Give your development clients access to the fake model API.</p></div><span className="source-chip">Bearer authentication</span></div>
    <div className="token-layout"><section className="panel token-create"><span className="eyebrow">NEW CREDENTIAL</span><h2>Issue a token</h2><p>Name each token after the app or environment that will use it.</p><ErrorBanner>{error}</ErrorBanner><form onSubmit={submit}><label htmlFor="token-name">Token name</label><div className="inline-form"><input id="token-name" aria-label="Token name" placeholder="Local development app" value={name} onChange={(event) => setName(event.target.value)} required/><button className="button button-primary" disabled={busy || !name.trim()}><Icon name="plus"/> Create token</button></div></form><div className="token-warning"><span>!</span><p>The full secret is shown only once. Copy it before closing the confirmation.</p></div></section>
      <section className="panel token-list"><div className="panel-heading"><div><span className="eyebrow">ACTIVE CREDENTIALS</span><h2>{tokens.length} {tokens.length === 1 ? 'token' : 'tokens'}</h2></div></div>{tokens.length ? <div className="token-rows">{tokens.map((token) => <div className="token-row" key={token.id}><span className="token-icon">⌑</span><div className="token-row-info"><strong>{token.name}</strong><code>{token.prefix}••••••••</code></div><span className="token-created">{token.createdAt ? new Date(token.createdAt).toLocaleDateString() : 'Just now'}</span><button className="button button-danger-quiet button-small" aria-label={`Revoke ${token.name}`} onClick={() => setRevokeTarget(token)}>Revoke</button></div>)}</div> : <div className="empty-state compact"><h3>No tokens yet</h3><p>Create one when a project is ready to connect.</p></div>}</section></div>
    {newToken && <Modal title="Your new API token" onClose={dismissToken}><p className="modal-lede">Copy it now and store it in your app’s environment. We cannot show the full token again.</p><div className="secret-box"><code>{newToken.token}</code><button className="icon-button" aria-label="Copy token" onClick={() => navigator.clipboard?.writeText(newToken.token)}><Icon name="copy"/></button></div><span className="one-time-note"><span className="live-dot"/> Shown only once</span><div className="modal-actions"><button className="button button-primary" onClick={dismissToken}>Done</button></div></Modal>}
    {revokeTarget && <Modal title="Revoke this token?" onClose={() => setRevokeTarget(null)} role="alertdialog"><p className="modal-lede"><strong>{revokeTarget.name}</strong> will immediately lose access. Any app using it will receive an authentication error.</p><div className="modal-actions"><button className="button button-quiet" onClick={() => setRevokeTarget(null)}>Cancel</button><button className="button button-danger" onClick={async () => { await onRevoke(revokeTarget); setRevokeTarget(null); }}>Confirm revoke</button></div></Modal>}
  </>;
}

function SettingsPage({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setForm(settings), [settings]);
  function set(key, value) { setForm((current) => ({ ...current, [key]: value })); setMessage(''); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await onSave({ ...form, minDelayMs: Number(form.minDelayMs), maxDelayMs: Number(form.maxDelayMs), streamChunkDelayMs: Number(form.streamChunkDelayMs), chatTemplates: String(form.chatTemplatesText ?? form.chatTemplates.join('\n')).split('\n').map((line) => line.trim()).filter(Boolean), thinkingTemplates: String(form.thinkingTemplatesText ?? form.thinkingTemplates.join('\n')).split('\n').map((line) => line.trim()).filter(Boolean) }); setMessage('Settings saved'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const chatText = form.chatTemplatesText ?? form.chatTemplates?.join('\n') ?? '';
  const thinkingText = form.thinkingTemplatesText ?? form.thinkingTemplates?.join('\n') ?? '';
  return <><div className="page-intro"><div><span className="eyebrow">PERSONALITY SETTINGS</span><h1>Settings</h1><p>Control how convincing the pauses and punchlines feel.</p></div></div><form className="settings-form" onSubmit={submit}>
    <section className="panel settings-panel"><div className="settings-section-heading"><span className="settings-icon">◷</span><div><h2>Simulated latency</h2><p>Make requests wait before the placeholder arrives.</p></div></div><div className="settings-fields"><label>Minimum delay <span className="input-suffix"><input type="number" min="0" max="120000" aria-label="Minimum delay" value={form.minDelayMs} onChange={(event) => set('minDelayMs', event.target.value)}/><span>ms</span></span></label><label>Maximum delay <span className="input-suffix"><input type="number" min="0" max="120000" aria-label="Maximum delay" value={form.maxDelayMs} onChange={(event) => set('maxDelayMs', event.target.value)}/><span>ms</span></span></label><label>Stream chunk delay <span className="input-suffix"><input type="number" min="0" max="10000" aria-label="Stream chunk delay" value={form.streamChunkDelayMs} onChange={(event) => set('streamChunkDelayMs', event.target.value)}/><span>ms</span></span></label></div><p className="field-hint">The simulated thinking and answer arrive after this delay. No compute is happening.</p></section>
    <section className="panel settings-panel"><div className="settings-section-heading"><span className="settings-icon settings-icon-violet">✳</span><div><h2>Thinking theatre</h2><p>Expose an obviously theatrical reasoning placeholder.</p></div><label className="switch settings-switch"><input type="checkbox" aria-label="Enable fake thinking" checked={Boolean(form.thinkingEnabled)} onChange={(event) => set('thinkingEnabled', event.target.checked)}/><span className="switch-track"/></label></div><label className="textarea-label">Thinking templates <textarea aria-label="Thinking templates" rows="3" value={thinkingText} onChange={(event) => set('thinkingTemplatesText', event.target.value)} placeholder="One placeholder per line"/></label></section>
    <section className="panel settings-panel"><div className="settings-section-heading"><span className="settings-icon settings-icon-yellow">✦</span><div><h2>Response templates</h2><p>One English placeholder per line. The model picks one at random.</p></div></div><label className="textarea-label">Response templates <textarea aria-label="Response templates" rows="4" value={chatText} onChange={(event) => set('chatTemplatesText', event.target.value)} placeholder="One placeholder per line"/></label></section>
    <div className="settings-footer"><div>{message && <span className="save-success">✓ {message}</span>}<ErrorBanner>{error}</ErrorBanner></div><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'} <Icon name="arrow" size={15}/></button></div>
  </form></>;
}

function ApiGuide() {
  const origin = window.__ARROGANTLLM_PUBLIC_BASE_URL__ || window.location.origin;
  const baseUrl = `${origin}/v1`;
  const model = 'your-active-model';
  const snippets = [
    { title: 'cURL', language: 'bash', code: `export ARROGANTLLM_API_KEY="your-token"\nexport OPENAI_BASE_URL="${baseUrl}"\ncurl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $ARROGANTLLM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"Say hello."}]}'` },
    { title: 'Python · OpenAI SDK', language: 'python', code: `import os\nfrom openai import OpenAI\n\nclient = OpenAI(base_url="${baseUrl}", api_key=os.environ["ARROGANTLLM_API_KEY"])\nresponse = client.chat.completions.create(\n    model="${model}",\n    messages=[{"role": "user", "content": "Say hello."}],\n)\nprint(response.choices[0].message.content)` },
    { title: 'Node.js · OpenAI SDK', language: 'javascript', code: `import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "${baseUrl}", apiKey: process.env.ARROGANTLLM_API_KEY });\nconst response = await client.chat.completions.create({\n  model: "${model}",\n  messages: [{ role: "user", content: "Say hello." }],\n});\nconsole.log(response.choices[0].message.content);` },
    { title: 'OpenCode', language: 'jsonc', command: `export ARROGANTLLM_API_KEY=\"your-token\"\nopencode run --model arrogantllm/${model} \"Say hello.\"`, code: `// Add to opencode.json in your project\n{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "arrogantllm/${model}",\n  "providers": {\n    "arrogantllm": {\n      "name": "ArrogantLLM local mock",\n      "package": "@opencode/ai/providers/openai-compatible",\n      "settings": {\n        "baseURL": "${baseUrl}",\n        "apiKey": "{env:ARROGANTLLM_API_KEY}"\n      },\n      "models": {\n        "${model}": { "name": "${model}", "limit": { "context": 1048576, "output": 8192 } }\n      }\n    }\n  }\n}` },
    { title: 'Codex CLI · Responses API', language: 'toml', command: `export ARROGANTLLM_API_KEY=\"your-token\"\ncodex exec --model ${model} \"Say hello.\"`, code: `# Add to ~/.codex/config.toml\nmodel = "${model}"\nmodel_provider = "arrogantllm"\n\n[model_providers.arrogantllm]\nname = "ArrogantLLM mock"\nbase_url = "${baseUrl}"\nenv_key = "ARROGANTLLM_API_KEY"\nwire_api = "responses"` },
  ];
  const [copied, setCopied] = useState('');
  async function copy(title, code) { await navigator.clipboard?.writeText(code); setCopied(title); window.setTimeout(() => setCopied(''), 1800); }
  return <><div className="page-intro"><div><span className="eyebrow">CLIENT INTEGRATION</span><h1>API Guide</h1><p>Connect your app to a model that is only pretending to think.</p></div><span className="status-pill"><span className="live-dot"/> OpenAI compatible</span></div><section className="guide-hero"><div><span className="eyebrow">DROP-IN MOCK</span><h2>Keep your client code.<br/>Swap the base URL.</h2><p>Use an OpenAI-compatible client, choose an active model, and create a consumer token in the console.</p></div><div className="endpoint-card"><span>BASE URL</span><code>{baseUrl}</code><span>AUTHENTICATION</span><code>Authorization: Bearer &lt;token&gt;</code></div></section><section className="panel guide-endpoints"><div className="panel-heading"><div><span className="eyebrow">SUPPORTED ROUTES</span><h2>Common endpoints</h2></div></div><div className="endpoint-list">{[['GET','/v1/models','List active fake models'],['POST','/v1/chat/completions','Chat, streaming, fake thinking and tool calls'],['POST','/v1/responses','Responses API shape'],['POST','/v1/completions','Legacy text completion shape'],['POST','/v1/embeddings','Predictably meaningless vectors']].map(([method, route, description]) => <div className="endpoint-row" key={route}><span className={`method-chip method-${method.toLowerCase()}`}>{method}</span><code>{route}</code><span>{description}</span></div>)}</div></section><div className="guide-sample-grid">{snippets.map(({ title, language, code, command }) => <section className="panel guide-sample" key={title}><div className="panel-heading"><div><span className="eyebrow">{language}</span><h2>{title}</h2></div><button className="button button-quiet" onClick={() => copy(title, code)} aria-label={`Copy ${title} example`}><Icon name="copy" size={15}/>{copied === title ? 'Copied' : 'Copy'}</button></div><pre><code>{code}</code></pre>{command && <div className="guide-run-command"><span className="eyebrow">RUN</span><pre><code>{command}</code></pre></div>}</section>)}</div><section className="panel compatibility-notes"><span className="eyebrow">HARNESS COMPATIBILITY</span><p><strong>Claude Code:</strong> speaks Anthropic's Messages API, so it cannot call this OpenAI-compatible endpoint directly. It needs an Anthropic-compatible adapter. <a href="https://docs.anthropic.com/en/docs/claude-code/llm-gateway" target="_blank" rel="noreferrer">Gateway docs</a></p><p><strong>ChatGPT app:</strong> does not accept a custom model API base URL. ChatGPT GPT Actions and MCP apps connect tools, not a custom inference endpoint. <a href="https://help.openai.com/en/articles/9442513" target="_blank" rel="noreferrer">GPT Actions docs</a></p><p><strong>Codex CLI:</strong> recent releases use the Responses API; the example above targets <code>/v1/responses</code>. Check your installed version's provider support. <a href="https://developers.openai.com/codex/config-reference/" target="_blank" rel="noreferrer">Configuration reference</a></p></section><p className="guide-footnote">Set <code>ARROGANTLLM_API_KEY</code> to a token created above and replace <code>{model}</code> with an active model ID. Answers are configured placeholders; no model is loaded.</p><div className="disclaimer-inline"><span>!</span><p>This is a development mock for humor and testing. It is not a real inference service or a honeypot.</p></div></>;
}
function ConfirmDelete({ model, onCancel, onConfirm }) {
  return <Modal title="Delete this model?" onClose={onCancel} role="alertdialog"><p className="modal-lede"><strong>{model.name}</strong> will be removed from your catalog. Existing clients can no longer call it.</p><div className="modal-actions"><button className="button button-quiet" onClick={onCancel}>Cancel</button><button className="button button-danger" onClick={onConfirm}>Confirm delete</button></div></Modal>;
}

export default function App() {
  const [authState, setAuthState] = useState('checking');
  const [authMode, setAuthMode] = useState('local');
  const [csrfToken, setCsrf] = useState(null);
  const [page, setPage] = useState('overview');
  const [models, setModels] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [settings, setSettings] = useState({ minDelayMs: 180, maxDelayMs: 900, streamChunkDelayMs: 120, thinkingEnabled: true, chatTemplates: [], thinkingTemplates: [] });
  const [summary, setSummary] = useState({ totalRequests: 0, lastRequestAt: null, requestsByEndpoint: {} });
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [editingModel, setEditingModel] = useState(undefined);
  const [deleteModel, setDeleteModel] = useState(null);
  const [newToken, setNewToken] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);

  const refreshData = useCallback(async () => {
    const [nextModels, nextTokens, nextSettings, nextSummary] = await Promise.all([api.models(), api.tokens(), api.settings(), api.summary()]);
    setModels(nextModels); setTokens(nextTokens); setSettings(nextSettings); setSummary(nextSummary);
  }, []);

  useEffect(() => {
    let alive = true;
    api.session().then(async (session) => {
      if (!alive) return;
      if (!session.authenticated) { setAuthState('signed-out'); return; }
      setAuthMode(session.authMode || 'local');
      setCsrfToken(session.csrfToken); setCsrf(session.csrfToken);
      try { await refreshData(); if (alive) setAuthState('signed-in'); }
      catch (err) { if (alive) { setError(err.message); setAuthState('signed-in'); } }
    }).catch(() => { if (alive) setAuthState('signed-out'); });
    return () => { alive = false; };
  }, [refreshData]);

  useEffect(() => { if (!toast) return undefined; const id = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(id); }, [toast]);

  async function handleLogin(credentials) {
    const result = await api.login(credentials);
    setCsrf(result.csrfToken); setCsrfToken(result.csrfToken);
    await refreshData(); setPage('overview'); setAuthState('signed-in');
  }

  async function handleLogout() { try { await api.logout(); } catch { /* The next login will replace the expired session. */ } setCsrfToken(null); setCsrf(null); setAuthState('signed-out'); }

  async function saveModel(value) {
    if (editingModel?.id) {
      const metadata = { ...(editingModel.metadata || {}), contextLength: { value: value.contextLength, provenance: value.contextLength ? 'published' : 'unknown' }, task: { value: value.task, provenance: 'published' } };
      await api.updateModel(editingModel.id, { name: value.name, metadata });
      setToast('Model updated');
    } else {
      await api.createModel({ id: value.id, name: value.name, active: false, metadata: { contextLength: { value: value.contextLength, provenance: value.contextLength ? 'published' : 'unknown' }, task: { value: value.task, provenance: 'published' } } });
      setToast('Model added to the catalog');
    }
    setEditingModel(undefined); await refreshData();
  }

  async function toggleModel(model, active) {
    setError('');
    try { await api.updateModel(model.id, { active }); await refreshData(); setToast(active ? 'Model activated' : 'Model paused'); }
    catch (err) { setError(err.message); }
  }

  async function removeModel() {
    const model = deleteModel; if (!model) return;
    try { await api.deleteModel(model.id); setDeleteModel(null); setEditingModel(undefined); await refreshData(); setToast('Model removed'); }
    catch (err) { setError(err.message); }
  }

  async function saveSettings(next) { const saved = await api.saveSettings(next); setSettings(saved); }
  async function createToken(name) { const token = await api.createToken(name); setNewToken(token); await refreshData(); }
  async function revokeToken(token) { await api.deleteToken(token.id); await refreshData(); setToast('Token revoked'); }

  const pageTitle = useMemo(() => NAV_ITEMS.find(([id]) => id === page)?.[1] || 'Overview', [page]);
  if (authState === 'checking') return <main className="loading-screen"><span className="brand-mark"><Icon name="spark"/></span><p>Checking the pretend credentials…</p></main>;
  if (authState === 'signed-out') return <Login onLogin={handleLogin}/>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setPage('overview'); }}><span className="brand-mark"><Icon name="spark" size={22}/></span><span className="brand-text">Arrogant<span>LLM</span><small>MODEL SIMULATOR</small></span></a>
      <div className="side-status"><span className="live-dot"/> SIMULATION MODE</div><nav aria-label="Main navigation">{NAV_ITEMS.map(([id, label, icon]) => <button key={id} className={`nav-item ${page === id ? 'nav-active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setMobileNav(false); }}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}{id === 'tokens' && tokens.length > 0 && <span className="nav-count">{tokens.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="admin-profile"><span className="avatar">A</span><div><strong>Administrator</strong><small>{authMode === 'external' ? 'Managed by your proxy' : 'Local workspace'}</small></div>{authMode !== 'external' && <button className="icon-button logout-button" aria-label="Sign out" onClick={handleLogout}>↗</button>}</div><p className="sidebar-disclaimer">Fictional responses.<br/>Real test coverage.</p></div>
    </aside>
    <main className="main-shell"><header className="topbar"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav((value) => !value)}>☰</button><div className="breadcrumb"><span>Console</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-right"><span className="online-indicator"><span className="live-dot"/> API online</span><span className="topbar-separator"/><span className="environment-tag">LOCAL DEV</span><span className="avatar avatar-small">A</span></div></header>
      <div className="content-wrap"><ErrorBanner onDismiss={() => setError('')}>{error}</ErrorBanner>
        {page === 'overview' && <Overview models={models} tokens={tokens} summary={summary} navigate={setPage}/>}
        {page === 'models' && <ModelsPage models={models} onToggle={toggleModel} onEdit={(model) => setEditingModel(model)} onAdd={() => setEditingModel(null)}/>}
        {page === 'marketplace' && <MarketplacePage onImport={async (model) => { try { await api.importModel(model.repoId); await refreshData(); setToast('Model imported and left inactive'); } catch (err) { setError(err.message); } }}/>}
        {page === 'tokens' && <TokensPage tokens={tokens} onCreate={createToken} onRevoke={revokeToken} newToken={newToken} dismissToken={() => setNewToken(null)}/>}
        {page === 'settings' && <SettingsPage settings={settings} onSave={saveSettings}/>}
        {page === 'api' && <ApiGuide/>}
      </div>
      <footer className="app-footer"><span>ARROGANTLLM <b>·</b> A MOCK LLM API</span><span>Nothing is being inferred. We checked.</span></footer>
    </main>
    {editingModel !== undefined && <ModelDialog model={editingModel} onClose={() => setEditingModel(undefined)} onSave={saveModel} onDelete={() => setDeleteModel(editingModel)}/>}
    {deleteModel && <ConfirmDelete model={deleteModel} onCancel={() => setDeleteModel(null)} onConfirm={removeModel}/>}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </div>;
}
