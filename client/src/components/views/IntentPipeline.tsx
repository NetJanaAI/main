import { LayoutGrid } from 'lucide-react';

export default function IntentPipeline({ market: _market }: { market: 'IN' | 'AE' }) {
    return (
        <div className="h-[60vh] flex flex-col items-center justify-center border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
            <LayoutGrid className="w-12 h-12 text-[#D4AF37]/50 mb-4" />
            <h3 className="text-xl font-serif italic text-white/80">Intent Pipeline</h3>
            <p className="text-xs font-black uppercase tracking-widest text-white/30 mt-2">Module Offline &bull; Preparing for Organization Level Rollups</p>
        </div>
    );
}
