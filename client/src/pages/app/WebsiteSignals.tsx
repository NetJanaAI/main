import { useCallback, useEffect, useState } from 'react';
import { Globe, CheckCircle, AlertTriangle, Search } from 'lucide-react';
import { api } from '../../lib/api';

interface CatalogSignal {
    key: string;
    label: string;
    description: string;
    confirmed: boolean;
    companies_observed: number;
}

interface CollectResult {
    domain: string;
    ok: boolean;
    signals?: number;
    reason?: string;
}

type Stance = 'any' | 'have' | 'not';
type Notice = { type: 'success' | 'error'; message: string };

const MAX_DOMAINS = 10;

async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = await res.json();
        return typeof body?.error === 'string' ? body.error : fallback;
    } catch {
        return fallback;
    }
}

export default function WebsiteSignals() {
    const [signals, setSignals] = useState<CatalogSignal[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<Notice | null>(null);

    const [domainsText, setDomainsText] = useState('');
    const [collecting, setCollecting] = useState(false);
    const [results, setResults] = useState<CollectResult[]>([]);

    const [stances, setStances] = useState<Record<string, Stance>>({});
    const [cohort, setCohort] = useState<{ count: number; domains: string[] } | null>(null);

    const loadCatalog = useCallback(async () => {
        try {
            const res = await api.get('/api/website-signals/catalog');
            if (!res.ok) throw new Error(await errorMessage(res, 'Could not load signals'));
            const data = await res.json();
            const list: CatalogSignal[] = data.signals || [];
            setSignals(list);
            setSelected(new Set(list.filter((s) => s.confirmed).map((s) => s.key)));
        } catch (e) {
            setNotice({ type: 'error', message: e instanceof Error ? e.message : 'Could not load signals' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadCatalog();
    }, [loadCatalog]);

    const toggle = (key: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const saveConfirmed = async () => {
        setNotice(null);
        const res = await api.put('/api/website-signals/confirmed', { signals: [...selected] });
        if (res.ok) {
            setNotice({ type: 'success', message: 'Signals saved. Only these will be collected.' });
            await loadCatalog();
        } else {
            setNotice({ type: 'error', message: await errorMessage(res, 'Could not save signals') });
        }
    };

    const collect = async () => {
        const domains = domainsText.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean);
        if (domains.length === 0) return;
        if (domains.length > MAX_DOMAINS) {
            setNotice({ type: 'error', message: `Collect up to ${MAX_DOMAINS} domains at a time.` });
            return;
        }
        setNotice(null);
        setCollecting(true);
        try {
            const res = await api.post('/api/website-signals/collect', { targets: domains.map((domain) => ({ domain })) });
            if (!res.ok) {
                setNotice({ type: 'error', message: await errorMessage(res, 'Collection failed') });
                return;
            }
            const data = await res.json();
            const rejected: CollectResult[] = (data.rejected || []).map((r: { input: string; reason: string }) => ({ domain: r.input, ok: false, reason: r.reason }));
            setResults([...(data.results || []), ...rejected]);
            await loadCatalog();
        } finally {
            setCollecting(false);
        }
    };

    const runCohort = async () => {
        setNotice(null);
        const confirmedKeys = new Set(signals.filter((s) => s.confirmed).map((s) => s.key));
        const chosen = Object.entries(stances).filter(([k]) => confirmedKeys.has(k));
        const mustHave = chosen.filter(([, v]) => v === 'have').map(([k]) => k);
        const mustNot = chosen.filter(([, v]) => v === 'not').map(([k]) => k);
        const res = await api.post('/api/website-signals/cohort', { must_have: mustHave, must_not_have: mustNot });
        if (res.ok) {
            setCohort(await res.json());
        } else {
            setCohort(null);
            setNotice({ type: 'error', message: await errorMessage(res, 'Cohort lookup failed') });
        }
    };

    const confirmedSignals = signals.filter((s) => s.confirmed);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header>
                <div className="flex items-center gap-3 mb-2">
                    <Globe className="w-6 h-6 text-[#00ffca]" />
                    <h1 className="text-2xl font-black uppercase tracking-widest text-[#00ffca]">Website Signals</h1>
                </div>
                <p className="text-xs uppercase tracking-widest text-white/40">
                    Facts read from each company's own public website. Only the signals you confirm are collected.
                </p>
            </header>

            {notice && (
                <div className={`flex items-center gap-2 p-3 rounded-lg border text-xs ${notice.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
                    {notice.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {notice.message}
                </div>
            )}

            <section className="p-6 rounded-xl border border-white/5 bg-white/[0.02]">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">1. Confirm signals</h2>
                {loading ? (
                    <p className="text-xs text-white/40">Loading...</p>
                ) : (
                    <div className="space-y-3">
                        {signals.map((s) => (
                            <label key={s.key} className="flex items-start gap-3 cursor-pointer">
                                <input type="checkbox" className="mt-1" checked={selected.has(s.key)} onChange={() => toggle(s.key)} />
                                <span className="flex-1">
                                    <span className="block text-sm text-white">{s.label}</span>
                                    <span className="block text-xs text-white/40">{s.description}</span>
                                </span>
                                <span className="text-[10px] uppercase tracking-widest text-white/30">{s.companies_observed} observed</span>
                            </label>
                        ))}
                        <button onClick={saveConfirmed} className="mt-2 px-4 py-2 rounded-lg bg-[#00ffca] text-black text-[10px] font-black uppercase tracking-widest">
                            Save confirmed signals
                        </button>
                    </div>
                )}
            </section>

            <section className="p-6 rounded-xl border border-white/5 bg-white/[0.02]">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">2. Collect from websites</h2>
                <textarea
                    value={domainsText}
                    onChange={(e) => setDomainsText(e.target.value)}
                    placeholder={`One domain per line, up to ${MAX_DOMAINS}`}
                    rows={4}
                    className="w-full p-3 rounded-lg bg-black/40 border border-white/10 text-sm text-white"
                />
                <button
                    onClick={collect}
                    disabled={collecting || confirmedSignals.length === 0}
                    className="mt-3 px-4 py-2 rounded-lg bg-[#00ffca] text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                >
                    {collecting ? 'Reading websites...' : 'Collect'}
                </button>
                {confirmedSignals.length === 0 && <p className="mt-2 text-xs text-white/40">Confirm at least one signal first.</p>}
                {results.length > 0 && (
                    <ul className="mt-4 space-y-1 text-xs">
                        {results.map((r) => (
                            <li key={r.domain} className={r.ok ? 'text-emerald-300' : 'text-red-300'}>
                                {r.domain}: {r.ok ? `${r.signals} signals recorded` : r.reason}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="p-6 rounded-xl border border-white/5 bg-white/[0.02]">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">3. Find a cohort</h2>
                {confirmedSignals.length === 0 ? (
                    <p className="text-xs text-white/40">Confirm signals to build a cohort.</p>
                ) : (
                    <div className="space-y-3">
                        {confirmedSignals.map((s) => (
                            <div key={s.key} className="flex items-center justify-between gap-4">
                                <span className="text-sm text-white">{s.label}</span>
                                <select
                                    value={stances[s.key] || 'any'}
                                    onChange={(e) => setStances((prev) => ({ ...prev, [s.key]: e.target.value as Stance }))}
                                    className="bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-xs text-white"
                                >
                                    <option value="any">Any</option>
                                    <option value="have">Has it</option>
                                    <option value="not">Does not have it</option>
                                </select>
                            </div>
                        ))}
                        <button onClick={runCohort} className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ffca] text-black text-[10px] font-black uppercase tracking-widest">
                            <Search className="w-3 h-3" /> Count companies
                        </button>
                    </div>
                )}
                {cohort && (
                    <div className="mt-4">
                        <p className="text-2xl font-sans italic text-white">{cohort.count.toLocaleString()} companies</p>
                        {cohort.domains.length > 0 && (
                            <p className="mt-2 text-xs text-white/50 break-words">{cohort.domains.join(', ')}</p>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
