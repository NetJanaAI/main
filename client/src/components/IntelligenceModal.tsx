import { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Zap, 
  Target, 
  Flame, 
  Search, 
  Cpu, 
  CheckCircle2,
  AlertCircle,
  Link2,
  X
} from 'lucide-react';

interface IntelligenceModalProps {
  leadId: string;
  onClose: () => void;
}

export default function IntelligenceModal({ leadId, onClose }: IntelligenceModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchIntelligence = async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/intelligence`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        console.error('Failed to load intelligence node');
      } finally {
        setLoading(false);
      }
    };
    fetchIntelligence();
  }, [leadId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[600px] h-[400px] bg-[#0F0F0B] border border-white/10 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const critic = data.critic_analysis || {};
  const isVerified = critic.isValid || data.corroborated;
  const groundingScore = Math.round((data.grounding_score || 0.85) * 100);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-4xl bg-[#0A0A0A] border border-white/10 rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col max-h-[90vh]">
        
        {/* Header: Identity & Verity Status */}
        <div className="p-8 border-b border-white/5 flex items-start justify-between bg-gradient-to-br from-white/[0.02] to-transparent">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-black tracking-tighter text-white">{data.company_name}</h2>
              <div className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${
                isVerified ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              }`}>
                {isVerified ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                {isVerified ? 'Cluster Verified' : 'Unconfirmed Signal'}
              </div>
            </div>
            <p className="text-white/40 font-medium text-sm font-data">{data.geo_state} · {data.sector || 'General Industry'} · {data.procurement_category}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/20 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
          
          {/* Top Row: Strategic Metrics */}
          <div className="grid grid-cols-3 gap-6">
            <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                <span>Grounding Score</span>
                <Cpu className="w-3 h-3" />
              </div>
              <div className="relative pt-2">
                <div className="text-4xl font-black text-white">{groundingScore}%</div>
                <div className="h-1.5 w-full bg-white/5 rounded-full mt-3 overflow-hidden">
                  <div className="h-full bg-emerald-400 transition-all duration-1000" style={{ width: `${groundingScore}%` }} />
                </div>
                <p className="text-[9px] text-white/20 mt-2 font-bold uppercase tracking-tight leading-relaxed">
                  Fact-check density across {data.signal_count || 1} independent registries.
                </p>
              </div>
            </div>

            <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                <span>Engagement Alpha</span>
                <Target className="w-3 h-3" />
              </div>
              <div className="text-4xl font-black text-white">{(data.intent_score || 0)}</div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">{data.buying_stage || 'DISCOVERY'} STAGE</span>
              </div>
            </div>

            <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                <span>Signal Decay</span>
                <Flame className="w-3 h-3" />
              </div>
              <div className="text-4xl font-black text-white">{Math.round(data.decay_score || 0)}%</div>
              <p className="text-[9px] text-white/20 font-bold uppercase tracking-tight leading-relaxed">
                Intent window closing based on T+{Math.round((new Date().getTime() - new Date(data.created_at).getTime()) / (1000 * 3600 * 24))} day decay.
              </p>
            </div>
          </div>

          {/* Adversarial Consensus: The "Why Now" Audit */}
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center">
                  <Zap className="w-3 h-3 text-emerald-400" />
                </div>
                <h3 className="text-[11px] font-black uppercase tracking-[3px] text-white/60">Advocate Proposal</h3>
              </div>
              
              <div className="p-8 bg-emerald-500/[0.02] border border-emerald-500/10 rounded-3xl space-y-6 h-full">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400/60 mb-2">The Opportunity</h4>
                  <p className="text-lg font-medium leading-relaxed text-white">
                    {data.card_why_now}
                  </p>
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400/60 mb-2">Requirement Analysis</h4>
                  <p className="text-sm font-data text-white/60 leading-relaxed">
                    {data.card_what_they_need}
                  </p>
                </div>

                {/* Synthesis Pain Points */}
                {data.critic_analysis?.painPoints?.strategicAlpha && (
                  <div className="pt-4 border-t border-white/5">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400/60 mb-3">Alpha Signals</h4>
                    <div className="flex flex-wrap gap-2">
                      {data.critic_analysis.painPoints.strategicAlpha.map((s: string, i: number) => (
                        <div key={i} className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-black uppercase text-emerald-400">
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Engagement Strategy</span>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl border border-white/5 text-[11px] font-medium leading-relaxed text-white/80 italic">
                    "{data.card_do_this}"
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-amber-500/10 flex items-center justify-center">
                  <Search className="w-3 h-3 text-amber-400" />
                </div>
                <h3 className="text-[11px] font-black uppercase tracking-[3px] text-white/60">Critic Audit</h3>
              </div>

              <div className="p-8 bg-amber-500/[0.02] border border-amber-500/10 rounded-3xl space-y-6 h-full">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-400/60 mb-3">Identified Risks & Friction</h4>
                  <div className="space-y-3">
                    {critic.challenges?.length > 0 ? critic.challenges.map((challenge: string, i: number) => (
                      <div key={i} className="flex gap-3 items-start">
                        <AlertCircle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] leading-relaxed text-white/60 font-medium">
                          {challenge}
                        </p>
                      </div>
                    )) : (
                      <div className="flex gap-3 items-start">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] leading-relaxed text-white/60 font-medium italic">
                          No significant contradictions detected in current registry signals.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5">
                   <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-400/60 mb-3">Audited Logic Chain</h4>
                   <div className="space-y-2">
                      {critic.verity_steps?.map((step: string, i: number) => (
                        <div key={i} className="flex items-center gap-3 text-[10px] text-white/40">
                           <div className="w-1 h-1 rounded-full bg-white/20" />
                           {step}
                        </div>
                      ))}
                   </div>
                </div>

                <div className="pt-4 border-t border-white/5">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-400/60 mb-3">Registry Evidence</h4>
                  <div className="flex flex-wrap gap-2">
                    {data.triangulated_sources?.map((s: string) => (
                      <div key={s} className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[9px] font-black uppercase tracking-widest text-white/40">
                        {s}
                      </div>
                    )) || (
                      <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[9px] font-black uppercase tracking-widest text-white/40">
                        {data.source_id}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Citations */}
          {data.citations?.length > 0 && (
            <div className="pt-4 border-t border-white/5">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-400/60 mb-3">Source Citations</h4>
              <div className="space-y-2">
                  {data.citations.map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 group cursor-pointer">
                      <Link2 className="w-3 h-3 text-white/20 group-hover:text-emerald-400 transition-colors" />
                      <span className="text-[10px] text-white/30 group-hover:text-white transition-colors truncate">{c.url || c.source || 'Verified Document'}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

        </div>

        {/* Action Bar */}
        <div className="p-6 border-t border-white/5 bg-black flex items-center justify-between">
          <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-white/20">
             <span>Verity Tier: {data.verity_tier || 'UNSCORED'}</span>
             <span>·</span>
             <span>Captured: {new Date(data.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex gap-4">
             <button onClick={onClose} className="px-6 py-2 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/40 hover:bg-white/5 transition-all">
               Close Analysis
             </button>
             <button className="px-8 py-2 rounded-full bg-emerald-500 text-black text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
               Deploy Outreach
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}
