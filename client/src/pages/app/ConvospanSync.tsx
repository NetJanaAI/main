import { 
  Activity, 
  Send, 
  Settings, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  RefreshCw,
  Clock,
  LayoutGrid,
  Target,
  FlaskConical,
  ExternalLink
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../lib/api';

interface CovospanConfig {
  endpoint_url: string;
  api_key_masked: string;
  has_hmac: boolean;
  campaign_id: string;
  is_active: boolean;
}

interface PushLogEntry {
  id: string;
  lead_id: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  detail: string;
  triggered_by: 'auto' | 'manual';
  attempts: number;
  campaign_id: string;
  pushed_at: string;
  company_name: string;
  intent_score: number;
  source_id: string;
  sector: string;
  buying_stage: string;
}

interface CovospanStats {
  totals: {
    total_pushes: string;
    success: string;
    failed: string;
    skipped: string;
    today: string;
    success_rate_pct: string;
  };
  by_campaign: { campaign_id: string; count: string; success: string }[];
  by_source: { source_id: string; pushed: string }[];
  by_buying_stage: { buying_stage: string; pushed: string }[];
  recent_failures: { lead_id: string; detail: string; pushed_at: string; attempts: number }[];
}

export default function ConvospanSync() {
  const {} = useAppStore();
  
  // Config state
  const [config, setConfig] = useState<CovospanConfig | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    endpoint_url: '',
    api_key: '',
    hmac_secret: '',
    campaign_id: ''
  });
  
  // Stats & Log state
  const [stats, setStats] = useState<CovospanStats | null>(null);
  const [logs, setLogs] = useState<PushLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ ok: boolean; status?: number; error?: string; latency_ms?: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [configRes, statsRes, logRes] = await Promise.all([
        api.get('/api/covospan/config'),
        api.get('/api/covospan/stats'),
        api.get('/api/covospan/log?limit=15')
      ]);
      
      const configData = await configRes.json();
      const statsData = await statsRes.json();
      const logData = await logRes.json();
      
      if (configData.config) {
        setConfig(configData.config);
        if (!isEditing) {
          setFormData(prev => ({
            ...prev,
            endpoint_url: configData.config.endpoint_url || '',
            campaign_id: configData.config.campaign_id || ''
          }));
        }
      }
      setStats(statsData);
      setLogs(logData.log || []);
    } catch (e) {
      console.error('Fetch Covospan data failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/api/covospan/config', formData);
      if (res.ok) {
        setIsEditing(false);
        setFormData(prev => ({ ...prev, api_key: '', hmac_secret: '' })); // Clear sensitive fields
        fetchData();
      }
    } catch (e) {
      console.error('Save config failed', e);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/api/covospan/test', {});
      const data = await res.json();
      setTestResult(data);
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleManualPush = async (leadId: string) => {
    try {
      await api.post(`/api/covospan/push/${leadId}`, {});
      fetchData(); // Refresh logs
    } catch (e) {
      console.error('Manual push failed', e);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SUCCESS': return 'text-emerald-400';
      case 'FAILED': return 'text-red-400';
      case 'SKIPPED': return 'text-white/20';
      default: return 'text-white/40';
    }
  };

  if (loading && !config && !stats) {
    return <div className="flex items-center justify-center h-64 animate-pulse text-[#00ffca] font-black uppercase tracking-widest text-xs">Initializing Protocol Node...</div>;
  }

  return (
    <div className="space-y-10 animate-fade-in pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-3xl font-sans italic text-white tracking-widest uppercase">Sync Node: ConvoSpan</h1>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-[3px] mt-1">Cross-Platform Intelligence Pipeline</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleTestConnection}
            disabled={testing || !config?.is_active}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
          >
            {testing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3 text-[#00ffca]" />}
            Test Connectivity
          </button>
          {!isEditing && (
            <button 
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#00ffca]/10 border border-[#00ffca]/20 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#00ffca] hover:bg-[#00ffca]/20 transition-all"
            >
              <Settings className="w-3 h-3" />
              Configure Node
            </button>
          )}
        </div>
      </div>

      {/* Connectivity Status Banner */}
      {testResult && (
        <div className={`p-4 rounded-xl border flex items-center justify-between animate-slide-in-top ${testResult.ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          <div className="flex items-center gap-3">
            {testResult.ok ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest">{testResult.ok ? 'PROTOCOL_SYNC_ACTIVE' : 'PROTOCOL_SYNC_FAILURE'}</p>
              <p className="text-xs font-sans italic opacity-80">{testResult.ok ? `Latency: ${testResult.latency_ms}ms · Standing by for telemetry.` : `Error: ${testResult.error || `HTTP ${testResult.status}`}`}</p>
            </div>
          </div>
          <button onClick={() => setTestResult(null)} className="text-white/20 hover:text-white"><XCircle className="w-4 h-4" /></button>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid lg:grid-cols-12 gap-8">
        
        {/* Left Column: Config & Statistics */}
        <div className="lg:col-span-4 space-y-8">
          
          {/* Configuration Card */}
          <section className="bg-white/5 border border-white/5 rounded-2xl p-6 backdrop-blur-xl">
             <div className="flex items-center gap-3 mb-6">
                <Settings className="w-4 h-4 text-[#00ffca]" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40">Node Provisioning</h3>
             </div>

             {isEditing ? (
               <form onSubmit={handleSaveConfig} className="space-y-4">
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/20 block mb-1.5 ml-1">Endpoint URL</label>
                    <input 
                      type="url" 
                      required
                      value={formData.endpoint_url}
                      onChange={e => setFormData({...formData, endpoint_url: e.target.value})}
                      placeholder="https://app.convospan.com/api/webhooks/netjana"
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00ffca]/50"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/20 block mb-1.5 ml-1">API Cluster Key</label>
                    <input 
                      type="password" 
                      required={!config}
                      value={formData.api_key}
                      onChange={e => setFormData({...formData, api_key: e.target.value})}
                      placeholder={config ? "••••••••••••••••" : "Enter ConvoSpan API Key"}
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00ffca]/50"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/20 block mb-1.5 ml-1">HMAC Verification Secret</label>
                    <input 
                      type="password" 
                      value={formData.hmac_secret}
                      onChange={e => setFormData({...formData, hmac_secret: e.target.value})}
                      placeholder="Optional Secret Signing Key"
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00ffca]/50"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/20 block mb-1.5 ml-1">Target Campaign ID</label>
                    <input 
                      type="text" 
                      value={formData.campaign_id}
                      onChange={e => setFormData({...formData, campaign_id: e.target.value})}
                      placeholder="Optional Routing ID"
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-[#00ffca]/50"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button 
                      type="submit"
                      disabled={saving}
                      className="flex-1 bg-[#00ffca] text-black text-[10px] font-black uppercase tracking-widest py-2 rounded-lg hover:bg-[#00ffca]/80 disabled:opacity-50"
                    >
                      {saving ? 'UPDATING...' : 'SAVE CONFIG'}
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-4 bg-white/5 border border-white/10 text-white/40 text-[10px] font-black uppercase tracking-widest py-2 rounded-lg hover:text-white"
                    >
                      CANCEL
                    </button>
                  </div>
               </form>
             ) : config ? (
               <div className="space-y-4">
                  <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                    <div className="flex justify-between items-start mb-4">
                       <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${config.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                         {config.is_active ? 'ACTIVE' : 'DISABLED'}
                       </span>
                       <span className="text-[9px] font-black text-[#00ffca] uppercase tracking-widest">Protocol 2.0</span>
                    </div>
                    <div className="space-y-3">
                       <div>
                         <p className="text-[8px] font-black uppercase tracking-widest text-white/20 mb-1">Target Cluster</p>
                         <p className="text-[10px] text-white/80 font-mono truncate">{config.endpoint_url}</p>
                       </div>
                       <div className="flex gap-6">
                         <div>
                            <p className="text-[8px] font-black uppercase tracking-widest text-white/20 mb-1">HMAC Protection</p>
                            <p className="text-[10px] text-white/80 font-bold uppercase">{config.has_hmac ? 'ENABLED' : 'DISABLED'}</p>
                         </div>
                         <div>
                            <p className="text-[8px] font-black uppercase tracking-widest text-white/20 mb-1">Campaign ID</p>
                            <p className="text-[10px] text-white/80 font-bold uppercase">{config.campaign_id || 'GLOBAL_INGEST'}</p>
                         </div>
                       </div>
                    </div>
                  </div>
                  <div className="text-[9px] text-white/30 leading-relaxed uppercase font-bold tracking-widest">
                    Automatically routing all verified intent signals to the ConvoSpan terminal for campaign orchestration.
                  </div>
               </div>
             ) : (
               <div className="bg-[#00ffca]/5 border border-[#00ffca]/20 p-6 rounded-xl text-center">
                  <AlertCircle className="w-10 h-10 text-[#00ffca]/30 mx-auto mb-4" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#00ffca] mb-2">Sync Node Not Configured</p>
                  <p className="text-[9px] text-white/40 uppercase font-bold leading-relaxed mb-6">Connect your ConvoSpan endpoint to start pushing intelligence signals live.</p>
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="w-full bg-[#00ffca] text-black text-[10px] font-black uppercase tracking-widest py-2 rounded-lg hover:bg-[#00ffca]/80"
                  >
                    Configure Now
                  </button>
               </div>
             )}
          </section>

          {/* Quick Metrics */}
          <section className="bg-white/5 border border-white/5 rounded-2xl p-6 backdrop-blur-xl">
             <div className="flex items-center gap-3 mb-6">
                <Target className="w-4 h-4 text-[#00ffca]" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40">Sync Efficiency</h3>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                   <p className="text-[8px] font-black uppercase tracking-widest text-white/20 mb-1">Success Rate</p>
                   <p className="text-2xl font-sans italic text-white">{stats?.totals?.success_rate_pct || '0'}%</p>
                </div>
                <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                   <p className="text-[8px] font-black uppercase tracking-widest text-white/20 mb-1">Signals Today</p>
                   <p className="text-2xl font-sans italic text-white">{stats?.totals?.today || '0'}</p>
                </div>
             </div>

             <div className="mt-8 space-y-4">
                <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                   <span className="text-white/20">Total Pushed</span>
                   <span className="text-white/80">{stats?.totals?.total_pushes || '0'}</span>
                </div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                   <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${stats?.totals?.success_rate_pct || 0}%` }} />
                </div>
                <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest text-white/20 px-1">
                   <span>Failures: {stats?.totals?.failed || '0'}</span>
                   <span>Skipped: {stats?.totals?.skipped || '0'}</span>
                </div>
             </div>
          </section>

          {/* Campaign Overview */}
          <section className="bg-white/5 border border-white/5 rounded-2xl p-6 backdrop-blur-xl">
             <div className="flex items-center gap-3 mb-6">
                <LayoutGrid className="w-4 h-4 text-[#00ffca]" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40">Campaign Allocation</h3>
             </div>

             <div className="space-y-4">
                {stats?.by_campaign.length ? stats.by_campaign.map(camp => (
                  <div key={camp.campaign_id} className="bg-black/20 p-3 rounded-lg flex items-center justify-between group hover:border-[#00ffca]/30 border border-transparent transition-all">
                     <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-[#00ffca]/40 group-hover:bg-[#00ffca] transition-all" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/60">{camp.campaign_id}</span>
                     </div>
                     <span className="text-[10px] font-data text-white/40">{camp.count} SIGNALS</span>
                  </div>
                )) : (
                  <p className="text-[10px] text-white/20 font-black uppercase tracking-widest text-center py-4 italic">No campaigns detected</p>
                )}
             </div>
          </section>
        </div>

        {/* Right Column: Signal Telemetry (Live Log) */}
        <div className="lg:col-span-8 space-y-8">
           <section className="bg-black/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl flex flex-col min-h-[600px]">
              <div className="p-6 border-b border-white/5 flex justify-between items-center">
                 <div className="flex items-center gap-3">
                    <Send className="w-4 h-4 text-[#00ffca]" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40">Signal Push Telemetry</h3>
                 </div>
                 <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500/60">Live Logic Stream</span>
                 </div>
              </div>

              <div className="flex-1 overflow-x-auto">
                 <table className="w-full text-left border-collapse">
                    <thead>
                       <tr className="bg-white/[0.02] border-b border-white/10">
                          <th className="py-4 px-6 text-[9px] font-black uppercase tracking-widest text-white/20">Timestamp</th>
                          <th className="py-4 px-6 text-[9px] font-black uppercase tracking-widest text-[#00ffca]">Entity Identity</th>
                          <th className="py-4 px-6 text-[9px] font-black uppercase tracking-widest text-white/20">Sync Status</th>
                          <th className="py-4 px-6 text-[9px] font-black uppercase tracking-widest text-white/20">Trigger</th>
                          <th className="py-4 px-6 text-[9px] font-black uppercase tracking-widest text-white/20 text-right">Action</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.02]">
                       {logs.length > 0 ? logs.map(log => (
                         <tr key={log.id} className="hover:bg-white/[0.02] transition-all group">
                            <td className="py-4 px-6">
                               <div className="flex items-center gap-2 text-white/30 group-hover:text-white/50 transition-colors">
                                  <Clock className="w-3 h-3" />
                                  <span className="text-[10px] font-data">{new Date(log.pushed_at).toLocaleTimeString()}</span>
                               </div>
                            </td>
                            <td className="py-4 px-6">
                               <div>
                                  <p className="text-[11px] font-bold text-white uppercase tracking-tight">{log.company_name || 'SYNC_PULSE_HEARTBEAT'}</p>
                                  <div className="flex gap-2 text-[8px] text-white/20 uppercase font-black tracking-widest mt-1">
                                     <span className="text-[#00ffca]/60 group-hover:text-[#00ffca] transition-all">{log.sector || 'METRICS'}</span>
                                     <span>·</span>
                                     <span>ID: {log.lead_id?.split('-')[0]}</span>
                                  </div>
                               </div>
                            </td>
                            <td className="py-4 px-6">
                               <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-black uppercase tracking-widest ${getStatusColor(log.status)}`}>{log.status}</span>
                                  {log.attempts > 1 && <span className="text-[8px] bg-white/5 px-1.5 py-0.5 rounded text-white/30">{log.attempts} RETRIES</span>}
                               </div>
                               {log.status === 'FAILED' && log.detail && (
                                 <p className="text-[8px] text-red-500/40 uppercase font-bold truncate max-w-[150px] mt-1">{log.detail}</p>
                               )}
                            </td>
                            <td className="py-4 px-6">
                               <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${log.triggered_by === 'auto' ? 'border border-white/5 text-white/30' : 'bg-[#00ffca]/10 text-[#00ffca] border border-[#00ffca]/20'}`}>
                                  {log.triggered_by}
                               </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                               <button 
                                 onClick={() => handleManualPush(log.lead_id)}
                                 className="text-[9px] font-black uppercase tracking-widest text-white/20 hover:text-[#00ffca] transition-all flex items-center gap-2 justify-end ml-auto"
                               >
                                  RE-RE-PUSH <ExternalLink className="w-3 h-3" />
                                </button>
                            </td>
                         </tr>
                       )) : (
                         <tr>
                            <td colSpan={5} className="py-20 text-center">
                               <Activity className="w-12 h-12 text-white/5 mx-auto mb-4" />
                               <p className="text-[10px] font-black uppercase tracking-widest text-white/20">No signal telemetry recorded yet.</p>
                            </td>
                         </tr>
                       )}
                    </tbody>
                 </table>
              </div>

              {logs.length > 0 && (
                <div className="p-6 border-t border-white/5 flex justify-between items-center">
                   <p className="text-[9px] font-black uppercase tracking-widest text-white/20 italic italic-strong underline-offset-4">Displaying last 15 signal transmission packets</p>
                   {stats?.recent_failures.length ? (
                     <div className="flex items-center gap-3 text-red-400 group cursor-help">
                        <AlertCircle className="w-3 h-3" />
                        <span className="text-[9px] font-black uppercase tracking-widest">Recent Node Dropouts Detected</span>
                        <div className="absolute bottom-full right-0 mb-4 w-64 bg-black border border-red-500/30 p-4 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50">
                           <p className="text-[9px] font-black uppercase tracking-widest text-red-400 mb-2 border-b border-red-500/20 pb-2">Last 5 Failures</p>
                           {stats.recent_failures.map(f => (
                             <div key={f.lead_id} className="mb-2 last:mb-0">
                                <p className="text-[8px] text-white/80 font-mono truncate">{f.detail}</p>
                             </div>
                           ))}
                        </div>
                     </div>
                   ) : null}
                </div>
              )}
           </section>
        </div>
      </div>
    </div>
  );
}
