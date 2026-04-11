import React from 'react';

interface FreshnessBadgeProps {
    status: 'Hot' | 'Warm' | 'Cold' | 'Dead';
    freshnessPercent: number;
    capturedAt: string;
    nextReview: string;
}

const FreshnessBadge: React.FC<FreshnessBadgeProps> = ({ status, freshnessPercent, capturedAt, nextReview }) => {
    const getColor = () => {
        switch (status) {
            case 'Hot': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
            case 'Warm': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
            case 'Cold': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
            case 'Dead': return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
            default: return 'bg-slate-800 text-slate-500';
        }
    };

    const getIndicator = () => {
        switch (status) {
            case 'Hot': return '🔴';
            case 'Warm': return '🟡';
            case 'Cold': return '🟠';
            case 'Dead': return '⚫';
        }
    };

    return (
        <div 
            className={`group relative inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${getColor()}`}
            title={`Captured: ${new Date(capturedAt).toLocaleDateString()} · Next Review: ${new Date(nextReview).toLocaleDateString()}`}
        >
            <span className="text-[8px]">{getIndicator()}</span>
            {status}
            <span className="ml-1 opacity-60">{freshnessPercent}%</span>

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl scale-0 group-hover:scale-100 transition-transform origin-bottom z-50 pointer-events-none">
                <div className="text-slate-400 text-[10px] normal-case tracking-normal space-y-1">
                    <p>Signal captured <span className="text-white font-medium">{Math.floor((Date.now() - new Date(capturedAt).getTime()) / (1000*60*60*24))} days ago</span></p>
                    <p>Current freshness: <span className="text-white font-medium">{freshnessPercent}%</span></p>
                    <p>Next tier transition: <span className="text-white font-medium">{new Date(nextReview).toLocaleDateString()}</span></p>
                </div>
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800" />
            </div>
        </div>
    );
};

export default FreshnessBadge;
