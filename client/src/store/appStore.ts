import { create } from 'zustand';
import { Socket } from 'socket.io-client';

interface AppStore {
  organizationId: string | null;       // active tenant (user OR org)
  creditUsed: number;
  creditLimit: number;
  market: 'IN' | 'AE';
  socket: Socket | null;
  unreadSignals: number;
  
  setMarket: (m: 'IN' | 'AE') => void;
  setCredits: (used: number, limit: number) => void;
  setSocket: (s: Socket | null) => void;
  setOrganizationId: (id: string | null) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  organizationId: null,
  creditUsed: 0,
  creditLimit: 500,
  market: 'IN',
  socket: null,
  unreadSignals: 0,
  
  setMarket: (market) => set({ market }),
  setCredits: (used, limit) => set({ creditUsed: used, creditLimit: limit }),
  setSocket: (socket) => set({ socket }),
  setOrganizationId: (organizationId) => set({ organizationId }),
  incrementUnread: () => set((state) => ({ unreadSignals: state.unreadSignals + 1 })),
  clearUnread: () => set({ unreadSignals: 0 }),
}));
