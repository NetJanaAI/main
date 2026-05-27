import { PieChart, TrendingUp, BarChart3, Activity, ArrowUpRight, DollarSign, Target } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

interface AnalyticsData {
    roi: string;
    accuracy: string;
    activeEntities: string;
    sectors: Array<{ name: string; pct: number; color: string }>;
}

export default function Analytics() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/api/analytics/dashboard')
            .then(res => res.json())
            .then(resData => {
                setData(resData);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load analytics', err);
                setLoading(false);
            });
    }, []);

    const stats = data ? [
        { label: 'Total ROI Discovered', val: data.roi, trend: '+12.5%', icon: DollarSign, color: 'text-emerald-400' },
        { label: 'Signal Accuracy', val: data.accuracy, trend: '+1.2%', icon: Target, color: 'text-[#D4AF37]' },
        { label: 'Active Monitored Entities', val: data.activeEntities, trend: '+140', icon: Activity, color: 'text-blue-400' },
    ] : [
        { label: 'Total ROI Discovered', val: '---', trend: '---', icon: DollarSign, color: 'text-emerald-400' },
        { label: 'Signal Accuracy', val: '---', trend: '---', icon: Target, color: 'text-[#D4AF37]' },
        { label: 'Active Monitored Entities', val: '---', trend: '---', icon: Activity, color: 'text-blue-400' },
    ];

    const sectors = data?.sectors || [];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <PieChart className="w-6 h-6 text-[#D4AF37]" />
                    <h1 className="text-2xl font-black uppercase tracking-widest text-[#D4AF37]">Performance Analytics</h1>
                </div>
                <p className="text-xs uppercase tracking-widest text-white/40">
                    Sovereign insights into ROI, conversion velocity, and registry yield.
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {stats.map((stat, i) => {
                    const Icon = stat.icon || BarChart3;
                    return (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.1 }}
                            className="glass-panel p-6 border-white/5 bg-white/[0.02]"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className={`p-3 bg-black/40 rounded-xl border border-white/5 ${stat.color}`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                                    <ArrowUpRight className="w-3 h-3" /> {stat.trend}
                                </span>
                            </div>
                            <h4 className="text-3xl font-serif italic text-white mb-1">{loading ? '...' : stat.val}</h4>
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/40">{stat.label}</p>
                        </motion.div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 glass-panel p-6 border-white/5 bg-black/40 min-h-[400px] flex flex-col">
                    <h4 className="text-[10px] font-black uppercase tracking-[3px] text-[#D4AF37] mb-6 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> Signal Yield Velocity
                    </h4>

                    {/* Simulated Chart Area */}
                    <div className="flex-1 flex items-end gap-2 pb-6 pt-12 relative border-b border-l border-white/10 px-4">
                        <div className="absolute top-4 left-4 text-[9px] text-white/20 uppercase">Signals Found</div>
                        {[40, 60, 45, 80, 55, 90, 70, 100, 85, 110, 95, 120].map((h, i) => (
                            <motion.div
                                key={i}
                                initial={{ height: 0 }}
                                animate={{ height: `${h}%` }}
                                transition={{ delay: 0.5 + (i * 0.05), duration: 0.8, ease: "easeOut" }}
                                className="flex-1 bg-gradient-to-t from-[#D4AF37]/20 to-[#D4AF37] rounded-t-sm opacity-80 hover:opacity-100 transition-opacity relative group"
                            >
                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 text-[10px] font-black text-white bg-black/80 px-2 py-1 rounded border border-white/10 transition-all">
                                    {h * 12}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                    <div className="flex justify-between px-4 pt-4 text-[9px] font-black uppercase tracking-widest text-white/30">
                        <span>Jan</span>
                        <span>Feb</span>
                        <span>Mar</span>
                        <span>Apr</span>
                        <span>May</span>
                        <span>Jun</span>
                        <span>Jul</span>
                        <span>Aug</span>
                        <span>Sep</span>
                        <span>Oct</span>
                        <span>Nov</span>
                        <span>Dec</span>
                    </div>
                </div>

                <div className="glass-panel p-6 border-white/5 bg-black/40">
                    <h4 className="text-[10px] font-black uppercase tracking-[3px] text-[#D4AF37] mb-6">Top Discovered Sectors</h4>
                    <div className="space-y-6">
                        {loading && <div className="text-white/40 text-xs text-center py-10">Loading sectors...</div>}
                        {!loading && sectors.map((sector: any, i: number) => (
                            <div key={i}>
                                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-2">
                                    <span className="text-white/60">{sector.name}</span>
                                    <span className="text-white">{sector.pct}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${sector.pct}%` }}
                                        transition={{ delay: 0.8 + (i * 0.1), duration: 1 }}
                                        className={`h-full ${sector.color} shadow-[0_0_10px_currentColor]`}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
