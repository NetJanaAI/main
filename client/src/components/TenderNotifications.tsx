import { useState, useEffect } from 'react';
import { Bell, Target } from 'lucide-react';
import { io } from 'socket.io-client';

export default function TenderNotifications() {
  const [isOpen, setIsOpen] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const socket = io();
    
    socket.on('new_lead', (data: any) => {
        const lead = data.lead;
        if (lead && lead.watch_profile_id) {
            setMatches(prev => [lead, ...prev].slice(0, 10)); // keep last 10
            setUnreadCount(prev => prev + 1);
        }
    });

    return () => {
        socket.disconnect();
    };
  }, []);

  const toggleDropdown = () => {
      setIsOpen(!isOpen);
      if (!isOpen) {
          setUnreadCount(0);
      }
  };

  return (
    <div className="relative">
      <button 
        onClick={toggleDropdown}
        className="relative w-8 h-8 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
      >
        <Bell className="w-4 h-4 text-white/60" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-black flex items-center justify-center text-white border border-black shadow-[0_0_10px_rgba(239,68,68,0.5)]">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="p-3 border-b border-white/5 bg-white/[0.02]">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-white/60 flex items-center gap-2">
                    <Target className="w-3 h-3 text-[#D4AF37]" />
                    Tender Matches
                </h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
                {matches.length === 0 ? (
                    <div className="p-6 text-center text-[10px] uppercase tracking-widest text-white/30">
                        No new matches
                    </div>
                ) : (
                    matches.map((m, i) => (
                        <div key={i} className="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-[11px] text-white truncate max-w-[200px]">{m.company_name}</span>
                                <span className="text-[8px] text-[#D4AF37] px-1.5 py-0.5 bg-[#D4AF37]/10 rounded uppercase tracking-wider">Matched</span>
                            </div>
                            <p className="text-[9px] text-white/40 truncate">{m.sector || 'Unclassified Sector'}</p>
                        </div>
                    ))
                )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
