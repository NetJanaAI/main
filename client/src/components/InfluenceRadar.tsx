import React from 'react';

interface InfluenceRadarProps {
    scores: {
        tradeBodies: number;
        publications: number;
        events: number;
        podcasts: number;
    };
    overallScore: number;
    alphaScore: number;
}

const InfluenceRadar: React.FC<InfluenceRadarProps> = ({ scores, overallScore, alphaScore }) => {
    // Simplified SVG radar chart representation
    const size = 200;
    const center = size / 2;
    const radius = 80;

    // Normalize scores (0-100 to 0-radius)
    const points = [
        { x: center, y: center - (scores.tradeBodies / 100) * radius }, // Top: Trade Bodies
        { x: center + (scores.publications / 100) * radius, y: center }, // Right: Publications
        { x: center, y: center + (scores.events / 100) * radius },       // Bottom: Events
        { x: center - (scores.podcasts / 100) * radius, y: center }      // Left: Podcasts
    ];

    const polygonPoints = points.map(p => `${p.x},${p.y}`).join(' ');

    return (
        <div className="flex flex-col items-center bg-slate-900/40 p-6 rounded-3xl border border-slate-800">
            <div className="flex w-full justify-between mb-8">
                <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Influence Score</div>
                    <div className="text-3xl font-black text-white">{overallScore}<span className="text-sm text-slate-600 font-medium">/100</span></div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1">Alpha Score</div>
                    <div className="text-3xl font-black text-indigo-400">Α {alphaScore}</div>
                </div>
            </div>

            <div className="relative">
                <svg width={size} height={size} className="overflow-visible">
                    {/* Background Circles */}
                    {[20, 40, 60, 80].map(r => (
                        <circle key={r} cx={center} cy={center} r={r} fill="none" stroke="currentColor" className="text-slate-800" strokeDasharray="2 4" />
                    ))}
                    
                    {/* Axes */}
                    <line x1={center} y1={center-radius} x2={center} y2={center+radius} stroke="currentColor" className="text-slate-800" />
                    <line x1={center-radius} y1={center} x2={center+radius} y2={center} stroke="currentColor" className="text-slate-800" />

                    {/* Labels */}
                    <text x={center} y={center-radius-10} textAnchor="middle" className="text-[9px] fill-slate-500 font-bold uppercase">Trade Bodies</text>
                    <text x={center+radius+5} y={center+4} textAnchor="start" className="text-[9px] fill-slate-500 font-bold uppercase">Pubs</text>
                    <text x={center} y={center+radius+15} textAnchor="middle" className="text-[9px] fill-slate-500 font-bold uppercase">Events</text>
                    <text x={center-radius-5} y={center+4} textAnchor="end" className="text-[9px] fill-slate-500 font-bold uppercase">Podcasts</text>

                    {/* Data Polygon */}
                    <polygon 
                        points={polygonPoints} 
                        fill="rgba(99, 102, 241, 0.2)" 
                        stroke="rgba(99, 102, 241, 0.8)" 
                        strokeWidth="2"
                    />
                    
                    {/* Data Points */}
                    {points.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="3" fill="white" stroke="rgba(99, 102, 241, 1)" strokeWidth="2" />
                    ))}
                </svg>
            </div>

            <div className="grid grid-cols-2 gap-4 w-full mt-8">
                <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/50">
                    <div className="text-[8px] font-bold text-slate-600 uppercase mb-1">Trade Bodies</div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500" style={{ width: `${scores.tradeBodies}%` }} />
                    </div>
                </div>
                <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/50">
                    <div className="text-[8px] font-bold text-slate-600 uppercase mb-1">Publications</div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${scores.publications}%` }} />
                    </div>
                </div>
                <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/50">
                    <div className="text-[8px] font-bold text-slate-600 uppercase mb-1">Events</div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${scores.events}%` }} />
                    </div>
                </div>
                <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/50">
                    <div className="text-[8px] font-bold text-slate-600 uppercase mb-1">Podcasts</div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${scores.podcasts}%` }} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InfluenceRadar;
