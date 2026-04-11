import { useEffect, useState } from 'react';
import { Cpu, Zap, TrendingUp, BarChart3 } from 'lucide-react';

interface TokenStats {
  realtime: any[];
  historical: {
    date: string;
    input: number;
    output: number;
    saved: number;
    efficiency_pct: number;
  }[];
  roles: {
    role: string;
    total_tokens: number;
  }[];
}

export default function TokenTelemetry() {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/telemetry/tokens');
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch telemetry:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000); // 10s refresh
    return () => clearInterval(interval);
  }, []);

  if (loading || !stats) {
    return (
      <div className="bg-white/5 border border-white/10 p-6 rounded-2xl animate-pulse h-[300px]" />
    );
  }


  const totalInput = stats.historical.reduce((acc, curr) => acc + Number(curr.input), 0);
  const totalSaved = stats.historical.reduce((acc, curr) => acc + Number(curr.saved), 0);
  const avgEfficiency = totalInput > 0 ? Math.round((totalSaved / (totalInput + totalSaved)) * 100) : 0;

  return (
    <div className="bg-white/5 border border-white/5 p-6 rounded-2xl backdrop-blur-md flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-emerald-400" />
          <h3 className="text-[10px] font-black uppercase tracking-[3px] text-white/60">Inference Telemetry</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[8px] font-black tracking-widest uppercase text-emerald-400">Live Optimization</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-white/5 border border-white/5 rounded-xl">
          <div className="flex items-center gap-2 mb-2 text-white/40">
            <Zap className="w-3 h-3" />
            <span className="text-[9px] font-black uppercase tracking-widest">Total Ingested</span>
          </div>
          <div className="text-xl font-data font-black text-white">
            {totalInput.toLocaleString()}
          </div>
          <div className="text-[8px] font-black uppercase tracking-widest text-white/20 mt-1">Tokens</div>
        </div>

        <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
          <div className="flex items-center gap-2 mb-2 text-emerald-400/60">
            <TrendingUp className="w-3 h-3" />
            <span className="text-[9px] font-black uppercase tracking-widest">TOON Savings</span>
          </div>
          <div className="text-xl font-data font-black text-emerald-400">
            {totalSaved.toLocaleString()}
          </div>
          <div className="text-[8px] font-black uppercase tracking-widest text-emerald-400/40 mt-1">Tokens Saved</div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
            <span className="text-white/40">Optimization Efficiency</span>
            <span className="text-emerald-400">{avgEfficiency}%</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)] transition-all duration-1000" 
              style={{ width: `${avgEfficiency}%` }} 
            />
          </div>
        </div>

        <div className="pt-4 border-t border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-3 h-3 text-white/40" />
            <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Role Distribution</span>
          </div>
          <div className="space-y-2">
            {stats.roles.slice(0, 3).map(role => (
               <div key={role.role} className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                 <span className="text-white/20">{role.role}</span>
                 <span className="text-white/60">{Number(role.total_tokens).toLocaleString()} tks</span>
               </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-auto pt-4 flex flex-col gap-2">
        <p className="text-[9px] text-white/20 font-bold uppercase leading-relaxed">
          The TOON protocol is active. Context window density increased by ~{avgEfficiency}% across the cluster.
        </p>
      </div>
    </div>
  );
}
