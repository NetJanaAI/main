import { Download, PieChart, Activity, Shield, ArrowRight, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

// Intelligence Export Node Active
const EXPORT_BACKEND_IMPLEMENTED = true;

export default function Reports() {
  const [exportStatus, setExportStatus] = useState<Record<string, 'idle' | 'loading' | 'error'>>({
    pdf: 'idle',
    csv: 'idle',
  });

  const handleExport = async (format: 'pdf' | 'csv') => {
    if (!EXPORT_BACKEND_IMPLEMENTED) return;

    setExportStatus(prev => ({ ...prev, [format]: 'loading' }));
    try {
      const res = await api.get(`/api/reports/export?format=${format}`);
      if (!res.ok) throw new Error(`Export failed: ${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `netjana-report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus(prev => ({ ...prev, [format]: 'idle' }));
    } catch (e) {
      console.error('Export failed', e);
      setExportStatus(prev => ({ ...prev, [format]: 'error' }));
    }
  };

  return (
    <div className="flex flex-col gap-12 animate-fade-in max-w-5xl">
       <header>
          <h1 className="text-3xl font-sans italic text-white tracking-widest uppercase mb-2">Alpha Reports</h1>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-[3px]">Protocol Intelligence Export Node</p>
       </header>

       {/* ADVERSARIAL: Surface the truth when the export backend isn't wired */}
       {!EXPORT_BACKEND_IMPLEMENTED && (
         <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-5 flex items-start gap-4">
           <Lock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
           <div>
             <p className="text-xs font-black uppercase tracking-widest text-amber-400 mb-1">PROTOCOL_LOCKED - Export Agent Not Implemented</p>
             <p className="text-[10px] text-amber-400/60 font-bold uppercase tracking-widest leading-relaxed">
               The <span className="font-mono">/api/reports/export</span> endpoint does not exist yet. Export buttons are disabled until the backend report generation agent is built and wired. This is not a permissions issue.
             </p>
           </div>
         </div>
       )}

       <div className="grid md:grid-cols-2 gap-8">
          <section className={`bg-white/5 border border-white/5 p-12 rounded-2xl flex flex-col justify-between backdrop-blur-3xl relative overflow-hidden group transition-all ${!EXPORT_BACKEND_IMPLEMENTED ? 'opacity-50' : 'hover:border-[#00ffca]/20'}`}>
             <div className="absolute top-0 right-0 w-64 h-64 bg-[#00ffca]/5 blur-3xl pointer-events-none -mr-32 -mt-32" />
             <div>
                <PieChart className="w-12 h-12 text-[#00ffca] mb-8" strokeWidth={1.5} />
                <h3 className="text-2xl font-bold font-sans text-white uppercase italic italic-strong mb-4">Intelligence Briefing (PDF)</h3>
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-[2px] leading-relaxed mb-8">
                   A comprehensive, institution-grade dossier containing semantic intent analysis, market friction scores, and verified lead cards for the current calendar period.
                </p>
             </div>
             <button 
               onClick={() => handleExport('pdf')}
               disabled={!EXPORT_BACKEND_IMPLEMENTED || exportStatus.pdf === 'loading'}
               title={!EXPORT_BACKEND_IMPLEMENTED ? 'Export agent not yet implemented' : ''}
               className="h-14 w-full bg-[#00ffca] text-black text-xs font-black uppercase tracking-[3px] rounded-xl flex items-center justify-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[#00ffca]/80 transition-all leading-none"
             >
                {!EXPORT_BACKEND_IMPLEMENTED
                  ? <><Lock className="w-4 h-4" /> Protocol Locked</>
                  : exportStatus.pdf === 'loading'
                  ? 'Generating Dossier...'
                  : <><Download className="w-4 h-4" /> Export PDF Portfolio</>
                }
             </button>
          </section>

          <section className={`bg-white/5 border border-white/5 p-12 rounded-2xl flex flex-col justify-between backdrop-blur-3xl relative overflow-hidden group transition-all ${!EXPORT_BACKEND_IMPLEMENTED ? 'opacity-50' : 'hover:border-emerald-500/20'}`}>
             <div>
                <Activity className="w-12 h-12 text-emerald-400 mb-8" strokeWidth={1.5} />
                <h3 className="text-2xl font-bold font-sans text-white uppercase italic italic-strong mb-4">Raw Signal Matrix (CSV)</h3>
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-[2px] leading-relaxed mb-8">
                   Structured tabular export for direct ingestion into external CRM nodes (Salesforce, HubSpot, or custom proprietary clusters).
                </p>
             </div>
             <button 
               onClick={() => handleExport('csv')}
               disabled={!EXPORT_BACKEND_IMPLEMENTED || exportStatus.csv === 'loading'}
               title={!EXPORT_BACKEND_IMPLEMENTED ? 'Export agent not yet implemented' : ''}
               className="h-14 w-full bg-white/5 border border-white/10 text-white text-xs font-black uppercase tracking-[3px] rounded-xl flex items-center justify-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-white/10 transition-all leading-none"
             >
                {!EXPORT_BACKEND_IMPLEMENTED
                  ? <><Lock className="w-4 h-4" /> Protocol Locked</>
                  : exportStatus.csv === 'loading'
                  ? 'Syncing Matrix...'
                  : <><Download className="w-4 h-4" /> Export CSV Dataset</>
                }
             </button>
          </section>
       </div>

       <div className="bg-[#00ffca]/5 border border-[#00ffca]/10 p-12 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
             <Shield className="w-6 h-6 text-[#00ffca]" />
             <h4 className="text-xs font-black uppercase tracking-widest text-[#00ffca]">Alpha Compliance Notice</h4>
          </div>
          <p className="text-[11px] text-white/40 uppercase tracking-[2px] leading-loose">
             Intelligence reports generated by NetJana.AI are strictly for authorized system operators. 
             Redistribution of sovereign Alpha signals without HMAC-verified provenance is a violation of the Protocol Access Agreement.
          </p>
          <Link to="/help" className="mt-8 text-[10px] font-black uppercase tracking-widest text-white/20 hover:text-white flex items-center gap-2 transition-colors">
             View Protocol Spec <ArrowRight className="w-3 h-3" />
          </Link>
       </div>
    </div>
  );
}
