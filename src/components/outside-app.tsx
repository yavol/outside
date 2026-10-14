'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Backpack, Camera, Check, ChevronDown, ChevronRight, CloudSun, Code2, Compass, ExternalLink, Eye, Heart, Leaf, LoaderCircle, MapPin, Mic, Mountain, Plus, RefreshCw, Send, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Sun, Volume2, Waves, Wind, X } from 'lucide-react';
import { destinations, type DestinationId } from '@/lib/destinations';
import type { ConditionsResponse } from '@/lib/conditions';
import type { ShopProduct, ShopVariant } from '@/lib/shop';
import type { AITrace } from '@/lib/trace';
import type { EvaluationResult } from '@/lib/jev';
import DebugDrawer from './debug-drawer';

const CoastalMap = dynamic(() => import('./coastal-map'), { ssr: false, loading: () => <div className="map-loading"><Compass size={28} /><span>Finding the coast…</span></div> });
type Product = ShopProduct;
type Chat = { role: 'user' | 'assistant'; text: string; engine?: string; model?: string; latencyMs?: number; fallback?: boolean };
type AgentResult = { reply: string; selectedDestinationId?: DestinationId; budget?: number; owned?: string[]; action?: string; engine: string; model: string; latencyMs: number; fallback: boolean };
type CheckoutResult = { status: string; orderId?: string; receiptId?: string; message?: string; items?: unknown[]; total?: number; error?: string };
const categoryNames: Record<string, string> = { shell: 'Weather shell', daypack: 'Daypack', bottle: 'Water bottle' };
const money = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
const time = (v?: string | null) => v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : 'Checking…';

export default function OutsideApp() {
  const [selectedId, setSelectedId] = useState<DestinationId>('cowells');
  const [conditions, setConditions] = useState<ConditionsResponse | null>(null);
  const [conditionsError, setConditionsError] = useState(false);
  const [tab, setTab] = useState<'places' | 'bag'>('places');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Chat[]>([]);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(120);
  const [products, setProducts] = useState<Product[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [traces, setTraces] = useState<AITrace[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [shopBusy, setShopBusy] = useState(false);
  const [optionBusy, setOptionBusy] = useState('');
  const [expandedProducts, setExpandedProducts] = useState<string[]>([]);
  const [shopError, setShopError] = useState('');
  const [owned, setOwned] = useState<string[]>([]);
  const [bag, setBag] = useState<Product[]>([]);
  const [saved, setSaved] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [forceFallback, setForceFallback] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [vision, setVision] = useState('');
  const [visionBusy, setVisionBusy] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [scanCategory, setScanCategory] = useState<string | null>(null);
  const [scanDescription, setScanDescription] = useState('');
  const [scanImage, setScanImage] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [checkout, setCheckout] = useState<'closed' | 'review' | 'complete'>('closed');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);
  const [toast, setToast] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [showCameras, setShowCameras] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const scannerOpenRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const visionRequestRef = useRef(0);
  const gearRequestRef = useRef(0);
  const shopRequestRef = useRef(0);
  const evaluationRequestRef = useRef(0);
  const evaluatedSignatureRef = useRef('');
  const selected = destinations.find(d => d.id === selectedId)!;
  const current = conditions?.destinations.find(d => d.id === selectedId);
  const total = bag.reduce((sum, p) => sum + p.priceAmount, 0) / 100;
  const latest = messages.filter(m => m.role === 'assistant').at(-1);
  const captureTrace = useCallback((data: {trace?:AITrace[]}) => { if (data.trace?.length) setTraces(calls => [...calls,...data.trace!].slice(-60)); }, []);
  const evaluationSignature = `${selectedId}:${budget}:${owned.join(',')}:${products.map(p => p.variantId).join(',')}`;
  const imageFor = (id: DestinationId) => conditions?.destinations.find(d => d.id === id)?.camera.imageUrl || destinations.find(d => d.id === id)!.camera.imageUrl;
  const cameraImages = Object.fromEntries(destinations.map(d => [d.id, imageFor(d.id)]));

  const notify = useCallback((text: string) => { setToast(text); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem('outside-trip') || 'null'); if (v) { setSaved(true); if (v.owned) setOwned(v.owned); } } catch {} }, []);
  useEffect(() => { const controller = new AbortController(); fetch('/api/conditions', { signal: controller.signal }).then(r => r.json()).then(d => { if (!d.destinations) throw new Error(); setConditions(d); }).catch(e => { if (e.name !== 'AbortError') setConditionsError(true); }); return () => controller.abort(); }, []);
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => { if (stream && videoRef.current) videoRef.current.srcObject = stream; }, [stream, showScan]);
  useEffect(() => () => { stream?.getTracks().forEach(t => t.stop()); }, [stream]);
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);
  useEffect(() => {
    if (!products.length || evaluatedSignatureRef.current === evaluationSignature) return;
    evaluatedSignatureRef.current = evaluationSignature;
    const requestId = ++evaluationRequestRef.current;
    setEvaluating(true); setEvaluation(null);
    void fetch('/api/evaluate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinationId:selectedId,budget,owned,products:products.slice(0,6).map(p=>({productId:p.productId,variantId:p.variantId}))})}).then(async res => { const data = await res.json(); captureTrace(data); if (requestId === evaluationRequestRef.current && res.ok) setEvaluation(data); }).catch(() => {}).finally(() => {if(requestId === evaluationRequestRef.current) setEvaluating(false);});
  }, [evaluationSignature,captureTrace]);

  const select = (id: string) => { visionRequestRef.current += 1; setVisionBusy(false); setSelectedId(id as DestinationId); setVision(''); };
  const searchShop = useCallback(async (query = '', cheaper = false, color = '', searchBudget = budget) => {
    const requestId = ++shopRequestRef.current;
    setShopBusy(true); setShopError('');
    try {
      const p = new URLSearchParams({ budget: String(searchBudget) });
      if (query) p.set('q', query); if (cheaper) p.set('cheaper', 'true'); if (color) p.set('color', color);
      const res = await fetch(`/api/shop?${p}`); const data = await res.json();
      if (!res.ok || data.status === 'unavailable') throw new Error(data.error || 'Shop is taking a little longer. Try again.');
      if (requestId === shopRequestRef.current) setProducts(data.products || []);
    } catch (e) { if (requestId === shopRequestRef.current) setShopError(e instanceof Error ? e.message : 'Shop could not be reached.'); }
    finally { if (requestId === shopRequestRef.current) setShopBusy(false); }
  }, [budget]);
  const openBag = () => { setTab('bag'); if (!products.length && !shopBusy) void searchShop(); };
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput(''); setBusy(true); setMessages(m => [...m, { role: 'user', text }]);
    try {
      const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, destinationId: selectedId, budget, owned, forceFallback }) });
      const data: AgentResult = await res.json();
      captureTrace(data as AgentResult & {trace?:AITrace[]});
      if (!res.ok) throw new Error((data as AgentResult & {error?:string}).error || data.reply || 'Connection interrupted. Try again.');
      if (data.selectedDestinationId) select(data.selectedDestinationId);
      if (data.budget && data.budget >= 10 && data.budget <= 5000) setBudget(data.budget);
      if (data.owned) { setOwned(data.owned); setBag(b => b.filter(p => !data.owned?.includes(p.category))); }
      setMessages(m => [...m, { role: 'assistant', text: data.reply, engine: data.engine, model: data.model, latencyMs: data.latencyMs, fallback: data.fallback }]);
      if (speak && 'speechSynthesis' in window) { const utterance = new SpeechSynthesisUtterance(data.reply); utterance.rate = 1.04; speechSynthesis.speak(utterance); }
      if (data.action === 'camera' || /really looks|see.*beach|show.*camera/i.test(text)) { setShowCamera(true); void analyzeConditions(data.selectedDestinationId ?? selectedId); }
      if (data.action === 'scan' || /scan.*gear|already have this/i.test(text)) setShowScan(true);
      if (data.action === 'gear' || data.action === 'cheaper' || /cheaper|gear|jacket|blue|bag|equipment/i.test(text)) { setTab('bag'); void searchShop(/blue/i.test(text) ? 'blue waterproof hiking jacket' : '', /cheaper/i.test(text), /blue/i.test(text) ? 'Blue' : '', data.budget ?? budget); }
    } catch (e) { setMessages(m => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'Could not connect. Please try again.', engine: 'unavailable' }]); }
    finally { setBusy(false); }
  };
  const startVoice = () => {
    type RecognitionResult = { results: { transcript: string }[][] };
    type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: RecognitionResult) => void; onerror: () => void; onend: () => void; start: () => void; stop: () => void };
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const RecognitionCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!RecognitionCtor) { notify('Voice input works in Chrome. You can also type your plan.'); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const r = new RecognitionCtor(); r.lang = 'en-US'; r.continuous = false; r.interimResults = false;
    r.onresult = e => { const text = e.results[0][0].transcript; setListening(false); void send(text); };
    r.onerror = () => { setListening(false); notify('Microphone unavailable. Type your plan below.'); }; r.onend = () => setListening(false);
    recognitionRef.current = r; r.start(); setListening(true);
  };
  const saveTrip = () => { localStorage.setItem('outside-trip', JSON.stringify({ selectedId, budget, owned, bag, savedAt: new Date().toISOString() })); setSaved(true); notify('Your coastal escape is saved on this device.'); };
  const loadTrip = () => { try { const v = JSON.parse(localStorage.getItem('outside-trip') || 'null'); if (v) { if (destinations.some(d => d.id === v.selectedId)) select(v.selectedId); setBudget(v.budget || 120); setOwned(v.owned || []); setBag(v.bag || []); setShowSaved(false); notify('Your saved escape is ready.'); } } catch { notify('Could not restore this trip.'); } };
  const addProduct = (p: Product) => { if (bag.some(item => item.id === p.id)) { setBag(b => b.filter(x => x.id !== p.id)); return; } const rest = bag.filter(x => x.category !== p.category); const newCents = rest.reduce((sum,x) => sum + x.priceAmount, 0) + p.priceAmount; if (newCents > Math.round(budget * 100)) { notify(`That puts your bag ${money(newCents / 100 - budget)} over budget. Remove an item or adjust your budget.`); return; } setBag([...rest, p]); notify('Added to your weekend bag.'); };
  const changeVariant = (p: Product, variant: ShopVariant) => { const updated = { ...p, ...variant, title: p.title, variantId: variant.id }; setProducts(items => items.map(x => x.productId === p.productId ? updated : x)); if (bag.some(x => x.productId === p.productId)) setBag(items => items.filter(x => x.productId !== p.productId)); };
  const loadOptions = async (p: Product, options = p.selectedOptions) => { setOptionBusy(p.productId); try { const params = new URLSearchParams({ productId: p.productId, category: p.category, selected: JSON.stringify(options) }); const res = await fetch(`/api/shop?${params}`); const data = await res.json(); if (!res.ok || !data.product) throw new Error(data.error || 'That combination is unavailable.'); setProducts(items => items.map(x => x.productId === p.productId ? data.product : x)); setExpandedProducts(ids => [...new Set([...ids,p.productId])]); if (options !== p.selectedOptions) setBag(items => items.filter(x => x.productId !== p.productId)); } catch(e) { notify(e instanceof Error ? e.message : 'Could not load options.'); } finally { setOptionBusy(''); } };
  const packEssentials = () => { const kit = ['shell','daypack','bottle'].filter(c => !owned.includes(c)).flatMap(c => { const candidate = products.filter(p => p.category === c && p.available === true && p.currency === 'USD' && (evaluation?.engine !== 'jev' || (evaluation.assessments.find(a => a.variantId === p.variantId)?.probability ?? 1) >= .3)).sort((a,b) => a.priceAmount-b.priceAmount)[0]; return candidate ? [candidate] : []; }); const cents = kit.reduce((sum,p) => sum+p.priceAmount, 0); if (!kit.length) { notify(owned.length === 3 ? 'Your essentials are already covered. Head outside!' : 'No confirmed kit fits this selection. Try refreshing or asking for cheaper gear.'); return; } if (cents > Math.round(budget*100)) { notify('This selection is over budget. Ask Outside to find cheaper options.'); return; } setBag(kit); notify(`${kit.length} essentials packed for ${money(cents/100)}.`); };
  const markOwned = (category: string) => { setOwned(o => [...new Set([...o, category])]); setBag(b => b.filter(p => p.category !== category)); setShowScan(false); stopCamera(); notify(`${categoryNames[category]} marked as owned. Your bag just got lighter.`); };
  const stopCamera = () => { cameraRequestRef.current += 1; stream?.getTracks().forEach(t => t.stop()); setStream(null); };
  useEffect(() => { scannerOpenRef.current = showScan; if (!showScan) { cameraRequestRef.current += 1; gearRequestRef.current += 1; setScanBusy(false); } }, [showScan]);
  useEffect(() => () => { scannerOpenRef.current = false; cameraRequestRef.current += 1; gearRequestRef.current += 1; visionRequestRef.current += 1; }, []);
  useEffect(() => { const dismiss = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; setShowScan(false); setShowCamera(false); setShowSaved(false); setShowSources(false); setShowSettings(false); setShowDebug(false); setCheckout('closed'); stream?.getTracks().forEach(t => t.stop()); setStream(null); }; document.addEventListener('keydown',dismiss); return () => document.removeEventListener('keydown',dismiss); }, [stream]);
  const openWebcam = async () => { setCameraError(''); const requestId = ++cameraRequestRef.current; try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 960 }, audio: false }); if (!scannerOpenRef.current || requestId !== cameraRequestRef.current) { s.getTracks().forEach(t => t.stop()); return; } setStream(s); setScanImage(''); } catch { if (scannerOpenRef.current) setCameraError('Camera access was unavailable. Upload a photo, or choose an item below.'); } };
  const analyzeGear = async (image: string) => {
    const requestId = ++gearRequestRef.current; setScanBusy(true); setScanDescription(''); setScanCategory(null); setScanImage(image); stopCamera();
    try { const res = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, kind: 'gear', forceFallback }) }); const d = await res.json(); captureTrace(d); if (requestId !== gearRequestRef.current || !scannerOpenRef.current) return; setScanDescription(d.description || d.error || 'Could not identify the item. Choose its category below.'); setScanCategory(d.category || null); }
    catch { if (requestId === gearRequestRef.current) setScanDescription('The image service is unavailable. You can still choose your item below.'); } finally { if (requestId === gearRequestRef.current) setScanBusy(false); }
  };
  const capture = () => { const video = videoRef.current; if (!video) return; const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d')?.drawImage(video, 0, 0); void analyzeGear(canvas.toDataURL('image/jpeg', 0.8)); };
  const upload = (file?: File) => { if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { setCameraError('Choose a JPG, PNG, or WebP smaller than 3 MB.'); return; } const reader = new FileReader(); reader.onload = () => { if (scannerOpenRef.current) void analyzeGear(String(reader.result)); }; reader.readAsDataURL(file); };
  const analyzeConditions = async (placeId = selectedId) => { const requestId = ++visionRequestRef.current; setVisionBusy(true); try { const res = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageFor(placeId), kind: 'conditions', forceFallback }) }); const data = await res.json(); captureTrace(data); if (requestId === visionRequestRef.current) setVision(data.description || data.error || 'Image analysis is unavailable.'); } catch { if (requestId === visionRequestRef.current) setVision('Image analysis could not connect. You can inspect the source image directly.'); } finally { if (requestId === visionRequestRef.current) setVisionBusy(false); } };
  const confirmCheckout = async () => { setCheckoutBusy(true); try { const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: bag.map(p => ({ productId: p.productId || p.id, variantId: p.variantId || p.variants?.[0]?.id, quantity: 1 })), budget }) }); const data = await res.json(); if (!res.ok || data.status === 'unavailable') throw new Error(data.error || data.message || 'Could not verify bag.'); setReceipt(data); setCheckout('complete'); } catch (e) { notify(e instanceof Error ? e.message : 'Checkout unavailable.'); } finally { setCheckoutBusy(false); } };

  return <main className="outside-app">
    <header className="topbar">
      <a href="/" className="brand" aria-label="Outside home"><span className="brand-sun">✳</span> outside<span className="brand-period">.</span></a>
      <nav className="top-nav"><button className={!showSaved ? 'active' : ''} onClick={() => setShowSaved(false)}>Explore</button><button className={showSaved ? 'active' : ''} onClick={() => setShowSaved(true)}>My escapes {saved && <span className="count-dot">1</span>}</button></nav>
      <div className="top-right"><span className="location"><MapPin size={14} /> California coast</span><button className="debug-toggle" aria-label="Open AI call debug view" onClick={() => setShowDebug(true)}><Code2 size={16} /><span>AI calls</span>{traces.length > 0 && <b>{traces.length}</b>}</button><button className="icon-button settings-button" aria-label="Preferences" onClick={() => setShowSettings(true)}><SlidersHorizontal size={18} /></button><button className="avatar" onClick={() => setShowSaved(true)} aria-label="Your saved escapes">YV</button></div>
    </header>
    <div className="workspace">
      <aside className="planner">
        <div className="planner-heading"><span className="eyebrow"><span className="tiny-sun">✳</span> YOUR NEXT DEEP BREATH</span><h1>Less scrolling.<br />More <span>salt air.</span></h1><p>A little coastal escape, shaped around you.<br />Let’s find your kind of outside.</p></div>
        <div className="trip-controls"><span><MapPin size={15} /> From San Francisco</span><span className="trip-control-divider" /><button onClick={() => notify('Comparing current camera imagery and the latest available forecasts.')}><Sun size={15} /> A coastal day <ChevronDown size={13} /></button></div>
        <div className="sidebar-tabs"><button className={tab === 'places' ? 'active' : ''} onClick={() => setTab('places')}><Compass size={16} /> Find my place <span>3</span></button><button className={tab === 'bag' ? 'active' : ''} onClick={openBag}><ShoppingBag size={16} /> My gear bag {bag.length > 0 && <span>{bag.length}</span>}</button></div>
        <div className="sidebar-scroll">
          {tab === 'places' ? <>
            <div className="section-label"><span>THREE WAYS TO GET AWAY</span><button className="text-icon" aria-label="Refresh conditions" onClick={async () => { setConditionsError(false); try { const r = await fetch('/api/conditions'); setConditions(await r.json()); notify('Latest source check loaded.'); } catch { setConditionsError(true); } }}><RefreshCw size={13} /></button></div>
            {destinations.map((d, i) => { const c = conditions?.destinations.find(x => x.id === d.id); return <button key={d.id} className={`destination-card ${selectedId === d.id ? 'selected' : ''}`} onClick={() => select(d.id)}>
              <div className="destination-photo"><img src={imageFor(d.id)} alt={`USGS snapshot of ${d.name}`} /><span className="destination-number">0{i + 1}</span></div>
              <div className="destination-info"><div className="destination-topline"><span>{d.area}</span>{i === 0 && <span className="match-label"><Sparkles size={10} /> EASY ESCAPE</span>}</div><h2>{d.shortName} <ArrowUpRight size={15} /></h2><p>{d.tags.slice(0, 2).join(' · ')}</p><div className="destination-weather"><span><CloudSun size={13} />{c?.weather.temperatureF != null ? `${c.weather.temperatureF}°F` : 'Forecast pending'}</span><span><Wind size={12} />{c?.weather.windMph != null ? `${c.weather.windMph} mph` : '—'}</span><span className="camera-source-dot" title="USGS source imagery"><Camera size={12} /> USGS</span></div></div>
            </button>; })}
            <div className="little-note"><Leaf size={16} /><p>Good days start with a little curiosity.<br /><strong>You don’t have to go far.</strong></p><span>↗</span></div>
          </> : <>
            <div className="bag-intro"><div><span className="eyebrow">PACK LIGHT. GO FURTHER.</span><h2>A bag for {selected.shortName}.</h2></div><button className="text-icon" aria-label="Refresh gear" onClick={() => void searchShop()}><RefreshCw size={16} /></button></div>
            <p className="bag-context">{current?.weather.windMph != null ? `${current.weather.windMph} mph winds in the forecast. ` : 'A layer for the sea breeze. '}A shell for the coast, a bag for the essentials. Only what you need.</p>
            <div className="budget-line"><label htmlFor="budget">Gear budget</label><span>$<input id="budget" type="number" min="10" max="5000" value={budget} onChange={e => setBudget(Math.min(5000, Math.max(10, Number(e.target.value))))} /></span></div>
            <button className="scan-banner" onClick={() => { setShowScan(true); setScanCategory(null); setScanDescription(''); setScanImage(''); }}><Camera size={21} /><span><strong>Already have it? Show me.</strong><small>Scan your gear. Skip the duplicates.</small></span><ArrowUpRight size={17} /></button>
            {owned.length > 0 && <div className="owned-items">{owned.map(c => <button key={c} onClick={() => setOwned(o => o.filter(x => x !== c))}><Check size={12} /> {categoryNames[c] || c} owned <X size={11} /></button>)}</div>}
            {(evaluating || evaluation) && <button className="evaluation-banner" onClick={() => setShowDebug(true)}>{evaluating ? <LoaderCircle size={13} className="spin" /> : <ShieldCheck size={14} />}<span>{evaluating ? 'Jev is checking the fit…' : evaluation?.engine === 'jev' ? 'Jev checked your gear' : 'Basic checks complete'}<small>{evaluating ? 'Matching the catalog to your coastal day.' : evaluation?.engine === 'jev' ? 'Checked against your plans and the forecast.' : 'Budget, stock, and what you own.'}</small></span><ArrowUpRight size={12} /></button>}<div className="section-label"><span>FOUND ON SHOP</span><span className="shop-wordmark">shop</span></div>
            {shopBusy && <div className="empty-state"><LoaderCircle className="spin" /><p>Finding the good stuff…</p><small>Searching real shops and available variants.</small></div>}
            {shopError && <div className="inline-error"><p>{shopError}</p><button onClick={() => void searchShop()}>Try again <RefreshCw size={12} /></button></div>}
            {!shopBusy && products.filter(p => !owned.includes(p.category || '')).map(p => <article className="product-card" key={p.id}><a href={p.url} target="_blank" rel="noreferrer" className="product-image"><img src={p.image || undefined} alt={p.title} /></a><div className="product-info"><span>{p.merchant}</span><h3>{p.title}</h3><p>{p.selectedOptions.map(o => o.label).join(' / ') || categoryNames[p.category]}</p>{expandedProducts.includes(p.productId) ? <div className="product-options">{p.options.map(option => <label key={option.name}><span>{option.name}</span><select disabled={optionBusy === p.productId} aria-label={`${option.name} for ${p.title}`} value={p.selectedOptions.find(o => o.name === option.name)?.label || ''} onChange={e => { const next = p.selectedOptions.filter(o => o.name !== option.name); next.push({name:option.name,label:e.target.value}); void loadOptions(p,next); }}>{option.values.map(v => <option key={v.label} value={v.label} disabled={v.available === false}>{v.label}{v.available === false ? ' · unavailable' : ''}</option>)}</select></label>)}</div> : <button className="choose-options" disabled={!!optionBusy} onClick={() => void loadOptions(p)}>{optionBusy === p.productId ? 'Loading options…' : 'Choose size & color'} <ChevronDown size={10} /></button>}{p.variants.length > 1 && <select aria-label={`Options for ${p.title}`} className="variant-select" value={p.variantId} onChange={e => { const v = p.variants.find(v => v.id === e.target.value); if (v) changeVariant(p, v); }}>{p.variants.map(v => <option key={v.id} value={v.id} disabled={v.available !== true}>{v.selectedOptions.map(o => o.label).join(' / ') || v.title} · {money(v.price)}{v.available !== true ? ' · unavailable' : ''}</option>)}</select>}{evaluation?.assessments.find(a=>a.variantId===p.variantId) && <div className="fit-note" title={evaluation.assessments.find(a=>a.variantId===p.variantId)?.reason}>{evaluation.assessments.find(a=>a.variantId===p.variantId)?.fit ? <Check size={10} /> : <Eye size={10} />}{evaluation.engine === 'jev' ? 'Jev' : 'Rules'} · {evaluation.assessments.find(a=>a.variantId===p.variantId)?.fit ? 'fits your day' : 'take a closer look'}</div>}<div><strong>{money(p.price)}</strong><button className={`add-product ${bag.some(x => x.id === p.id) ? 'added' : ''}`} disabled={!p.available} onClick={() => addProduct(p)} aria-label={`${bag.some(x => x.id === p.id) ? 'Remove' : 'Add'} ${p.title}`}>{bag.some(x => x.id === p.id) ? <Check size={16} /> : <Plus size={16} />}</button></div></div></article>)}
            {!shopBusy && !shopError && !products.length && <div className="empty-state"><ShoppingBag /><p>Make room for a good day.</p><button onClick={() => void searchShop()}>Find my gear</button></div>}
          </>}
        </div>
        <div className="sidebar-footer">{tab === 'bag' ? <><div className="bag-total"><span>{bag.length} essentials <small>in your bag</small></span><strong>{money(total)} <small>/ {money(budget)}</small></strong></div><button className="primary-button" disabled={shopBusy || !products.length || total > budget} onClick={() => bag.length ? setCheckout('review') : packEssentials()}>{bag.length ? 'Review my bag' : 'Pack my essentials'} <ArrowRight size={17} /></button></> : <><button className="primary-button" onClick={openBag}><Backpack size={17} /> Build my weekend bag <ArrowRight size={17} /></button><span className="footer-note">Inspired by the conditions. Made for your day.</span></>}</div>
      </aside>
      <section className="map-area" aria-label="Explore the California coast">
        <CoastalMap selectedId={selectedId} onSelect={select} cameraImages={cameraImages} resetKey={resetKey} showCameras={showCameras} />
        <div className="map-topline"><div className="map-region"><span className="live-dot" /> THE CALIFORNIA COAST <span className="region-divider">/</span> <span>36.96° N, 122.02° W</span></div><button className="map-pill" onClick={() => setShowSources(true)}><Eye size={14} /> See the sources <ArrowUpRight size={13} /></button></div>
        <div className="map-layer-controls"><button className={showCameras ? 'active' : ''} onClick={() => setShowCameras(v => !v)}><Camera size={14} /> Cameras</button><button onClick={() => setShowSources(true)}><CloudSun size={14} /> Forecasts</button></div>
        <div className="map-quote"><span>out there is<br />a good day.</span><svg width="95" height="57" viewBox="0 0 95 57" fill="none"><path d="M4 9C30 0 71 8 64 28C58 43 35 35 48 28C61 21 85 33 87 51M78 47L88 53L93 42" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></div>
        <article className="evidence-card"><div className="evidence-photo" onClick={() => setShowCamera(true)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setShowCamera(true)} aria-label={`Open ${selected.name} camera`}><img src={imageFor(selected.id)} alt={`Latest available USGS camera snapshot of ${selected.name}; timestamp is shown in the source image`} /><span className="source-badge"><span className="live-dot" /> USGS CAMERA</span><span className="expand-camera"><ArrowUpRight size={18} /></span><div className="photo-title"><span>Take a look outside.</span><h2>{selected.shortName}</h2></div></div><div className="evidence-body"><div className="evidence-metrics"><span><CloudSun size={20} /><strong>{current?.weather.temperatureF != null ? `${current.weather.temperatureF}°` : '—'}<small>{current?.weather.shortForecast || 'Checking forecast'}</small></strong></span><span><Wind size={20} /><strong>{current?.weather.windMph != null ? current.weather.windMph : '—'} <em>mph</em><small>{current?.weather.windDirection || 'Wind forecast'}</small></strong></span></div><div className="evidence-caption"><span>Source checked {time(current?.camera.checkedAt)}</span><a href={selected.camera.sourceUrl} target="_blank" rel="noreferrer">USGS <ExternalLink size={10} /></a></div></div><button className="see-reality" onClick={() => { setShowCamera(true); void analyzeConditions(); }}><Sparkles size={14} /> Tell me what you see <ArrowRight size={14} /></button></article>
        <div className="map-bottom-note"><span>✳</span> A change of scenery changes everything.</div>
        <div className="conversation-wrap">
          {messages.length > 0 && <div className="conversation" ref={messagesRef} aria-live="polite"><button className="close-conversation" aria-label="Clear conversation" onClick={() => setMessages([])}><X size={13} /></button>{messages.map((m, i) => <div key={i} className={`message ${m.role}`}><span className="message-avatar">{m.role === 'user' ? 'Y' : '✳'}</span><div><p>{m.text}</p>{m.engine && <small>{m.engine === 'local' ? 'Local planner' : m.model || m.engine}{m.latencyMs != null && ` · ${(m.latencyMs / 1000).toFixed(1)}s`}{m.fallback && ' · fallback active'}</small>}</div></div>)}{busy && <div className="message assistant"><span className="message-avatar">✳</span><div className="thinking"><span /><span /><span /><small>Looking into it…</small></div></div>}</div>}
          {messages.length === 0 && <div className="prompt-chips"><button onClick={() => void send('Plan a coastal day near San Francisco. Easy walking, good views, missing gear under $120.')}><Waves size={13} /> A coastal day under $120 <ArrowUpRight size={12} /></button><button onClick={() => void send('Show me what it really looks like at this beach.')}><Camera size={13} /> Show me the real view <ArrowUpRight size={12} /></button></div>}
          <form className={`composer ${listening ? 'listening' : ''}`} onSubmit={e => { e.preventDefault(); void send(input); }}><span className="composer-star">✳</span><input aria-label="Talk to Outside" placeholder={listening ? 'Listening… tell me your kind of day.' : 'Tell me your kind of outside…'} value={input} onChange={e => setInput(e.target.value)} disabled={busy} /><button type="button" className="voice-button" aria-label={listening ? 'Stop listening' : 'Speak your plan'} onClick={startVoice}>{listening ? <AudioLines size={19} /> : <Mic size={19} />}</button><button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="Send your plan">{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={20} />}</button></form>
          <div className="composer-caption"><span>A map you can talk to.</span><span><span className={`live-dot ${latest?.fallback ? 'orange' : ''}`} />{latest?.engine === 'local' ? 'Local planner' : latest?.fallback ? 'Fallback connected' : 'Ready when you are'}</span></div>
        </div>
        <button className="save-trip" onClick={saveTrip}><Heart size={15} fill={saved ? 'currentColor' : 'none'} /> Save this escape</button>
      </section>
    </div>
    {conditionsError && <div className="source-warning">Conditions could not be refreshed. Camera source links remain available.</div>}
    {toast && <div className="toast" role="status"><Check size={16} /> {toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={13} /></button></div>}

    {showSaved && <div className="modal-backdrop" onClick={() => setShowSaved(false)}><section role="dialog" aria-modal="true" className="modal saved-modal" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close saved escapes" onClick={() => setShowSaved(false)}><X size={20} /></button><span className="modal-symbol">♡</span><span className="eyebrow">LEAVE A LITTLE ROOM FOR THIS</span><h2>Your next good day.</h2>{saved ? <><img className="saved-photo" src={imageFor(selected.id)} alt="USGS coastal snapshot" /><h3>A California coastal escape</h3><p>Your destination, owned gear, budget, and bag are saved on this device.</p><button className="primary-button" onClick={loadTrip}>Pick up where you left off <ArrowRight size={16} /></button></> : <><p>Find a place that feels like you, then save your escape. We’ll keep it here for you.</p><button className="primary-button" onClick={() => setShowSaved(false)}>Find my outside <ArrowRight size={16} /></button></>}</section></div>}
    {showSources && <div className="modal-backdrop" onClick={() => setShowSources(false)}><section role="dialog" aria-modal="true" className="modal sources-modal" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close sources" onClick={() => setShowSources(false)}><X size={20} /></button><span className="eyebrow">A LITTLE CLARITY</span><h2>The view behind the plan.</h2><p>Fresh information, with its edges left visible.</p><div className="source-row"><Camera /><div><h3>USGS CoastCam</h3><p>Daylight snapshots, about every 30 minutes. Capture time is burned into the image; “checked” means when we reached the source.</p><a href={selected.camera.sourceUrl} target="_blank" rel="noreferrer">View original camera <ArrowUpRight size={12} /></a>{current?.camera.lastModifiedAt && <small>Source file updated {new Date(current.camera.lastModifiedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} Pacific. {current.camera.status === 'stale' && 'Source image may be stale.'}</small>}</div></div><div className="source-row"><CloudSun /><div><h3>National Weather Service</h3><p>Hourly forecasts, separate from what the camera can see. Weather can change quickly near the water.</p><a href={current?.weather.sourceUrl || 'https://www.weather.gov'} target="_blank" rel="noreferrer">View forecast source <ArrowUpRight size={12} /></a></div></div><div className="source-row"><ShoppingBag /><div><h3>Shop by Shopify</h3><p>Real catalog products, prices and variants. Stock is checked again when you review your bag. Checkout is in test mode.</p><a href="https://shop.dev/docs" target="_blank" rel="noreferrer">About the integration <ArrowUpRight size={12} /></a></div></div><p className="fine-print">Map © OpenStreetMap contributors · OpenFreeMap. Pins are approximate beach destinations. The dotted line is a coastal guide, not road directions. Check posted beach access and ocean warnings before visiting.</p></section></div>}
    {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><section role="dialog" aria-modal="true" className="modal settings-modal" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close settings" onClick={() => setShowSettings(false)}><X size={20} /></button><span className="eyebrow">UNDER THE OPEN SKY</span><h2>Make it yours.</h2><p>Choose a voice, or try a different model.</p><label className="toggle-row"><span><Volume2 size={18} /><span>Read responses aloud<small>Uses your browser’s voice.</small></span></span><input type="checkbox" checked={speak} onChange={e => setSpeak(e.target.checked)} /></label><label className="toggle-row"><span><RefreshCw size={18} /><span>Try provider fallback<small>Skip the primary model on your next request.</small></span></span><input type="checkbox" checked={forceFallback} onChange={e => setForceFallback(e.target.checked)} /></label><div className="tech-note"><span className="live-dot" /><span>{latest?.model || 'Automatic model routing'}<small>{latest?.engine || 'Gateway on Vercel · Gemini for local development'}{latest?.latencyMs && ` · ${latest.latencyMs}ms`}</small></span></div></section></div>}
    {showCamera && <div className="modal-backdrop" onClick={() => setShowCamera(false)}><section role="dialog" aria-modal="true" className="modal camera-modal" onClick={e => e.stopPropagation()}><button className="modal-close light" aria-label="Close camera" onClick={() => setShowCamera(false)}><X size={20} /></button><div className="camera-full-image"><img src={imageFor(selected.id)} alt={`USGS camera observation of ${selected.name}`} /><span className="source-badge"><span className="live-dot" /> USGS · {selected.name}</span></div><div className="camera-modal-body"><span className="eyebrow">LOOK BEFORE YOU GO</span><h2>That’s your outside.</h2><p>{selected.camera.direction}. Latest available source image. Read the capture time in the image itself.</p>{current?.camera.status === 'stale' && <p className="inline-error">This source image may be stale. Check its visible timestamp.</p>}<div className="vision-description">{visionBusy ? <><LoaderCircle className="spin" size={17} /> Taking a closer look…</> : vision || 'A real view, a better feel for your day.'}</div><div className="modal-action-row"><button className="primary-button" disabled={visionBusy} onClick={() => void analyzeConditions()}><Sparkles size={15} />{vision ? 'Take another look' : 'Tell me what you see'}</button><a href={selected.camera.sourceUrl} target="_blank" rel="noreferrer">Original source <ArrowUpRight size={13} /></a></div></div></section></div>}
    {showScan && <div className="modal-backdrop" onClick={() => { setShowScan(false); stopCamera(); }}><section role="dialog" aria-modal="true" className="modal scan-modal" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close gear scanner" onClick={() => { setShowScan(false); stopCamera(); }}><X size={20} /></button><span className="eyebrow">THE BEST GEAR? WHAT YOU OWN.</span><h2>Show it. Skip it.</h2><p>Hold up a jacket, backpack, or water bottle.<br />We’ll take it off your shopping list.</p><div className="scan-view">{stream ? <video ref={videoRef} autoPlay playsInline muted /> : scanImage ? <img src={scanImage} alt="Your uploaded gear" /> : <><Camera size={39} strokeWidth={1.2} /><span>Your next adventure is already<br />half packed.</span></>}<div className="scan-corner tl" /><div className="scan-corner tr" /><div className="scan-corner bl" /><div className="scan-corner br" /></div>{cameraError && <p className="inline-error">{cameraError}</p>}{scanBusy ? <div className="scan-result"><LoaderCircle className="spin" size={18} /> Taking a look at your gear…</div> : scanDescription && <div className="scan-result"><Sparkles size={17} /><span>{scanDescription}</span></div>}{scanCategory ? <button className="primary-button" onClick={() => markOwned(scanCategory)}><Check size={17} />I own this {categoryNames[scanCategory]?.toLowerCase()}</button> : <div className="scan-actions">{stream ? <button className="primary-button" onClick={capture}><Camera size={16} /> Capture my gear</button> : <button className="primary-button" onClick={() => void openWebcam()}><Camera size={16} /> Open camera</button>}<button className="secondary-button" disabled={scanBusy} onClick={() => fileRef.current?.click()}>Upload photo <ArrowUpRight size={14} /></button></div>}<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => upload(e.target.files?.[0])} /><div className="manual-owned"><span>Or, I already have a…</span><div>{Object.entries(categoryNames).map(([key, label]) => <button key={key} onClick={() => markOwned(key)}><Plus size={12} />{label}</button>)}</div></div><small className="fine-print">A captured photo is sent for image analysis. It is not saved to your trip.</small></section></div>}
    {checkout !== 'closed' && <div className="modal-backdrop" onClick={() => setCheckout('closed')}><section role="dialog" aria-modal="true" className="modal checkout-modal" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close checkout" onClick={() => setCheckout('closed')}><X size={20} /></button>{checkout === 'complete' ? <div className="receipt"><div className="receipt-check"><Check size={29} /></div><span className="eyebrow">HERE COMES A GOOD DAY</span><h2>Your outside is calling.</h2><p>Your bag is ready for {selected.shortName}.</p><div className="receipt-details"><span>Order</span><strong>{receipt?.orderId || receipt?.receiptId || 'OUT-' + selectedId.toUpperCase()}</strong><span>Gear total</span><strong>{money(receipt?.total ?? total)}</strong><span>Destination</span><strong>{selected.shortName}</strong></div><span className="test-note">Test order · no payment collected</span><button className="primary-button" onClick={() => { setCheckout('closed'); saveTrip(); }}>Save my escape <Heart size={16} /></button></div> : <><div className="checkout-brand"><span className="shop-wordmark">shop</span><span className="test-badge">Test mode</span></div><h2>A little gear.<br />A whole day out.</h2><p>Your weekend bag for {selected.shortName}.</p><div className="checkout-items">{bag.map(p => <div key={p.id}><img src={p.image || undefined} alt={p.title} /><span><strong>{p.title}</strong><small>{p.merchant} · Qty 1</small></span><b>{money(p.price)}</b></div>)}</div><div className="checkout-total"><span>Gear subtotal</span><strong>{money(total)}</strong></div><div className="checkout-budget"><Check size={14} /> {money(budget - total)} under your gear budget</div><p className="fine-print">Shipping and taxes are not estimated. Products may ship from separate merchants. This preview completes a test order.</p><button className="shop-pay-button" disabled={checkoutBusy || !bag.length} onClick={() => void confirmCheckout()}>{checkoutBusy ? <LoaderCircle className="spin" size={18} /> : <><span>Complete with</span><b>shop<span>Pay</span></b><ArrowRight size={17} /></>}</button><span className="checkout-secure"><ShieldCheck size={13} /> Selected variants are checked before confirmation.</span></>}</section></div>}
    <DebugDrawer open={showDebug} onClose={() => setShowDebug(false)} calls={traces} onClear={() => setTraces([])} />
  </main>;
}
