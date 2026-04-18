import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Terminal } from 'lucide-react';

interface IngestEvent {
    id: string;
    source: string;
    type: string;
    timestamp: string;
    verity_score?: number;
}

const socket = io();

const IngestLogStream: React.FC = () => {
    const [events, setEvents] = useState<IngestEvent[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        socket.on('ingest_signal', (event: IngestEvent) => {
            setEvents(prev => [event, ...prev].slice(0, 50));
        });

        return () => {
            socket.off('ingest_signal');
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [events]);

    return (
        <div className="glass-panel border-white/5 bg-black/40 overflow-hidden flex flex-col h-[400px]">
            <div className="px-4 py-2 border-b border-white/10 bg-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/60">Live Ingestion Stream</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400">Listener Active</span>
                </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 font-mono scrollbar-hide">
                {events.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-white/10 text-[10px] uppercase font-black tracking-widest">
                        Awaiting Ingress Signals...
                    </div>
                ) : (
                    events.map(event => (
                        <div key={event.id} className="text-[10px] flex items-center gap-3 border-l border-white/5 pl-3 py-1 hover:bg-white/5 transition-colors group">
                            <span className="text-white/20 whitespace-nowrap">[{new Date(event.timestamp).toLocaleTimeString()}]</span>
                            <span className="text-primary font-bold uppercase tracking-widest">{event.source}</span>
                            <span className="text-white/40 truncate flex-1 uppercase tracking-tighter">&gt; {event.type} // SIG_{event.id.slice(0, 8)}</span>
                            {event.verity_score && (
                                <span className={`text-[8px] px-1.5 rounded ${event.verity_score > 80 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                                    V_SCR:{event.verity_score}
                                </span>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default IngestLogStream;
