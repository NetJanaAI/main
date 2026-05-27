import { Component, type ErrorInfo, type ReactNode } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[UI Crash] Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020813] flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-white/[0.02] border border-white/10 rounded-2xl p-8 backdrop-blur-xl shadow-2xl text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
              <ShieldAlert className="w-8 h-8 text-red-500" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-xl font-black uppercase tracking-widest text-white">System Signal Lost</h1>
              <p className="text-white/40 text-sm font-medium leading-relaxed font-data italic">
                The intelligence bridge has encountered a critical rendering exception. Stabilizing telemetry...
              </p>
            </div>

            <button 
              onClick={() => window.location.reload()}
              className="w-full h-12 bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-[10px] rounded hover:bg-white/10 transition-all flex items-center justify-center gap-2 group"
            >
              <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" />
              Reset Local Cluster
            </button>

            <div className="pt-4 border-t border-white/5">
              <p className="text-[8px] font-black uppercase tracking-[2px] text-white/20">
                Residue: {this.state.error?.name || 'DOM_COLLISION'}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
