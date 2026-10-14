'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, Braces, Check, CheckCircle2, ChevronRight, CircleAlert, Clock3, Copy, Layers3, Radio, Terminal, Trash2, X, Zap } from 'lucide-react';
import type { AITrace } from '@/lib/trace';

type Props = { open: boolean; onClose: () => void; calls: AITrace[]; onClear: () => void };
type Filter = 'all' | 'success' | 'error';

const json = (value: unknown) => {
  if (value === undefined) return 'No payload returned.';
  try { return JSON.stringify(value, null, 2) ?? 'No payload returned.'; }
  catch { return String(value); }
};
const elapsed = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
const clock = (time: AITrace['time']) => {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? String(time) : date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const shortModel = (model: string) => model.split('/').at(-1) || model;
const statusLabel = (status: AITrace['status']) => ({ success: 'Success', error: 'Failed', cached: 'Cached', local: 'Local' })[status];
const tokenUsage = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const number = (...keys: string[]) => {
    const value = keys.map(key => usage[key]).find(item => typeof item === 'number' && Number.isFinite(item) && item >= 0);
    return typeof value === 'number' ? value : undefined;
  };
  const input = number('inputTokens', 'prompt_tokens', 'input_tokens', 'promptTokenCount');
  const output = number('outputTokens', 'completion_tokens', 'output_tokens', 'candidatesTokenCount');
  const total = number('totalTokens', 'total_tokens', 'totalTokenCount');
  return input === undefined && output === undefined && total === undefined ? null : { input, output, total: total ?? ((input ?? 0) + (output ?? 0)) };
};

export default function DebugDrawer({ open, onClose, calls, onClear }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [copied, setCopied] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { previous?.focus(); };
  }, [open]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const ordered = useMemo(() => [...calls].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()), [calls]);
  const models = useMemo(() => [...new Set(calls.map(call => call.model))], [calls]);
  const filtered = ordered.filter(call => (filter === 'all' || call.status === filter) && (modelFilter === 'all' || call.model === modelFilter));
  const selected = filtered.find(call => call.id === selectedId) ?? filtered[0];
  const selectedUsage = tokenUsage(selected?.usage);
  const networkCalls = calls.filter(call => call.status === 'success' || call.status === 'error');
  const successful = networkCalls.filter(call => call.status === 'success');
  const successfulModels = [...new Set(successful.map(call => call.model))];
  const tokens = networkCalls.reduce((total, call) => total + (tokenUsage(call.usage)?.total ?? 0), 0);
  const hasUsage = networkCalls.some(call => tokenUsage(call.usage));
  const totalDuration = successful.reduce((total, call) => total + call.durationMs, 0);
  const averageDuration = successful.length ? totalDuration / successful.length : 0;

  const copy = async (value: unknown, label: string) => {
    try {
      await navigator.clipboard.writeText(json(value));
      setCopied(label);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(''), 2000);
    } catch { setCopied('Copy unavailable'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json({ exportedAt: new Date().toISOString(), calls })], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `outside-ai-calls-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!open) return null;

  return <div className="trace-overlay" onClick={onClose}>
    <section className="trace-drawer" role="dialog" aria-modal="true" aria-labelledby="trace-title" ref={dialogRef} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, a[href], [tabindex="0"]');
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <header className="trace-header">
        <div className="trace-heading"><span className="trace-brand-icon"><Activity size={21} strokeWidth={1.6} /></span><div><div className="trace-eyebrow">AI CALLS</div><h2 id="trace-title">Behind your trip<span>.</span></h2></div></div>
        <button ref={closeRef} className="trace-icon-button trace-close" onClick={onClose} aria-label="Close AI inspector"><X size={20} /></button>
      </header>

      <div className="trace-toolbar"><span className="trace-session"><i /> AI call inspector <span className="trace-session-dot">·</span><small>This session</small></span><div className="trace-actions"><button onClick={() => void copy(calls, 'all')} disabled={!calls.length} title="Copy all calls as JSON">{copied === 'all' ? <Check size={14} /> : <Copy size={14} />}<span>{copied === 'all' ? 'Copied' : 'Copy JSON'}</span></button><button onClick={download} disabled={!calls.length} title="Download all calls as JSON"><ArrowDownToLine size={14} /><span>Export</span></button><button className="trace-clear" onClick={() => { onClear(); setSelectedId(null); setFilter('all'); setModelFilter('all'); }} disabled={!calls.length} title="Clear session log"><Trash2 size={14} /><span>Clear</span></button></div></div>

      <div className="trace-stats">
        <div><span><Radio size={13} /> Successful calls</span><strong>{successful.length.toString().padStart(2, '0')}<small>network</small></strong></div>
        <div><span><Layers3 size={13} /> Models used</span><strong>{successfulModels.length.toString().padStart(2, '0')}<small>{successfulModels.length > 1 ? 'multi-model' : 'responded'}</small></strong></div>
        <div><span><Clock3 size={13} /> Avg. latency</span><strong>{successful.length ? elapsed(averageDuration) : '—'}<small>per call</small></strong></div>
        <div><span><Zap size={13} /> Tokens</span><strong>{hasUsage ? tokens.toLocaleString() : '—'}<small>{hasUsage ? 'reported' : 'awaiting usage'}</small></strong></div>
      </div>

      {successfulModels.length > 1 && <div className="trace-model-proof"><Layers3 size={14} /><span>{successfulModels.length} models, one outdoor plan.</span><div>{successfulModels.map(model => <span key={model}>{shortModel(model)}</span>)}</div></div>}

      <div className="trace-body">
        <aside className="trace-sidebar" aria-label="AI call log">
          <div className="trace-filter-row"><div className="trace-filter-tabs" aria-label="Filter calls">{(['all', 'success', 'error'] as Filter[]).map(value => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All calls' : value === 'success' ? 'Success' : 'Errors'}{value === 'all' && <span>{calls.length}</span>}</button>)}</div><select aria-label="Filter by model" value={modelFilter} onChange={event => setModelFilter(event.target.value)}><option value="all">Every model</option>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></div>
          <div className="trace-list">
            {filtered.map((call, index) => <button className={`trace-call ${selected?.id === call.id ? 'selected' : ''}`} key={call.id} onClick={() => setSelectedId(call.id)} aria-pressed={selected?.id === call.id}>
              <div className="trace-call-top"><span className={`trace-status trace-status-${call.status}`}><i />{statusLabel(call.status)}</span><time>{clock(call.time)}</time></div>
              <div className="trace-call-model">{shortModel(call.model)}<ChevronRight size={15} /></div>
              <span className="trace-call-operation">{call.operation}</span>
              <div className="trace-call-bottom"><span>{call.provider}</span><span>{elapsed(call.durationMs)}</span></div>
              {call.fallback && <span className="trace-fallback"><ArrowUpRight size={11} /> Fallback attempt</span>}
              <span className="trace-call-number">{String(filtered.length - index).padStart(2, '0')}</span>
            </button>)}
            {!filtered.length && calls.length > 0 && <div className="trace-no-results"><Braces size={22} /><strong>No matching calls</strong><span>Try another status or model.</span><button onClick={() => { setFilter('all'); setModelFilter('all'); }}>Show all calls</button></div>}
            {!calls.length && <div className="trace-list-empty"><span>YOUR CALL LOG</span><div /><div /><div /></div>}
          </div>
          <div className="trace-log-note"><span className="trace-live-dot" /><span>Actual requests. Actual responses.</span></div>
        </aside>

        <main className="trace-detail" aria-label="Selected AI call details">
          {selected ? <>
            <div className="trace-detail-header"><div className="trace-detail-eyebrow"><Terminal size={13} /> CALL DETAILS <span className={`trace-status trace-status-${selected.status}`}><i />{statusLabel(selected.status)}</span></div><h3>{selected.operation.replace(/[_-]/g, ' ')}</h3><div className="trace-model-chips"><span className="trace-model-chip">{selected.model}</span><span>{selected.provider}</span></div><div className="trace-call-meta"><span><Clock3 size={12} />{elapsed(selected.durationMs)}</span><span>{clock(selected.time)}</span>{selectedUsage && <span><Zap size={12} />{selectedUsage.total.toLocaleString()} tokens</span>}</div>{selected.endpoint && <div className="trace-endpoint"><span>ENDPOINT</span><code>{selected.endpoint}</code></div>}</div>
            {selected.fallback && <div className="trace-fallback-note"><ArrowUpRight size={14} /><span>Fallback attempt · an alternate path was used for this request.</span></div>}
            {selected.error && <div className="trace-error"><CircleAlert size={15} /><div><strong>Request error</strong><p>{selected.error}</p></div></div>}
            {selectedUsage && <div className="trace-token-breakdown"><span><i />Input <b>{selectedUsage.input?.toLocaleString() ?? '—'}</b></span><span><i />Output <b>{selectedUsage.output?.toLocaleString() ?? '—'}</b></span></div>}
            <div className="trace-payloads">
              <section className="trace-payload"><header><span><ArrowUpRight size={14} /> Request</span><button onClick={() => void copy(selected.request, 'request')} aria-label="Copy request JSON">{copied === 'request' ? <Check size={13} /> : <Copy size={13} />}{copied === 'request' ? 'Copied' : 'Copy'}</button></header><pre tabIndex={0} aria-label="Request JSON">{json(selected.request)}</pre></section>
              <section className="trace-payload trace-response"><header><span>{selected.status === 'error' ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />} Response</span><button onClick={() => void copy(selected.response, 'response')} aria-label="Copy response JSON">{copied === 'response' ? <Check size={13} /> : <Copy size={13} />}{copied === 'response' ? 'Copied' : 'Copy'}</button></header><pre tabIndex={0} aria-label="Response JSON">{json(selected.response)}</pre></section>
            </div>
            <p className="trace-redaction"><Braces size={12} /> Credentials and image payloads are omitted from the log.</p>
          </> : <div className="trace-empty"><div className="trace-empty-orbit"><span /><span /><span /><Activity size={30} strokeWidth={1.3} /></div><span className="trace-eyebrow">REQUEST LOG</span><h3>See each request.</h3><p>Make a plan or inspect a camera<br />to see calls here.</p><div><span><ArrowUpRight size={13} /> Request</span><span><Layers3 size={13} /> Model</span><span><CheckCircle2 size={13} /> Response</span></div></div>}
        </main>
      </div>
      <footer className="trace-footer"><span><Activity size={12} /> OUTSIDE <i>/</i> Request and response log.</span><span>{calls.length} {calls.length === 1 ? 'call' : 'calls'} captured <i>·</i> Current browser session</span></footer>
      <span className="trace-sr-only" role="status" aria-live="polite">{copied === 'Copy unavailable' ? 'Clipboard unavailable in this browser.' : copied ? 'JSON copied to clipboard.' : ''}</span>
    </section>
    <style jsx>{`
      .trace-overlay{position:fixed;inset:0;z-index:100;background:#142a2459;backdrop-filter:blur(5px);display:flex;justify-content:flex-end;animation:traceFade .2s ease}
      .trace-drawer{width:min(1040px,100vw);height:100dvh;display:flex;flex-direction:column;background:#faf9f5;color:#243c32;border-left:1px solid #d9dfd1;box-shadow:-16px 0 70px #12261f26;animation:traceSlide .3s cubic-bezier(.2,.7,.2,1);overflow:hidden;text-align:left}
      .trace-header{display:flex;align-items:center;justify-content:space-between;padding:29px 31px 25px;border-bottom:1px solid #e4e8dd;gap:20px}.trace-heading{display:flex;align-items:center;gap:15px;min-width:0}.trace-brand-icon{display:flex;align-items:center;justify-content:center;width:43px;height:43px;border:1px solid #d9e1ce;background:#eef2e7;border-radius:12px;flex-shrink:0;color:#385c44}.trace-eyebrow{font:500 9px 'DM Sans',sans-serif;letter-spacing:2px;color:#8e9b7f}.trace-header h2{font:600 22px Manrope,sans-serif;letter-spacing:-.65px;margin:6px 0 0;line-height:1.25}.trace-header h2>span{color:#ee6746}.trace-icon-button{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid #e0e5d8;border-radius:50%;color:#7a8c6c;flex-shrink:0}.trace-icon-button:hover{background:#eff1e9}.trace-toolbar{padding:15px 31px;display:flex;align-items:center;justify-content:space-between;gap:15px}.trace-session{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:500;white-space:nowrap}.trace-session>i,.trace-live-dot{width:5px;height:5px;border-radius:50%;background:#6d8a50;flex-shrink:0}.trace-session-dot{color:#b4bcaa;margin:0 2px}.trace-session small{font-size:10px;color:#9ba58f;font-weight:400}.trace-actions{display:flex;align-items:center;gap:16px}.trace-actions>button{display:flex;align-items:center;gap:6px;font-size:10px;color:#7b8b6d;padding:4px 0;white-space:nowrap}.trace-actions .trace-clear{color:#aa8c7e}.trace-actions button:disabled{opacity:.35}.trace-stats{display:grid;grid-template-columns:repeat(4,1fr);margin:0 31px 19px;border:1px solid #e1e7d7;border-radius:10px;overflow:hidden;background:#f4f5ed}.trace-stats>div{padding:17px 20px}.trace-stats>div+div{border-left:1px solid #e0e6d7}.trace-stats>div>span{display:flex;gap:6px;align-items:center;font-size:9px;color:#8c9b7c}.trace-stats strong{display:flex;align-items:baseline;gap:9px;font:500 25px Manrope,sans-serif;letter-spacing:-.6px;color:#47633b;margin-top:7px;white-space:nowrap}.trace-stats strong>small{font:400 8px 'DM Sans',sans-serif;letter-spacing:0;color:#9ba78d}.trace-model-proof{display:flex;align-items:center;gap:8px;padding:0 32px 18px;font-size:10px;color:#73885f}.trace-model-proof>div{display:flex;gap:5px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}.trace-model-proof>div>span{padding:4px 7px;border:1px solid #dfe6d4;border-radius:4px;background:#f0f3e9;font:9px ui-monospace,SFMono-Regular,Menlo,monospace}.trace-body{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:0;flex:1;border-top:1px solid #e2e7da}.trace-sidebar{min-height:0;display:flex;flex-direction:column;border-right:1px solid #e2e7da;background:#f6f7f0}.trace-filter-row{padding:16px 17px;border-bottom:1px solid #e3e8da}.trace-filter-tabs{display:flex;align-items:center;gap:4px;background:#ecefe4;border-radius:6px;padding:3px;margin-bottom:11px}.trace-filter-tabs>button{font-size:9px;flex:1;padding:7px 6px;border-radius:4px;color:#98a48b;display:flex;align-items:center;justify-content:center;gap:5px}.trace-filter-tabs>button.active{background:#fafbf5;color:#567246;box-shadow:0 1px 4px #27492c09}.trace-filter-tabs>button>span{font:8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8da077}.trace-filter-row select{width:100%;background:#fafbf5;border:1px solid #dfe5d5;color:#80936c;border-radius:5px;padding:8px;font:9px 'DM Sans',sans-serif;outline-offset:2px}.trace-list{overflow-y:auto;flex:1;min-height:0;padding:9px}.trace-call{position:relative;width:100%;padding:15px 13px 13px;text-align:left;border:1px solid transparent;border-radius:7px;display:block;margin-bottom:5px;color:#4d6541;background:transparent}.trace-call:hover{background:#eef2e6}.trace-call.selected{background:#fafbf5;border-color:#d5dfc8;box-shadow:0 2px 8px #1b3a2605}.trace-call.selected:before{position:absolute;content:'';left:-1px;top:19px;bottom:19px;width:3px;background:#ed7655;border-radius:0 2px 2px 0}.trace-call-top{display:flex;align-items:center;justify-content:space-between;gap:6px}.trace-status{display:inline-flex;align-items:center;gap:5px;font-size:8px;color:#839975;line-height:1.2;white-space:nowrap}.trace-status>i{width:4px;height:4px;border-radius:50%;background:currentColor}.trace-status-error{color:#ce775b}.trace-status-cached{color:#ad9360}.trace-status-local{color:#919b9f}.trace-call time{font:8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#a1ad94}.trace-call-model{display:flex;justify-content:space-between;align-items:center;font:600 12px Manrope,sans-serif;letter-spacing:-.2px;margin-top:11px;gap:5px;overflow-wrap:anywhere}.trace-call-model>:global(svg){flex-shrink:0;color:#a4b195}.trace-call-operation{font:9px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8a9a78;display:block;margin-top:6px;overflow-wrap:anywhere}.trace-call-bottom{display:flex;justify-content:space-between;gap:8px;font-size:8px;color:#a3ae97;margin-top:13px}.trace-call-bottom>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}.trace-call-bottom>span:last-child{white-space:nowrap}.trace-call-number{position:absolute;right:13px;top:60px;display:none;font:8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#c2cbb8}.trace-fallback{display:inline-flex;align-items:center;gap:3px;color:#b18c64;font-size:8px;padding:4px 6px;background:#f4efe2;border-radius:3px;margin-top:9px}.trace-log-note{font-size:8px;color:#a0ad93;display:flex;align-items:center;gap:7px;border-top:1px solid #e0e7d6;padding:13px 18px}.trace-live-dot{width:4px;height:4px;background:#9bb185}.trace-detail{min-height:0;overflow-y:auto;padding:24px 26px;background:#faf9f5}.trace-detail-header{padding-bottom:18px}.trace-detail-eyebrow{display:flex;align-items:center;gap:6px;font:8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#a2ad96}.trace-detail-eyebrow .trace-status{margin-left:auto;letter-spacing:0;background:#eef2e7;border:1px solid #e1e7d8;border-radius:20px;padding:5px 8px}.trace-detail-eyebrow .trace-status-error{background:#f8eee7;border-color:#eedfd3}.trace-detail h3{font:600 23px Manrope,sans-serif;letter-spacing:-.65px;margin:13px 0 12px;line-height:1.35;overflow-wrap:anywhere;text-transform:none}.trace-model-chips{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:8px;color:#a0a893}.trace-model-chip{display:inline-block;font:9px ui-monospace,SFMono-Regular,Menlo,monospace!important;line-height:1.5!important;color:#607c4d!important;background:#edf1e4;border:1px solid #dce5ce;padding:5px 8px;border-radius:4px;overflow-wrap:anywhere;max-width:100%}.trace-call-meta{display:flex;align-items:center;gap:15px;margin-top:14px;color:#9ba78d;font:9px ui-monospace,SFMono-Regular,Menlo,monospace;flex-wrap:wrap}.trace-call-meta>span{display:flex;gap:5px;align-items:center}.trace-endpoint{display:flex;gap:8px;font-size:8px;margin-top:15px;align-items:baseline}.trace-endpoint>span{color:#a6af9a;font-size:7px;letter-spacing:1px;flex-shrink:0}.trace-endpoint>code{font:8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8c9d7b;overflow-wrap:anywhere}.trace-fallback-note{display:flex;align-items:flex-start;gap:8px;font-size:9px;line-height:1.6;background:#f4f0e5;border:1px solid #e9e1ce;border-radius:5px;padding:10px 12px;color:#a48d63;margin-bottom:14px}.trace-fallback-note>:global(svg){flex-shrink:0}.trace-error{display:flex;gap:9px;background:#f9eee7;border:1px solid #eed9cc;border-radius:6px;padding:13px;color:#be7a59;margin:0 0 15px;font-size:10px;line-height:1.6}.trace-error>:global(svg){flex-shrink:0;margin-top:1px}.trace-error strong{font-size:9px;font-weight:600}.trace-error p{margin:4px 0 0;font:9px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.trace-token-breakdown{display:flex;gap:17px;margin:0 0 17px;font-size:8px;color:#a0ab93}.trace-token-breakdown>span{display:flex;align-items:center;gap:5px}.trace-token-breakdown i{height:5px;width:5px;border-radius:1px;background:#b2c19b}.trace-token-breakdown>span+span i{background:#e8ad8e}.trace-token-breakdown b{font:9px ui-monospace,SFMono-Regular,Menlo,monospace;color:#7e9369;margin-left:3px}.trace-payloads{display:flex;flex-direction:column;gap:15px}.trace-payload{border:1px solid #e0e6d5;border-radius:7px;overflow:hidden;background:#f3f5ec}.trace-payload>header{padding:11px 13px;display:flex;align-items:center;justify-content:space-between;background:#eff2e7;border-bottom:1px solid #e1e7d8;gap:10px}.trace-payload>header>span{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:500;color:#7a9066}.trace-payload>header>button{display:flex;gap:5px;align-items:center;font-size:8px;color:#9aa88c;padding:0}.trace-payload pre{font:11px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#70845f;margin:0;padding:14px;max-height:310px;overflow:auto;tab-size:2;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.trace-response{background:#f7f7ef}.trace-response>header{background:#f2f4e9}.trace-redaction{display:flex;align-items:center;gap:6px;font-size:8px;line-height:1.7;color:#acb39e;margin:15px 0 0}.trace-redaction>:global(svg){flex-shrink:0}.trace-empty{min-height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:35px 10px}.trace-empty-orbit{position:relative;width:130px;height:130px;display:flex;align-items:center;justify-content:center;color:#93a77c;margin-bottom:28px;border:1px solid #edf0e5;border-radius:50%}.trace-empty-orbit:before{content:'';position:absolute;inset:17px;border:1px solid #e2e9d8;border-radius:50%}.trace-empty-orbit:after{content:'';position:absolute;inset:33px;background:#f0f3e8;border:1px solid #e0e7d4;border-radius:50%;z-index:0}.trace-empty-orbit>:global(svg){position:relative;z-index:1}.trace-empty-orbit>span{position:absolute;width:7px;height:7px;border-radius:50%;background:#e5a185;z-index:1;left:7px;top:30px;border:2px solid #faf9f5}.trace-empty-orbit>span:nth-child(2){left:auto;top:13px;right:26px;width:6px;height:6px;background:#a7ba8b}.trace-empty-orbit>span:nth-child(3){left:91px;top:auto;bottom:4px;width:6px;height:6px;background:#b3c39a}.trace-empty h3{font:500 31px Manrope,sans-serif;letter-spacing:-1px;color:#728662;margin:11px 0 12px}.trace-empty p{font-size:11px;line-height:1.9;color:#a0aa95;margin:0}.trace-empty>div:last-child{display:flex;gap:18px;margin-top:30px;color:#9da98f;font-size:8px}.trace-empty>div:last-child>span{display:flex;align-items:center;gap:5px}.trace-list-empty{padding:24px 13px}.trace-list-empty>span{font-size:7px;letter-spacing:1.6px;color:#bcc4b1}.trace-list-empty>div{height:79px;border:1px dashed #e1e7d8;border-radius:6px;margin-top:12px;background:linear-gradient(100deg,#f6f7f000,#f0f3e9aa)}.trace-no-results{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:50px 12px;color:#aab69b;gap:12px;text-align:center}.trace-no-results strong{font-size:11px;font-weight:500;color:#8c9e7a}.trace-no-results>span{font-size:9px}.trace-no-results>button{font-size:9px;border-bottom:1px solid #cad6bb;padding:5px 0;color:#8a9f75;margin-top:2px}.trace-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 25px;border-top:1px solid #e1e7d8;color:#a1ac93;background:#f3f5ec;font-size:8px}.trace-footer>span{display:flex;align-items:center;gap:6px}.trace-footer i{font-style:normal;color:#c1c9b5;margin:0 3px}.trace-sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.trace-drawer button:focus-visible,.trace-drawer select:focus-visible,.trace-drawer pre:focus-visible{outline:2px solid #e99b79;outline-offset:2px}
      @keyframes traceFade{from{opacity:0}to{opacity:1}}@keyframes traceSlide{from{transform:translateX(45px);opacity:0}to{transform:translateX(0);opacity:1}}
      @media(max-width:800px){.trace-header{padding:22px}.trace-header h2{font-size:19px}.trace-toolbar{padding:14px 22px}.trace-stats{margin-inline:22px}.trace-stats>div{padding:15px 12px}.trace-stats strong{font-size:22px;gap:5px;flex-wrap:wrap}.trace-stats strong>small{font-size:7px}.trace-model-proof{padding-inline:22px}.trace-body{grid-template-columns:260px minmax(0,1fr)}.trace-detail{padding:21px 19px}.trace-model-proof>div>span{font-size:8px}.trace-detail h3{font-size:21px}.trace-footer{padding-inline:20px}}
      @media(max-width:650px){.trace-header{padding:18px 17px}.trace-heading{gap:10px}.trace-brand-icon{width:35px;height:35px;border-radius:9px}.trace-eyebrow{font-size:7px;letter-spacing:1.5px}.trace-header h2{font-size:16px;letter-spacing:-.4px;max-width:260px}.trace-icon-button{width:29px;height:29px}.trace-toolbar{padding:13px 17px;align-items:flex-start}.trace-session{font-size:9px;gap:6px}.trace-session>small,.trace-session-dot{display:none}.trace-actions{gap:12px}.trace-actions>button{font-size:8px;gap:4px}.trace-actions .trace-clear>span{display:none}.trace-stats{margin:0 17px 15px;grid-template-columns:repeat(4,1fr)}.trace-stats>div{padding:12px 8px}.trace-stats>div>span{font-size:7px;gap:3px;line-height:1.4}.trace-stats>div>span>:global(svg){display:none}.trace-stats strong{font-size:19px;display:block;margin-top:6px;letter-spacing:-.5px}.trace-stats strong>small{display:block;font-size:7px;margin-top:4px;letter-spacing:0}.trace-model-proof{padding:0 17px 13px;gap:5px;font-size:8px;align-items:flex-start}.trace-model-proof>:global(svg){width:12px;flex-shrink:0;margin-top:1px}.trace-model-proof>span{max-width:115px;line-height:1.5;flex-shrink:0}.trace-model-proof>div{gap:3px}.trace-model-proof>div>span{font-size:7px;padding:3px 5px}.trace-body{display:flex;flex-direction:column;overflow-y:auto;min-height:0}.trace-sidebar{flex-shrink:0;border-right:0;border-bottom:1px solid #e2e7da;max-height:230px}.trace-filter-row{padding:10px 14px;display:flex;align-items:center;gap:10px}.trace-filter-tabs{margin:0;flex:1;min-width:180px}.trace-filter-tabs>button{padding:6px 4px;font-size:8px}.trace-filter-row select{width:115px;font-size:8px;padding:7px 5px}.trace-list{display:flex;gap:6px;padding:8px 13px;overflow-x:auto;overflow-y:hidden;flex:none;max-height:155px}.trace-call{flex:0 0 218px;padding:11px;margin:0;min-height:124px}.trace-call-model{font-size:11px;margin-top:9px}.trace-call-operation{font-size:8px;margin-top:5px}.trace-call-bottom{margin-top:10px}.trace-call time{font-size:7px}.trace-call.selected:before{top:12px;bottom:12px}.trace-log-note{display:none}.trace-detail{flex-shrink:0;overflow:visible;padding:20px 17px;min-height:350px}.trace-detail-header{padding-bottom:16px}.trace-detail h3{font-size:21px}.trace-payload pre{font-size:10px;max-height:280px;padding:12px}.trace-footer{padding:11px 16px;font-size:7px}.trace-footer>span:first-child{font-size:7px}.trace-footer>span:last-child{font-size:7px;max-width:155px;text-align:right;display:block;line-height:1.5}.trace-footer>span:first-child>i{display:none}.trace-footer>span:first-child{font-size:0;gap:5px}.trace-footer>span:first-child>:global(svg){width:14px}.trace-empty{min-height:340px;padding:20px 10px}.trace-empty-orbit{width:105px;height:105px;margin-bottom:22px}.trace-empty-orbit:before{inset:14px}.trace-empty-orbit:after{inset:27px}.trace-empty-orbit>span:nth-child(3){left:71px}.trace-empty h3{font-size:27px}.trace-list-empty{display:none}.trace-no-results{padding:13px;flex-direction:row;gap:10px;width:100%;min-height:100px}.trace-no-results>span{display:none}.trace-no-results>button{margin-left:auto}.trace-call-meta{gap:12px;font-size:8px}.trace-endpoint{font-size:7px}.trace-model-chip{font-size:8px!important}.trace-response{margin-bottom:0}}
      @media(prefers-reduced-motion:reduce){.trace-overlay,.trace-drawer{animation:none}}
    `}</style>
  </div>;
}
