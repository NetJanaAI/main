import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Network,
  Sparkles,
  Info,
} from 'lucide-react';
import { io as socketIOClient } from 'socket.io-client';
import EntityOrganogram from '../../components/EntityOrganogram';
import EntityStatutoryCard from '../../components/EntityStatutoryCard';

interface SearchResultPayload {
  entity: any;
  mermaidDiagram: string;
  nodeCount: number;
  isTruncated: boolean;
  enrichmentStatus: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  resolvedBy: string;
  requestId: string;
  processingMs: number;
}

export const EntityIntelligence: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialCin = searchParams.get('cin') || '';

  const [queryInput, setQueryInput] = useState<string>(initialQuery || initialCin);
  const [geoState, setGeoState] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchResult, setSearchResult] = useState<SearchResultPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const executeSearch = useCallback(
    async (queryText: string, cinHint?: string) => {
      const q = (queryText || '').trim();
      if (q.length < 3 && !cinHint) {
        setErrorMessage('Please enter at least 3 characters to search.');
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      // Update URL query parameters
      const nextParams = new URLSearchParams();
      if (q) nextParams.set('q', q);
      if (cinHint) nextParams.set('cin', cinHint);
      setSearchParams(nextParams);

      try {
        const response = await fetch('/api/v1/entities/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: q || cinHint,
            cinHint: cinHint || undefined,
            geoState: geoState || undefined,
            enableRemoteSearch: true,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Entity resolution failed.');
        }

        setSearchResult(data);
      } catch (err: any) {
        console.error('[EntityIntelligence] Search error:', err);
        setErrorMessage(err.message || 'Failed to resolve corporate entity.');
      } finally {
        setIsLoading(false);
      }
    },
    [geoState, setSearchParams]
  );

  // Auto-search on page load if query or cin present in URL
  useEffect(() => {
    if (initialQuery || initialCin) {
      executeSearch(initialQuery, initialCin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for real-time WebSocket enrichment updates
  useEffect(() => {
    const socket = socketIOClient();

    socket.on('entity:enriched', (data: any) => {
      console.log('[EntityIntelligence] Real-time enrichment push received:', data);
      setSearchResult((prev) => {
        if (!prev || prev.entity.entityId !== data.entityId) return prev;
        return {
          ...prev,
          mermaidDiagram: data.mermaidDiagram || prev.mermaidDiagram,
          nodeCount: data.nodeCount ?? prev.nodeCount,
          isTruncated: data.isTruncated ?? prev.isTruncated,
          enrichmentStatus: 'COMPLETED',
          entity: {
            ...prev.entity,
            canonicalName: data.canonicalName || prev.entity.canonicalName,
            cin: data.cin || prev.entity.cin,
            companyStatus: data.companyStatus || prev.entity.companyStatus,
            enrichmentStatus: 'COMPLETED',
          },
        };
      });

      // Also trigger a background fetch to get the full updated entity object
      if (searchResult && searchResult.entity.entityId === data.entityId) {
        fetch(`/api/v1/entities/${data.entityId}/organogram`)
          .then((res) => res.json())
          .then((updated) => {
            if (updated && updated.entity) {
              setSearchResult((current) => (current ? { ...current, ...updated } : current));
            }
          })
          .catch((e) => console.warn('[EntityIntelligence] Failed background refresh:', e));
      }
    });

    socket.on('entity:enrichment_failed', (data: any) => {
      setSearchResult((prev) => {
        if (!prev || prev.entity.entityId !== data.entityId) return prev;
        return {
          ...prev,
          enrichmentStatus: 'FAILED',
          entity: {
            ...prev.entity,
            enrichmentStatus: 'FAILED',
          },
        };
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [searchResult]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(queryInput);
  };

  const handleNodeClick = (cin: string) => {
    setQueryInput(cin);
    executeSearch(cin, cin);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#020813] text-gray-200 p-6 space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#00ffca]/10 border border-[#00ffca]/20">
              <Network className="w-5 h-5 text-[#00ffca]" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-wider text-white">
                Entity Intelligence & Organogram
              </h1>
              <p className="text-xs text-white/40 font-mono">
                Hybrid Resolution &bull; MCA Registry &bull; Corporate Parent/Subsidiary Tree
              </p>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleFormSubmit} className="flex items-center gap-2 max-w-xl w-full">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search company by Name, CIN (21-char), or PAN..."
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#00ffca]/50 font-mono"
            />
          </div>

          <select
            value={geoState}
            onChange={(e) => setGeoState(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white/70 focus:outline-none font-mono"
          >
            <option value="">State (All)</option>
            <option value="MH">Maharashtra (MH)</option>
            <option value="DL">Delhi (DL)</option>
            <option value="KA">Karnataka (KA)</option>
            <option value="TN">Tamil Nadu (TN)</option>
            <option value="GJ">Gujarat (GJ)</option>
            <option value="TG">Telangana (TG)</option>
            <option value="WB">West Bengal (WB)</option>
            <option value="UP">Uttar Pradesh (UP)</option>
          </select>

          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#00ffca] text-black font-black uppercase text-xs tracking-wider hover:bg-[#00ffca]/90 transition-all disabled:opacity-40 shrink-0"
          >
            {isLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            <span>Resolve</span>
          </button>
        </form>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Results View */}
      {searchResult ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Statutory Profile Card */}
          <div className="lg:col-span-5">
            <EntityStatutoryCard entity={searchResult.entity} onSearchCin={handleNodeClick} />
          </div>

          {/* Right Column: Mermaid Organogram */}
          <div className="lg:col-span-7">
            <EntityOrganogram
              mermaidDiagram={searchResult.mermaidDiagram}
              entityId={searchResult.entity.entityId}
              enrichmentStatus={searchResult.enrichmentStatus}
              isLoading={isLoading}
              onNodeClick={handleNodeClick}
            />
          </div>
        </div>
      ) : !isLoading ? (
        /* Empty / Landing Prompt */
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center rounded-xl bg-black/20 border border-white/5 space-y-4">
          <div className="p-4 rounded-2xl bg-[#00ffca]/5 border border-[#00ffca]/20">
            <Sparkles className="w-8 h-8 text-[#00ffca]" />
          </div>
          <div className="max-w-md">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Instant Corporate Organograms
            </h3>
            <p className="text-xs text-white/40 mt-1 leading-relaxed font-mono">
              Search any Indian enterprise by Name, MCA Corporate Identity Number (CIN), or PAN to
              generate an interactive corporate hierarchy diagram with live statutory enrichment.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-white/30 pt-2">
            <Info className="w-3.5 h-3.5" />
            <span>Try searching: &quot;Tata Steel&quot;, &quot;Reliance Industries&quot;, or &quot;Infosys&quot;</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
export default EntityIntelligence;
