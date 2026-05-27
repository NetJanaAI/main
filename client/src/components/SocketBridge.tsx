import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../lib/auth';
import { useAppStore } from '../store/appStore';

export default function SocketBridge() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const setSocket = useAppStore(state => state.setSocket);
  const incrementUnread = useAppStore(state => state.incrementUnread);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;
    let socketInstance: ReturnType<typeof io> | null = null;

    const connect = async () => {
      const token = await getToken();
      if (cancelled) return;

      socketInstance = io({
        auth: token ? { token } : undefined,
        query: {
          organizationId: localStorage.getItem('netjana_tenant_id') || undefined,
        },
      });

      socketInstance.on('new_lead', incrementUnread);
      setSocket(socketInstance);
    };

    connect();

    return () => {
      cancelled = true;
      if (socketInstance) {
        socketInstance.off('new_lead', incrementUnread);
        socketInstance.disconnect();
      }
      setSocket(null);
    };
  }, [incrementUnread, isLoaded, isSignedIn, setSocket]);

  return null;
}
