import type { LeadCard } from '../types';

interface SignalRowProps {
  lead: LeadCard;
  onClick: (lead: LeadCard) => void;
}

export default function SignalRow({ lead, onClick }: SignalRowProps) {
  const scoreColor = lead.intent_score > 80 ? 'text-emerald-400' : lead.intent_score > 50 ? 'text-amber-400' : 'text-white/40';

  return (
    <tr 
      onClick={() => onClick(lead)}
      className="group hover:bg-white/[0.04] transition-colors border-b border-white/5 cursor-pointer"
    >
      <td className="py-4 px-4 font-bold text-xs uppercase tracking-tight text-white group-hover:text-[#D4AF37] transition-colors max-w-[200px] truncate flex items-center gap-2">
        {lead.company_name}
        {lead.watch_profile_id && (
          <span className="bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30 text-[8px] px-1.5 py-0.5 rounded uppercase tracking-[2px] whitespace-nowrap shrink-0">
            Tender Match
          </span>
        )}
      </td>
      <td className="py-4 px-4 text-[10px] font-black uppercase tracking-[2px] text-white/40">
        {lead.sector || 'Unclassified'}
      </td>
      <td className={`py-4 px-4 text-xs font-black font-data ${scoreColor}`}>
        {lead.intent_score}
      </td>
      <td className="py-4 px-4">
        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${lead.decay_status === 'HOT' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-white/40 border-white/10'}`}>
          {lead.decay_status}
        </span>
      </td>
      <td className="py-4 px-4 text-[10px] font-bold text-white/20 uppercase tracking-widest text-right">
        {new Date(lead.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </td>
    </tr>
  );
}
