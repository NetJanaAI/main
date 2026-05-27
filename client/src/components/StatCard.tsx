import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    isUp: boolean;
  };
}

export default function StatCard({ label, value, icon: Icon, trend }: StatCardProps) {
  return (
    <div className="bg-white/5 border border-white/5 p-6 rounded-xl hover:bg-white/[0.07] transition-all group">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-[#00ffca]/10 rounded-lg group-hover:scale-110 transition-transform">
          <Icon className="w-5 h-5 text-[#00ffca]" strokeWidth={2.5} />
        </div>
        {trend && (
          <span className={`text-[10px] font-black uppercase tracking-widest ${trend.isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend.isUp ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <div>
        <h4 className="text-[10px] font-black uppercase tracking-[3px] text-white/30 mb-1">{label}</h4>
        <div className="text-3xl font-sans italic text-white tracking-tighter">{value}</div>
      </div>
    </div>
  );
}
