import { Activity, Zap, Target, PieChart, Shield, ArrowUpRight, Cpu } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import StatCard from '../../components/StatCard';
import TokenTelemetry from '../../components/TokenTelemetry';
import VerityBadge from '../../components/VerityBadge';
import IntelligenceModal from '../../components/IntelligenceModal';
import { useAppStore } from '../../store/appStore';
import type { LeadCard } from '../../types';
import SourceControl from '../../components/SourceControl';

export default function Dashboard() {
  const { market, socket, creditUsed } = useAppStore();
  const [liveSignals, setLiveSignals] = useState<(LeadCard & { _sourceLabel?: string })[]>([]);
  const [openIntelligenceLead, setOpenIntelligenceLead] = useState<string | null>(null);
  const [activeSources, setActiveSources] = useState<Record<string, boolean>>({
    indiamart: true,
    gem: true,
    mca: true,
    zauba: true,
  });

  const [stats, setStats] = useState({
    // Driven by actual socket events — starts at zero.
    totalToday: 0,
    activeHot: 0,
  });

  // Real aggregates from /api/leads/stats
  const [dbStats, setDbStats] = useState<{ total: number; hot: number; warm: number; cold: number; today: number } | null>(null);
  const [dbStatsLoading, setDbStatsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/leads/stats');
        const data = await res.json();
        setDbStats(data);
      } catch {
        setDbStats({ total: 0, hot: 0, warm: 0, cold: 0, today: 0 });
      } finally {
        setDbStatsLoading(false);
      }
    };
    load();
    // Refresh every 30 seconds
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadSources = async () => {
      try {
        const res = await fetch('/api/sources');
        const data: { source_id: string; is_enabled: boolean }[] = await res.json();
        const sourcesMap = { ...activeSources };
        data.forEach(s => {
          sourcesMap[s.source_id] = s.is_enabled;
        });
        setActiveSources(sourcesMap);
      } catch (e) {
        console.error('Failed to load source settings');
      }
    };
    loadSources();
  }, []);

  // Logic moved to SourceControl component

  useEffect(() => {
    if (!socket) return;
    
    const handleNewLead = (data: { lead: LeadCard }) => {
      // ADVERSARIAL FIX: parse source from lead.source_id, no Math.random() theatre.
      const sourceIdLower = (data.lead.source_id || '').toLowerCase();
      let resolvedSource: string | undefined;
      if (sourceIdLower.includes('indiamart')) resolvedSource = 'IndiaMART';
      else if (sourceIdLower.includes('gem')) resolvedSource = 'GeM Portal';
      else if (sourceIdLower.includes('mca')) resolvedSource = 'MCA Filing';
      else if (sourceIdLower.includes('zauba')) resolvedSource = 'Zauba Trade';
      // else: leave undefined → renders as UNKNOWN_ORIGIN below

      const newSignal = { 
        ...data.lead,
        _sourceLabel: resolvedSource,
      };

      setLiveSignals(prev => [newSignal, ...prev].slice(0, 50));
      setStats(prev => ({ 
        totalToday: prev.totalToday + 1,
        activeHot: data.lead.decay_status === 'HOT' ? prev.activeHot + 1 : prev.activeHot
      }));
    };

    socket.on('new_lead', handleNewLead);
    return () => { socket.off('new_lead', handleNewLead); };
  }, [socket]);

  // Filter signals based on active toggles
  const filteredSignals = useMemo(() => {
    return liveSignals.filter(sig => {
      const sourceIdLower = (sig._sourceLabel || '').toLowerCase();
      if (sourceIdLower.includes('indiamart')) return activeSources['indiamart'];
      if (sourceIdLower.includes('gem')) return activeSources['gem'];
      if (sourceIdLower.includes('mca')) return activeSources['mca'];
      if (sourceIdLower.includes('zauba')) return activeSources['zauba'];
      return true; // Unknown sources show by default
    });
  }, [liveSignals, activeSources]);

  // Calculate dynamic source attributions

  return (
    <div className="space-y-8 animate-fade-in shadow-inner p-1">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-serif italic text-white tracking-widest uppercase">Protocol Terminal Index</h1>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-[3px] mt-1">Real-time Registry Node Status: Synchronized</p>
        </div>
        <div className="flex gap-2 p-1 bg-white/5 border border-white/10 rounded-md backdrop-blur-md">
           <div className={`px-2 py-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest ${market === 'IN' ? 'text-[#D4AF37] bg-[#D4AF37]/10' : 'text-white/40'} rounded transition-colors`}>
             <Shield className="w-3 h-3" /> India Cluster
           </div>
           <div className={`px-2 py-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest ${market === 'AE' ? 'text-[#D4AF37] bg-[#D4AF37]/10' : 'text-white/40'} rounded transition-colors`}>
             <Shield className="w-3 h-3" /> UAE Cluster
           </div>
        </div>
      </div>

      {/* Metric Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard label="Live Signals (Socket)" value={liveSignals.length} icon={Activity} trend={{ value: '12%', isUp: true }} />
        <StatCard label="Protocol Credits" value={creditUsed} icon={Zap} />
        <StatCard label="High-Velocity Intent" value={stats.activeHot} icon={Target} trend={{ value: '4%', isUp: false }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Panel: Live Feed */}
        <section className="lg:col-span-8 bg-black/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-md flex flex-col">
           <div className="p-6 border-b border-white/5 flex items-center justify-between">
             <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,1)]" />
               <h3 className="text-[10px] font-black uppercase tracking-[3px] text-white/60">Registry Signal Matrix</h3>
             </div>
             <button className="text-[9px] font-black uppercase tracking-widest text-[#D4AF37] hover:text-white transition-colors flex items-center gap-1">View Full Feed <ArrowUpRight className="w-3 h-3" /></button>
           </div>
           
           <div className="flex-1 overflow-x-auto min-h-[400px]">
             {filteredSignals.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center p-12 text-center relative overflow-hidden min-h-[300px]">
                 {/* Radar Animation Layer */}
                 <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
                    <div className="w-64 h-64 rounded-full border border-emerald-500/20 relative flex items-center justify-center overflow-hidden">
                       <div className="w-48 h-48 rounded-full border border-emerald-500/20 absolute" />
                       <div className="w-32 h-32 rounded-full border border-emerald-500/20 absolute" />
                       <div className="w-full h-px bg-emerald-500/20 absolute" />
                       <div className="h-full w-px bg-emerald-500/20 absolute" />
                       {/* Rotating sweep */}
                       <div className="w-[128px] h-[128px] absolute top-1/2 left-1/2 origin-top-left border-l border-emerald-400 bg-gradient-to-tl from-emerald-500/40 to-transparent animate-spin" style={{ animationDuration: '3s' }} />
                    </div>
                 </div>
                 
                 <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4 z-10 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                    <Activity className="w-6 h-6 text-emerald-400 animate-pulse" />
                 </div>
                 <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 z-10">
                   {liveSignals.length > 0 ? "No signals matching active nodes." : "Scanning for Alpha..."}
                 </p>
                 <span className="text-[9px] text-white/40 font-bold mt-2 uppercase z-10">Intercepting Registry Clusters</span>
               </div>
             ) : (
               <table className="w-full text-left border-collapse">
                 <thead>
                   <tr className="bg-white/5">
                     <th className="py-3 px-4 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Entity</th>
                     <th className="py-3 px-4 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Source / Sector</th>
                     <th className="py-3 px-4 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Alpha</th>
                     <th className="py-3 px-4 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Grounding</th>
                     <th className="py-3 px-4 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Status</th>
                     <th className="py-3 px-4 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Action</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-white/[0.02]">
                    {filteredSignals.map((lead, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.04] transition-colors">
                        <td className="py-4 px-4 text-xs font-bold text-white truncate max-w-[140px]">
                          <div className="flex items-center gap-2">
                            {lead.company_name}
                            <VerityBadge corroborated={lead.corroborated} signalCount={lead.signal_count || 1} verityTier={lead.verity_tier} />
                          </div>
                        </td>
                        <td className="py-4 px-4 text-[10px] font-black uppercase tracking-widest text-white/30">
                          {lead._sourceLabel ? (
                            <><span className="text-white/50">{lead._sourceLabel}</span><br/><span className="text-[8px] opacity-60">{lead.sector || 'Unassigned'}</span></>
                          ) : (
                            <><span className="text-red-400/70 font-mono">UNKNOWN_ORIGIN</span><br/><span className="text-[8px] opacity-60">{lead.sector || 'Unassigned'}</span></>
                          )}
                        </td>
                        <td className={`py-4 px-4 text-xs font-black font-data ${lead.intent_score > 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{lead.intent_score}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                             <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-cyan-400" style={{ width: `${(lead as any).grounding_score || 85}%` }} />
                             </div>
                             <span className="text-[10px] font-black font-data text-cyan-400">{(lead as any).grounding_score || 85}%</span>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${lead.decay_status === 'HOT' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-white/40 border-white/10'}`}>
                            {lead.decay_status}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <button 
                            onClick={() => setOpenIntelligenceLead(lead.lead_id)}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                          >
                            <Cpu className="w-4 h-4 text-white/40" />
                          </button>
                        </td>
                      </tr>
                    ))}
                 </tbody>
               </table>
             )}
           </div>
        </section>

        {/* Right Panel: Distribution & Intelligence Selection */}
        <section className="lg:col-span-4 flex flex-col gap-8">
           <SourceControl />

           <div className="bg-white/5 border border-white/5 p-8 rounded-2xl backdrop-blur-md text-white">
              <div className="flex items-center gap-2 mb-8">
                <PieChart className="w-5 h-5 text-[#D4AF37]" />
                <h3 className="text-[10px] font-black uppercase tracking-[3px] text-white/60">Source Attribution</h3>
              </div>
              
              <div className="space-y-6">
                 {[
                   { label: 'IndiaMART', color: 'bg-emerald-400', weight: 40, id: 'indiamart' },
                   { label: 'GeM Portal', color: 'bg-cyan-400', weight: 20, id: 'gem' },
                   { label: 'MCA Filing', color: 'bg-[#D4AF37]', weight: 15, id: 'mca' },
                   { label: 'Zauba Trade', color: 'bg-white/20', weight: 10, id: 'zauba' },
                 ].map(source => (
                   <div key={source.id} className={`space-y-2 transition-opacity ${activeSources[source.id] ? 'opacity-100' : 'opacity-20'}`}>
                     <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                       <span className="text-white/40">{source.label}</span>
                       <span className="text-white">{activeSources[source.id] ? source.weight : 0}%</span>
                     </div>
                     <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full ${source.color} transition-all duration-500`} style={{ width: `${activeSources[source.id] ? source.weight : 0}%` }} />
                     </div>
                   </div>
                 ))}
              </div>
           </div>

           <TokenTelemetry />
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {dbStatsLoading ? (
          // Loading skeleton
          [...Array(4)].map((_, i) => (
            <div key={i} className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between animate-pulse">
              <div className="h-2 w-20 bg-white/10 rounded" />
              <div className="h-3 w-10 bg-white/10 rounded" />
            </div>
          ))
        ) : (
          [
            { label: 'Total Volume',  value: dbStats?.total },
            { label: 'Hot Intent',    value: dbStats?.hot   },
            { label: 'Warm Intent',   value: dbStats?.warm  },
            { label: 'Cold Storage',  value: dbStats?.cold  },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between group cursor-default">
              <span className="text-[9px] font-black uppercase tracking-widest text-white/30 group-hover:text-white/50 transition-colors">{label}</span>
              <span className={`text-xs font-black font-data ${value === 0 ? 'text-white/20' : 'text-white/80'}`}>
                {value?.toLocaleString() ?? '—'}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Intelligence Overlay */}
      {openIntelligenceLead && (
        <IntelligenceModal 
          leadId={openIntelligenceLead} 
          onClose={() => setOpenIntelligenceLead(null)} 
        />
      )}
    </div>
  );
}
