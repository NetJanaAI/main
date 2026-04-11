import { UserButton, OrganizationSwitcher } from "@clerk/clerk-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { 
  Shield, 
  Activity, 
  HeartPulse, 
  PieChart, 
  Target, 
  Settings, 
  Menu,
  X,
  Send,
  User,
  ExternalLink
} from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../store/appStore";

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Terminal Index', icon: Activity, path: '/app/dashboard' },
  { id: 'signals', label: 'Signal Matrix', icon: HeartPulse, path: '/app/signals' },
  { id: 'query', label: 'Intent Matcher', icon: Target, path: '/app/query' },
  { id: 'reports', label: 'Alpha Reports', icon: PieChart, path: '/app/reports' },
  { id: 'api', label: 'Registry Keys', icon: Settings, path: '/app/api' },
  { id: 'sync', label: 'Sync Node', icon: Send, path: '/app/sync' },
  { id: 'profile', label: 'User Protocol', icon: User, path: '/app/profile' },
];

export default function AppLayout() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { market, setMarket, creditUsed, creditLimit } = useAppStore();

  const creditPercentage = Math.min((creditUsed / creditLimit) * 100, 100);

  return (
    <div className="flex h-screen bg-[#020813] text-gray-200 overflow-hidden font-serif">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/5 via-[#020813] to-black z-0" />
      
      {/* Desktop Sidebar (Left) */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-white/5 bg-black/40 backdrop-blur-xl shrink-0 z-50">
        <div className="p-6 border-b border-white/5">
          <Link to="/" className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-[#D4AF37]" strokeWidth={2.5} />
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-[#D4AF37]">NetJana.AI</h2>
              <span className="text-[9px] font-black uppercase tracking-[3px] text-white/30 truncate block">Intel Protocol</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavLink 
              key={item.id} 
              to={item.path}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${isActive ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 border-l-[3px] border-l-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.05)]' : 'text-white/30 hover:text-white/60 hover:bg-white/5 border border-transparent border-l-[3px]'}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
          
          <div className="pt-8 opacity-20">
             <div className="h-px bg-white/20 mb-8" />
          </div>
          
          <Link to="/help" className="flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors">
            <ExternalLink className="w-4 h-4" /> Help Center
          </Link>
        </nav>

        <div className="p-6 border-t border-white/5 bg-white/[0.01]">
           <div className="flex items-center justify-between mb-4">
             <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Credit Limit</span>
             <span className="text-[10px] font-black text-[#D4AF37]">{creditUsed} / {creditLimit}</span>
           </div>
           <div className="w-full h-1 bg-white/10 rounded-full overflow-visible relative mt-2">
             <div 
               className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ${creditPercentage > 90 ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-[#D4AF37] shadow-[0_0_10px_rgba(212,175,55,0.7)]'}`} 
               style={{ width: `${creditPercentage}%` }} 
             />
           </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 relative h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between px-6 z-40">
          <div className="flex items-center gap-6">
            <button className="lg:hidden text-white/40 hover:text-white" onClick={() => setIsMobileMenuOpen(true)}>
              <Menu className="w-6 h-6" />
            </button>
            <div className="hidden lg:block">
              <OrganizationSwitcher 
                appearance={{
                  elements: {
                    rootBox: "bg-white/5 border border-white/10 rounded-md py-1.5 px-3 h-9",
                    organizationSwitcherTrigger: "text-white text-[10px] font-black uppercase tracking-widest",
                  }
                }} 
              />
            </div>
            {/* Market Toggle */}
            <div className="flex bg-white/5 p-1 rounded-lg border border-white/10 scale-90 origin-left">
              <button onClick={() => setMarket('IN')} className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-colors ${market === 'IN' ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'text-white/40 hover:text-white/60'}`}>IN</button>
              <button onClick={() => setMarket('AE')} className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-colors ${market === 'AE' ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'text-white/40 hover:text-white/60'}`}>AE</button>
            </div>
          </div>

          <div className="flex items-center gap-4">
             <UserButton 
               appearance={{
                 elements: {
                   rootBox: "w-8 h-8 rounded-full border border-white/10 overflow-hidden bg-white/5 flex items-center justify-center p-0 scale-125"
                 }
               }}
             />
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden relative p-8">
           <div className="max-w-7xl mx-auto">
             <Outlet />
           </div>
        </main>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-2xl lg:hidden flex flex-col p-8">
          <div className="flex justify-between items-center mb-12">
             <div className="flex items-center gap-3">
               <Shield className="w-8 h-8 text-[#D4AF37]" strokeWidth={2.5} />
               <h2 className="text-sm font-black uppercase tracking-widest text-[#D4AF37]">NetJana.AI</h2>
             </div>
             <button onClick={() => setIsMobileMenuOpen(false)} className="text-white/40 hover:text-white"><X className="w-8 h-8" /></button>
          </div>

          <nav className="flex-1 space-y-6">
            {NAV_ITEMS.map(item => (
              <NavLink 
                key={item.id} 
                to={item.path} 
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center gap-4 text-xl font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37]"
              >
                <item.icon className="w-6 h-6 text-[#D4AF37]/50" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <footer className="pt-12 border-t border-white/5 opacity-40 text-[10px] uppercase font-black tracking-widest">
            NetJana.AI — Protocol Access Active
          </footer>
        </div>
      )}
    </div>
  );
}
