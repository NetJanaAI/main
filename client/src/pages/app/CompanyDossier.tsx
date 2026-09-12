import React, { useState, useEffect, useCallback, useId } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Newspaper,
  ShieldCheck,
  Building2,
  Users,
  ExternalLink,
  BookOpen,
  Sparkles,
  Share2,
  Calendar,
  Layers,
  MapPin,
  CheckCircle2,
  Info
} from 'lucide-react';
import EntityOrganogram from '../../components/EntityOrganogram';
import { resolveApiUrl } from '../../lib/api';

interface NewsArticle {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  isoDate: string;
  sourceName: string;
  snippet: string;
  category: 'GROWTH' | 'REGULATORY_RISK' | 'FINANCIAL' | 'LEADERSHIP' | 'GENERAL';
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
}

interface TrendDataPoint {
  date: string;
  value: number;
}

interface SearchTrendsResult {
  query: string;
  momentumScore: number;
  velocityLabel: 'SPIKING' | 'HIGH_MOMENTUM' | 'STEADY' | 'COOLING';
  changePercent: number;
  timeframe: string;
  dataPoints: TrendDataPoint[];
  relatedTopics: Array<{ title: string; type: string; mid?: string }>;
  topSearchQueries: string[];
}

interface DossierPayload {
  entity: any;
  organogram: {
    diagram: string;
    nodeCount: number;
    isTruncated: boolean;
  };
  news: {
    articles: NewsArticle[];
    total: number;
    sentimentSummary: {
      positiveCount: number;
      neutralCount: number;
      negativeCount: number;
    };
    lastUpdated: string;
  };
  trends: SearchTrendsResult;
  wikiSummary?: {
    hasWiki: boolean;
    revisionCount: number;
    lastEdited?: string;
  };
}

export const CompanyDossier: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryParam = searchParams.get('q') || '';
  const cinParam = searchParams.get('cin') || '';

  const [searchInput, setSearchInput] = useState<string>(queryParam || cinParam);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isIndexingNews, setIsIndexingNews] = useState<boolean>(false);
  const [indexSuccessMsg, setIndexSuccessMsg] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dossier, setDossier] = useState<DossierPayload | null>(null);
  const [selectedNewsCategory, setSelectedNewsCategory] = useState<string>('ALL');

  const executeDossierLoad = useCallback(
    async (queryText: string, cinHint?: string) => {
      const q = (queryText || '').trim();
      if (q.length < 3 && !cinHint) {
        setErrorMessage('Please enter at least 3 characters to search.');
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);
      setIndexSuccessMsg(null);

      // Update URL query parameters
      const nextParams = new URLSearchParams();
      if (q) nextParams.set('q', q);
      if (cinHint) nextParams.set('cin', cinHint);
      setSearchParams(nextParams);

      try {
        // 1. Resolve entity first
        const resolveRes = await fetch(resolveApiUrl('/api/v1/entities/search'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: q || cinHint,
            cinHint: cinHint || undefined,
            enableRemoteSearch: true,
          }),
        });

        const resolveData = await resolveRes.json();
        if (!resolveRes.ok) {
          throw new Error(resolveData.message || resolveData.error || 'Failed to resolve entity.');
        }

        const entity = resolveData.entity;
        const entityId = entity.entityId;

        // 2. Fetch the complete 360° dossier payload
        const dossierRes = await fetch(resolveApiUrl(`/api/v1/entities/${entityId}/dossier`));
        const dossierData = await dossierRes.json();

        if (!dossierRes.ok) {
          // Fallback if dossier endpoint has issues: synthesize from resolveData
          setDossier({
            entity,
            organogram: {
              diagram: resolveData.mermaidDiagram || '',
              nodeCount: resolveData.nodeCount || 1,
              isTruncated: resolveData.isTruncated || false,
            },
            news: {
              articles: [],
              total: 0,
              sentimentSummary: { positiveCount: 0, neutralCount: 0, negativeCount: 0 },
              lastUpdated: new Date().toISOString(),
            },
            trends: {
              query: entity.canonicalName,
              momentumScore: 50,
              velocityLabel: 'STEADY',
              changePercent: 0,
              timeframe: 'Past 30 days',
              dataPoints: [],
              relatedTopics: [],
              topSearchQueries: [],
            },
          });
        } else {
          setDossier(dossierData);
        }
      } catch (err: any) {
        console.error('[CompanyDossier] Load error:', err);
        setErrorMessage(err.message || 'Failed to compile 360° company intelligence dossier.');
      } finally {
        setIsLoading(false);
      }
    },
    [setSearchParams]
  );

  // Auto-load on mount if query in URL
  useEffect(() => {
    if (queryParam || cinParam) {
      executeDossierLoad(queryParam, cinParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeDossierLoad(searchInput);
  };

  const handleOrganogramNodeClick = (cin: string) => {
    setSearchInput(cin);
    executeDossierLoad(cin, cin);
  };

  // Sync news articles into RAG vector store
  const handleIndexNewsToRAG = async () => {
    if (!dossier?.entity?.entityId) return;
    setIsIndexingNews(true);
    setIndexSuccessMsg(null);

    try {
      const res = await fetch(
        resolveApiUrl(`/api/v1/entities/${dossier.entity.entityId}/news/index`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const data = await res.json();
      if (res.ok) {
        setIndexSuccessMsg(data.message || `Indexed ${data.indexedCount || 0} news chunks into vector database.`);
      } else {
        throw new Error(data.message || 'Failed to index news.');
      }
    } catch (e: any) {
      console.error('[CompanyDossier] Index news failed:', e);
      setErrorMessage(e.message || 'Failed to index news into RAG store.');
    } finally {
      setIsIndexingNews(false);
    }
  };

  const filteredArticles =
    dossier?.news?.articles.filter((art) => {
      if (selectedNewsCategory === 'ALL') return true;
      return art.category === selectedNewsCategory;
    }) || [];

  const trendPoints = dossier?.trends?.dataPoints || [];
  const trendMax = Math.max(...trendPoints.map((p) => p.value), 100);
  const trendMin = Math.min(...trendPoints.map((p) => p.value), 0);

  // SVG Trend Chart Path Builder
  const chartWidth = 500;
  const chartHeight = 120;
  const trendPath =
    trendPoints.length > 1
      ? trendPoints
          .map((p, idx) => {
            const x = (idx / (trendPoints.length - 1)) * chartWidth;
            const normalizedY =
              chartHeight - ((p.value - trendMin) / ((trendMax - trendMin) || 1)) * (chartHeight - 20) - 10;
            return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${normalizedY.toFixed(1)}`;
          })
          .join(' ')
      : '';

  const trendAreaPath = trendPath
    ? `${trendPath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`
    : '';

  const trendGradientId = useId();

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#020813] text-gray-200 p-6 space-y-8">
      {/* Top Header & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#00ffca]/20 to-indigo-500/20 border border-[#00ffca]/30">
              <Layers className="w-6 h-6 text-[#00ffca]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black uppercase tracking-wider text-white">
                  Company 360° Intelligence Dossier
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-[#00ffca]/10 text-[#00ffca] border border-[#00ffca]/20">
                  Collaged Intel
                </span>
              </div>
              <p className="text-xs text-white/40 font-mono mt-0.5">
                Statutory MCA &bull; Google News &bull; Search Trends &bull; Leadership &bull; Organogram Hierarchy
              </p>
            </div>
          </div>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-xl w-full">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search company by Name, CIN (21-char), or PAN..."
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#00ffca]/50 font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00ffca] text-black font-black uppercase text-xs tracking-wider hover:bg-[#00ffca]/90 transition-all disabled:opacity-40 shrink-0"
          >
            {isLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            <span>Compile Dossier</span>
          </button>
        </form>
      </div>

      {/* Preset Quick Chips */}
      {!dossier && !isLoading && (
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-white/40">
          <span className="text-white/20">Quick presets:</span>
          {['Infosys Limited', 'Tata Steel Limited', 'Reliance Industries', 'Zomato Limited', 'HDFC Bank'].map(
            (preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setSearchInput(preset);
                  executeDossierLoad(preset);
                }}
                className="px-3 py-1 rounded-md bg-white/5 border border-white/10 hover:border-[#00ffca]/40 hover:text-[#00ffca] transition-all"
              >
                {preset}
              </button>
            )
          )}
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Success Notification */}
      {indexSuccessMsg && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-[#00ffca]/10 border border-[#00ffca]/30 text-[#00ffca] text-xs font-mono">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#00ffca]" />
          <span>{indexSuccessMsg}</span>
        </div>
      )}

      {/* Main Collaged Dossier View */}
      {dossier ? (
        <div className="space-y-8">
          {/* 1. HERO BANNER: Canonical Corporate Profile */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/10 p-6 backdrop-blur-md">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-black tracking-wide text-white">
                    {dossier.entity.canonicalName}
                  </h2>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      dossier.entity.companyStatus === 'ACTIVE'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {dossier.entity.companyStatus || 'STATUS UNKNOWN'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-white/50 border border-white/10">
                    ID: {dossier.entity.entityId}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-xs font-mono text-white/60">
                  {dossier.entity.cin && (
                    <div>
                      <span className="text-white/30">CIN:</span>{' '}
                      <span className="text-white font-bold">{dossier.entity.cin}</span>
                    </div>
                  )}
                  {dossier.entity.pan && (
                    <div>
                      <span className="text-white/30">PAN:</span>{' '}
                      <span className="text-white font-bold">{dossier.entity.pan}</span>
                    </div>
                  )}
                  {dossier.entity.incorporationDate && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-white/30" />
                      <span>Inc: {dossier.entity.incorporationDate}</span>
                    </div>
                  )}
                  {dossier.entity.registeredState && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-white/30" />
                      <span>State: {dossier.entity.registeredState}</span>
                    </div>
                  )}
                </div>

                {dossier.entity.registeredAddress && (
                  <p className="text-xs text-white/40 font-mono line-clamp-1 max-w-3xl">
                    {dossier.entity.registeredAddress}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  onClick={handleIndexNewsToRAG}
                  disabled={isIndexingNews || dossier.news.articles.length === 0}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#00ffca]/40 text-xs font-mono text-white/80 hover:text-[#00ffca] transition-all disabled:opacity-40"
                  title="Auto-index latest Google News into RAG vector store for instant conversational Q&A"
                >
                  {isIndexingNews ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#00ffca]" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-[#00ffca]" />
                  )}
                  <span>Sync News to Vector DB</span>
                </button>

                <button
                  onClick={() => navigate(`/app/knowledge?q=${encodeURIComponent(dossier.entity.canonicalName)}`)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-indigo-400/40 text-xs font-mono text-white/80 hover:text-indigo-300 transition-all"
                >
                  <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Company Wiki</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. THE COLLAGE: 3-Column Intelligence Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column (5 cols): Statutory MCA & Governance Collage */}
            <div className="lg:col-span-5 space-y-6">
              {/* Financial Capitalization & Solvency Card */}
              <div className="rounded-xl bg-white/[0.02] border border-white/5 p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#00ffca]" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-white">
                      Statutory Capital & Registry
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-white/30">MCA Verified</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                    <span className="text-[10px] font-mono text-white/40 block">Paid-Up Capital</span>
                    <span className="text-sm font-bold text-white font-mono">
                      {dossier.entity.paidUpCapital
                        ? `₹${(dossier.entity.paidUpCapital / 10000000).toFixed(2)} Cr`
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                    <span className="text-[10px] font-mono text-white/40 block">Authorized Capital</span>
                    <span className="text-sm font-bold text-white font-mono">
                      {dossier.entity.authorizedCapital
                        ? `₹${(dossier.entity.authorizedCapital / 10000000).toFixed(2)} Cr`
                        : 'N/A'}
                    </span>
                  </div>
                </div>

                {dossier.entity.nicDescription && (
                  <div className="p-3 rounded-lg bg-black/20 border border-white/5 text-xs font-mono">
                    <span className="text-[10px] text-white/40 block">NIC Industry Classification</span>
                    <span className="text-white/80">{dossier.entity.nicDescription}</span>
                    {dossier.entity.nicCode && (
                      <span className="text-white/30 ml-2">({dossier.entity.nicCode})</span>
                    )}
                  </div>
                )}
              </div>

              {/* Board of Directors & Leadership Matrix */}
              <div className="rounded-xl bg-white/[0.02] border border-white/5 p-5 space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-white">
                      Board of Directors ({dossier.entity.directors?.length || 0})
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-white/30">Signatories</span>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {dossier.entity.directors && dossier.entity.directors.length > 0 ? (
                    dossier.entity.directors.map((dir: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-black/30 border border-white/5 text-xs font-mono"
                      >
                        <div>
                          <div className="text-white font-bold">{dir.name}</div>
                          <div className="text-[10px] text-white/40">
                            {dir.designation || 'Director'}{' '}
                            {dir.din && <span className="text-white/20">&bull; DIN: {dir.din}</span>}
                          </div>
                        </div>
                        {dir.appointedDate && (
                          <span className="text-[10px] text-white/30">App: {dir.appointedDate}</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-xs font-mono text-white/30">
                      No statutory directors on record.
                    </div>
                  )}
                </div>
              </div>

              {/* Secured Borrowings & Charges */}
              <div className="rounded-xl bg-white/[0.02] border border-white/5 p-5 space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-white">
                      Active Charges & Debt ({dossier.entity.charges?.length || 0})
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-white/30">Registrar Filings</span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {dossier.entity.charges && dossier.entity.charges.length > 0 ? (
                    dossier.entity.charges.map((charge: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-black/30 border border-white/5 text-xs font-mono"
                      >
                        <div>
                          <div className="text-white/80 font-bold truncate max-w-[180px]">
                            {charge.holderName}
                          </div>
                          <div className="text-[10px] text-white/40">{charge.status || 'Active'}</div>
                        </div>
                        <span className="text-[#00ffca] font-bold">
                          {charge.amount ? `₹${(charge.amount / 100000).toFixed(1)} L` : 'N/A'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-3 text-center text-xs font-mono text-white/30">
                      No open charges or secured loans registered.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column (7 cols): Google Trends + Live Google News Radar */}
            <div className="lg:col-span-7 space-y-6">
              {/* Google Search Trends & Market Momentum */}
              <div className="rounded-xl bg-white/[0.02] border border-white/5 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[#00ffca]" />
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-white">
                        Google Search Trends Radar
                      </h3>
                      <span className="text-[10px] font-mono text-white/40">
                        Past 30 Days &bull; Search Velocity Index
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider font-mono ${
                        dossier.trends.velocityLabel === 'SPIKING'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          : dossier.trends.velocityLabel === 'HIGH_MOMENTUM'
                          ? 'bg-[#00ffca]/10 text-[#00ffca] border border-[#00ffca]/30'
                          : 'bg-white/5 text-white/60 border border-white/10'
                      }`}
                    >
                      {dossier.trends.velocityLabel} ({dossier.trends.changePercent > 0 ? '+' : ''}
                      {dossier.trends.changePercent}%)
                    </span>
                    <div className="text-right">
                      <span className="text-[10px] font-mono text-white/30 block">Momentum Score</span>
                      <span className="text-sm font-bold text-white font-mono">
                        {dossier.trends.momentumScore}/100
                      </span>
                    </div>
                  </div>
                </div>

                {/* SVG Visual Sparkline */}
                {trendPoints.length > 1 && (
                  <div className="relative w-full h-32 bg-black/40 rounded-lg p-2 border border-white/5 overflow-hidden">
                    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full overflow-visible">
                      <defs>
                        <linearGradient id={trendGradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00ffca" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#00ffca" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <path d={trendAreaPath} fill={`url(#${trendGradientId})`} />
                      <path d={trendPath} fill="none" stroke="#00ffca" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    <div className="absolute bottom-2 left-3 right-3 flex justify-between text-[9px] font-mono text-white/30 pointer-events-none">
                      <span>{trendPoints[0]?.date}</span>
                      <span>{trendPoints[trendPoints.length - 1]?.date}</span>
                    </div>
                  </div>
                )}

                {/* Related Trending Search Queries */}
                {dossier.trends.topSearchQueries && dossier.trends.topSearchQueries.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">
                      Top Co-Trending Google Searches:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {dossier.trends.topSearchQueries.map((q, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded bg-white/5 border border-white/5 text-[11px] font-mono text-white/70 hover:border-[#00ffca]/30 transition-all cursor-default"
                        >
                          &bull; {q}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Live Google News Radar */}
              <div className="rounded-xl bg-white/[0.02] border border-white/5 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Newspaper className="w-4 h-4 text-[#00ffca]" />
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-white">
                        Live Google News Radar
                      </h3>
                      <span className="text-[10px] font-mono text-white/40">
                        {dossier.news.total} fresh articles &bull; Real-time Feed
                      </span>
                    </div>
                  </div>

                  {/* Category Filter Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    {['ALL', 'GROWTH', 'REGULATORY_RISK', 'FINANCIAL', 'LEADERSHIP'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedNewsCategory(cat)}
                        className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-all whitespace-nowrap ${
                          selectedNewsCategory === cat
                            ? 'bg-[#00ffca] text-black font-black'
                            : 'bg-white/5 text-white/50 hover:text-white'
                        }`}
                      >
                        {cat.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* News Article List */}
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {filteredArticles.length > 0 ? (
                    filteredArticles.map((article) => (
                      <div
                        key={article.id}
                        className="group p-3.5 rounded-xl bg-black/30 border border-white/5 hover:border-[#00ffca]/30 transition-all space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-white/10 text-white/80">
                              {article.sourceName}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider font-mono ${
                                article.sentiment === 'POSITIVE'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : article.sentiment === 'NEGATIVE'
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  : 'bg-white/5 text-white/40'
                              }`}
                            >
                              {article.category}
                            </span>
                            <span className="text-[10px] font-mono text-white/30">
                              {article.pubDate ? new Date(article.pubDate).toLocaleDateString() : ''}
                            </span>
                          </div>

                          <a
                            href={article.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded bg-white/5 text-white/40 hover:text-[#00ffca] hover:bg-white/10 transition-all"
                            title="Open original news article"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <h4 className="text-xs font-bold text-white group-hover:text-[#00ffca] transition-colors leading-snug">
                          {article.title}
                        </h4>

                        {article.snippet && (
                          <p className="text-[11px] text-white/50 font-mono line-clamp-2 leading-relaxed">
                            {article.snippet}
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center text-xs font-mono text-white/30">
                      No news articles found in &quot;{selectedNewsCategory}&quot; category.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 3. PROMINENT CORPORATE ORGANOGRAM HIERARCHY (EMBEDDED BELOW THE COLLAGE) */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-6 space-y-4 backdrop-blur-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#00ffca]/10 border border-[#00ffca]/20">
                  <Share2 className="w-5 h-5 text-[#00ffca]" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">
                    Corporate Hierarchy & Group Organogram
                  </h3>
                  <p className="text-xs text-white/40 font-mono">
                    Parent entities, subsidiaries, associates, and signatory directors &bull; Interactive Tree
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-white/40">
                <Info className="w-3.5 h-3.5 text-[#00ffca]" />
                <span>Tip: Click any subsidiary or parent node to pivot the dossier to that company</span>
              </div>
            </div>

            {/* Embedded Organogram Component */}
            <div className="w-full">
              <EntityOrganogram
                mermaidDiagram={dossier.organogram.diagram}
                entityId={dossier.entity.entityId}
                enrichmentStatus={dossier.entity.enrichmentStatus || 'COMPLETED'}
                isLoading={isLoading}
                onNodeClick={handleOrganogramNodeClick}
              />
            </div>
          </div>
        </div>
      ) : !isLoading ? (
        /* Empty Landing State */
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center rounded-2xl bg-black/20 border border-white/5 space-y-4">
          <div className="p-4 rounded-2xl bg-[#00ffca]/5 border border-[#00ffca]/20">
            <Sparkles className="w-8 h-8 text-[#00ffca]" />
          </div>
          <div className="max-w-lg space-y-2">
            <h3 className="text-base font-black uppercase tracking-wider text-white">
              Instant 360° Corporate Dossier Collage
            </h3>
            <p className="text-xs text-white/40 leading-relaxed font-mono">
              Search any company by Name, CIN (21-character MCA code), or PAN to compile a collaged dossier
              uniting statutory corporate records, real-time Google News radar, Google Search Trends momentum,
              and interactive Mermaid organograms below.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-white/30 pt-2">
            <Info className="w-3.5 h-3.5" />
            <span>Try searching: &quot;Infosys&quot;, &quot;Tata Steel&quot;, or &quot;Reliance Industries&quot;</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CompanyDossier;
