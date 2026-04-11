import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { Shield, Zap, Activity, LayoutGrid, HeartPulse, PieChart, Target } from 'lucide-react';
import type { LeadCard } from './types';

// We'll lazy-load or import components for the 4 views later
import LiveFeed from './components/views/LiveFeed';
import IntentPipeline from './components/views/IntentPipeline';
import SourceHealth from './components/views/SourceHealth';
import Analytics from './components/views/Analytics';
import IntentMatcher from './components/views/IntentMatcher';

const socket: Socket = io();

type Tab = 'live' | 'pipeline' | 'health' | 'analytics' | 'matcher';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'live', label: 'Live Registry Signals', icon: Activity },
  { id: 'matcher', label: 'Intent Matcher', icon: Target },
  { id: 'pipeline', label: 'Organization Registry', icon: LayoutGrid },
  { id: 'health', label: 'Registry Sync Health', icon: HeartPulse },
  { id: 'analytics', label: 'Performance Analytics', icon: PieChart },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('live');
  const [isConnected, setIsConnected] = useState(false);
  const [market, setMarket] = useState<'IN' | 'AE'>('IN');
  const [totalAlpha, setTotalAlpha] = useState(0); // Driven by real aggregates

  const [socketError, setSocketError] = useState<string | null>(null);

  useEffect(() => {
    socket.on('connect', () => {
      setIsConnected(true);
      setSocketError(null);
    });
    
    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      setIsConnected(false);
      setSocketError(error.message || 'Connection failed');
    });

    // Initial Alpha Sync
    fetch('/api/leads/stats').then(res => res.json()).then(data => {
      setTotalAlpha(data.alpha_sum || 0);
    });

    // Listen to new lead cards emitted by the backend Lead Emitter
    socket.on('new_lead', (data: { lead: LeadCard }) => {
      // We'll pass this via Context or an event bus to the LiveFeed component
      window.dispatchEvent(new CustomEvent('new_lead_event', { detail: data.lead }));

      // Increment Alpha sum based on the intent_score of the real signal
      setTotalAlpha(prev => prev + (data.lead.intent_score || 0));
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('new_lead');
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-[#020813] text-gray-200 overflow-x-hidden select-none flex flex-col items-center py-8 px-4 lg:px-8">
      {/* Background styling for the "Institutional Navy" aesthetic */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/10 via-[#020813] to-black z-0" />
      <div className="fixed inset-0 bg-grain opacity-20 pointer-events-none z-0" />

      {/* Header Bar */}
      <div className="relative w-full max-w-7xl flex flex-col md:flex-row justify-between items-start md:items-center mb-10 z-20 gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl backdrop-blur-md bg-white/5 flex items-center justify-center border border-white/10 ${isConnected ? 'text-[#D4AF37]' : 'text-red-500/50'}`}>
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-widest text-[#D4AF37] font-serif">NetJana.AI</h1>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[3px] text-white/40">
                Sovereign Alpha
              </span>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#D4AF37] animate-pulse shadow-[0_0_8px_rgba(212,175,55,1)]' : 'bg-red-500'}`} />
              {socketError && (
                <span className="text-[10px] font-bold text-red-400 ml-2 animate-pulse truncate max-w-[200px]">
                  {socketError}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          {/* Geo Filter Toggle */}
          <div className="flex bg-white/5 p-1 rounded-lg border border-white/10">
            <button
              onClick={() => setMarket('IN')}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-colors ${market === 'IN' ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'text-white/40 hover:text-white/60'}`}
            >
              IN
            </button>
            <button
              onClick={() => setMarket('AE')}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-colors ${market === 'AE' ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'text-white/40 hover:text-white/60'}`}
            >
              AE
            </button>
          </div>

          <div>
            <h2 className="text-[9px] font-black uppercase tracking-[3px] text-white/30 mb-0.5text-right">Alpha Escrow</h2>
            <div className="flex items-center gap-2 justify-end">
              <Zap className="w-4 h-4 text-[#D4AF37] fill-[#D4AF37]" />
              <span className="text-2xl font-serif italic tracking-tighter text-white">
                {market === 'IN' ? '₹' : 'AED '}
                {market === 'IN' 
                  ? ((totalAlpha * 1000) / 100000).toFixed(2) + 'L' 
                  : ((totalAlpha * 1000) / 3.67).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="w-full max-w-7xl relative z-10 mb-8 border-b border-white/10">
        <div className="flex gap-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 pb-4 text-xs font-bold uppercase tracking-widest transition-all duration-200 border-b-2 ${isActive
                  ? 'border-[#D4AF37] text-[#D4AF37]'
                  : 'border-transparent text-white/30 hover:text-white/60'
                  }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <main className="w-full max-w-7xl relative z-10 flex-1">
        {activeTab === 'live' && <LiveFeed market={market} />}
        {activeTab === 'pipeline' && <IntentPipeline market={market} />}
        {activeTab === 'health' && <SourceHealth />}
        {activeTab === 'analytics' && <Analytics />}
        {activeTab === 'matcher' && <IntentMatcher />}
      </main>
    </div>
  );
}

export default App;
