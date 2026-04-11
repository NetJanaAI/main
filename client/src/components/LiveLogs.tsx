import React, { useEffect, useRef } from 'react';
import { Terminal, Info, CheckCircle, XCircle, ShieldAlert } from 'lucide-react';
import type { Log } from '../types';

interface LiveLogsProps {
    logs: Log[];
}

export const LiveLogs: React.FC<LiveLogsProps> = ({ logs }) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="w-full glass-panel border-white/5 bg-white/[0.01] overflow-hidden">
            <div className="bg-white/[0.03] px-8 py-5 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Terminal className="w-4 h-4 text-primary" />
                    <span className="text-[9px] font-black uppercase tracking-[4px] text-white/40">Real-time Execution Stream</span>
                </div>
                <div className="flex gap-1.5 font-mono text-[10px] text-white/20">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    Live Pulse
                </div>
            </div>
            <div className="h-80 overflow-y-auto p-8 font-mono text-[11px] space-y-4 scrollbar-thin">
                {logs.length === 0 && (
                    <div className="text-white/10 text-center italic mt-16 font-black uppercase tracking-widest text-[9px]">Awaiting Data Ingress...</div>
                )}
                {logs.map((log, i) => (
                    <div key={i} className="flex items-start gap-4 animate-in fade-in slide-in-from-left-2 duration-300">
                        <span className="text-white/10 font-black tracking-tighter shrink-0 w-20">
                            [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]
                        </span>
                        <div className="shrink-0 mt-0.5">
                            {log.type === 'info' && <Info className="w-3.5 h-3.5 text-white/30" />}
                            {log.type === 'success' && <CheckCircle className="w-3.5 h-3.5 text-cyber-green" />}
                            {log.type === 'error' && <XCircle className="w-3.5 h-3.5 text-primary" />}
                            {log.type === 'warning' && <ShieldAlert className="w-3.5 h-3.5 text-orange-400" />}
                        </div>
                        <span className={`
                            break-all font-medium leading-relaxed
                            ${log.type === 'info' ? "text-white/50" : ""}
                            ${log.type === 'success' ? "text-cyber-green/80" : ""}
                            ${log.type === 'error' ? "text-primary/80" : ""}
                            ${log.type === 'warning' ? "text-orange-400/80" : ""}
                        `}>
                            {log.message.toUpperCase()}
                        </span>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
};
