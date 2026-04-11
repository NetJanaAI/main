import { ShieldCheck, GitMerge, FileCheck } from 'lucide-react';

interface VerityBadgeProps {
  corroborated: boolean;
  signalCount: number;
  verityTier: string;
}

export default function VerityBadge({ corroborated, signalCount, verityTier }: VerityBadgeProps) {
  if (!corroborated && verityTier !== 'VERIFIED') return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full group cursor-help transition-all hover:bg-emerald-500/20">
      {corroborated ? (
        <GitMerge className="w-3 h-3 text-emerald-400" />
      ) : (
        <ShieldCheck className="w-3 h-3 text-emerald-400" />
      )}
      <span className="text-[9px] font-black uppercase tracking-tighter text-emerald-400">
        {corroborated ? `Triangulated (${signalCount})` : 'Fact-Checked'}
      </span>
      
      <div className="absolute hidden group-hover:block z-50 bg-[#0F0F0B] border border-white/10 p-3 rounded-lg shadow-2xl w-48 mt-12 -ml-2">
        <div className="flex items-center gap-2 mb-1">
          <FileCheck className="w-3 h-3 text-emerald-400" />
          <p className="text-[10px] font-black uppercase tracking-widest text-white">Registry Verity</p>
        </div>
        <p className="text-[9px] leading-relaxed text-white/60">
          This lead has been confirmed across {signalCount} independent registries. Verified for procurement intent and funding availability.
        </p>
      </div>
    </div>
  );
}
 bitumen: 121
