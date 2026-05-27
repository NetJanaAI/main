import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const UsageMeter: React.FC<{ organizationId: string; initialUsage: number }> = ({ organizationId, initialUsage }) => {
    const [usage, setUsage] = useState(initialUsage);
    const [limit] = useState(5);
    const [showUpgrade, setShowUpgrade] = useState(false);

    useEffect(() => {
        const socket = io({ query: { organizationId } });

        socket.on('nudge:soft', (data) => {
            console.log('Soft Nudge:', data.message);
            // In a real app, this would trigger a toast or subtle banner
        });

        socket.on('nudge:hard', () => {
            setShowUpgrade(true);
        });

        // Listen for real-time usage updates
        socket.on('usage:update', (data) => {
            if (data.feature === 'ingestions') setUsage(data.used);
        });

        return () => { socket.disconnect(); };
    }, [organizationId]);

    const percentage = (usage / limit) * 100;
    const isAtThreshold = usage >= 3;

    return (
        <div className="flex flex-col gap-1 p-3 bg-slate-900/50 rounded-lg border border-slate-800 w-64">
            <div className="flex justify-between text-xs font-medium text-slate-400">
                <span>{usage} / {limit} free ingestions</span>
                <span className="text-slate-500">Resets Apr 1</span>
            </div>
            
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                    className={`h-full transition-all duration-500 ${isAtThreshold ? 'bg-orange-500' : 'bg-emerald-500'}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>

            {isAtThreshold && (
                <button 
                    onClick={() => window.location.href = '/app/profile'}
                    className="mt-2 py-1 px-2 bg-gradient-to-r from-orange-600 to-amber-600 text-white text-[10px] font-bold rounded uppercase tracking-wider hover:opacity-90 transition-opacity"
                >
                    Upgrade for Hunter Mode
                </button>
            )}

            {showUpgrade && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-orange-500/30 p-8 rounded-2xl max-w-md w-full shadow-2xl text-center">
                        <h2 className="text-2xl font-bold text-white mb-2">Limit Reached</h2>
                        <p className="text-slate-400 mb-6">You've found some great signals! Upgrade now to unlock unlimited ingestions, Hunter Mode, and Influence Maps.</p>
                        <button className="w-full py-3 bg-orange-600 text-white font-bold rounded-xl hover:bg-orange-500 transition-colors">
                            Unlock Sovereign Alpha
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UsageMeter;
