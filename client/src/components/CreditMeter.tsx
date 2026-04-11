interface CreditMeterProps {
  used: number;
  limit: number;
  size?: 'sm' | 'lg';
}

export default function CreditMeter({ used, limit, size = 'lg' }: CreditMeterProps) {
  const percentage = Math.min((used / limit) * 100, 100);
  const color = percentage > 90 ? 'bg-red-500' : percentage > 75 ? 'bg-[#D4AF37]' : 'bg-emerald-500';

  if (size === 'sm') {
    return (
      <div className="flex flex-col gap-1.5 min-w-[120px]">
        <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-white/30">
          <span>Credits Used</span>
          <span className={percentage > 90 ? 'text-red-400' : 'text-[#D4AF37]'}>{used}/{limit}</span>
        </div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div className={`h-full ${color} transition-all duration-1000`} style={{ width: `${percentage}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/5 p-6 rounded-xl">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-[10px] font-black uppercase tracking-[3px] text-white/30">Consumption Quotient</h4>
        <span className="text-xl font-serif italic text-white tracking-tighter">{used} <span className="text-white/20">/ {limit}</span></span>
      </div>
      <div className="h-3 bg-white/5 rounded-full overflow-hidden relative">
        <div className={`absolute inset-0 opacity-20 ${color} animate-pulse blur-md`} style={{ width: `${percentage}%` }} />
        <div className={`h-full ${color} transition-all duration-1000 relative z-10`} style={{ width: `${percentage}%` }} />
      </div>
      <div className="flex justify-between mt-3 text-[9px] font-black uppercase tracking-widest text-white/20">
        <span>0%</span>
        <span>{percentage.toFixed(0)}% Utilized</span>
        <span>100%</span>
      </div>
    </div>
  );
}
