import React, { useEffect, useRef, useState } from 'react';
import { Download, ZoomIn, ZoomOut, RotateCcw, Loader2, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';

interface EntityOrganogramProps {
  mermaidDiagram: string;
  entityId: string;
  enrichmentStatus: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  isLoading?: boolean;
  onNodeClick?: (cin: string) => void;
}

export const EntityOrganogram: React.FC<EntityOrganogramProps> = ({
  mermaidDiagram,
  entityId,
  enrichmentStatus,
  isLoading = false,
  onNodeClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);

  useEffect(() => {
    let isCancelled = false;

    async function renderDiagram() {
      if (!mermaidDiagram) {
        setSvgContent('');
        return;
      }

      setIsRendering(true);
      setRenderError(null);

      try {
        // Dynamic import to keep bundle light
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: 'transparent',
            fontFamily: 'Inter, system-ui, sans-serif',
            primaryColor: '#064e3b',
            primaryBorderColor: '#34d399',
            primaryTextColor: '#ffffff',
            lineColor: '#64748b',
          },
          securityLevel: 'loose',
        });

        const renderId = `organogram_${entityId.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now()}`;
        const { svg } = await mermaid.render(renderId, mermaidDiagram);

        if (!isCancelled) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        console.error('[EntityOrganogram] Mermaid render error:', err);
        if (!isCancelled) {
          setRenderError(err.message || 'Failed to render organogram diagram.');
        }
      } finally {
        if (!isCancelled) {
          setIsRendering(false);
        }
      }
    }

    renderDiagram();

    return () => {
      isCancelled = true;
    };
  }, [mermaidDiagram, entityId]);

  // Attach click listener to SVG company nodes
  useEffect(() => {
    if (!containerRef.current || !svgContent || !onNodeClick) return;

    const nodeElements = containerRef.current.querySelectorAll('.node');
    const handlers: Array<{ el: Element; handler: () => void }> = [];

    nodeElements.forEach((nodeEl) => {
      const idAttr = nodeEl.id || '';
      // Look for CIN pattern in node id: id_sub_L... or id_parent_U... or id_target_...
      const match = idAttr.match(/id_(?:target|ult|parent|sub|assoc)_([A-Za-z0-9_]+)/);
      if (match && match[1]) {
        const potentialCin = match[1];
        // If it looks like a CIN (starts with L or U and 21 chars), bind click
        if (/^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$/i.test(potentialCin)) {
          (nodeEl as HTMLElement).style.cursor = 'pointer';
          const clickHandler = () => onNodeClick(potentialCin.toUpperCase());
          nodeEl.addEventListener('click', clickHandler);
          handlers.push({ el: nodeEl, handler: clickHandler });
        }
      }
    });

    return () => {
      handlers.forEach(({ el, handler }) => {
        el.removeEventListener('click', handler);
      });
    };
  }, [svgContent, onNodeClick]);

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `organogram_${entityId}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.2, 2.5));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.2, 0.4));
  const handleResetZoom = () => setZoom(1);

  return (
    <div className="flex flex-col h-full bg-[#030914] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-black/40 border-b border-white/10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-[#00ffca]/10 border border-[#00ffca]/30">
            <Sparkles className="w-4 h-4 text-[#00ffca]" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-white">
              Corporate Hierarchy Organogram
            </h3>
            <p className="text-[10px] text-white/40 font-mono">
              Ultimate Parent &bull; Subsidiaries &bull; Governance
            </p>
          </div>
        </div>

        {/* Enrichment Status Chip */}
        <div className="flex items-center gap-3">
          {enrichmentStatus === 'PENDING' || enrichmentStatus === 'RUNNING' ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-mono animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span>MCA Live Enrichment...</span>
            </div>
          ) : enrichmentStatus === 'COMPLETED' ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Fully Enriched</span>
            </div>
          ) : enrichmentStatus === 'FAILED' ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] font-mono">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Enrichment Failed</span>
            </div>
          ) : null}

          {/* Zoom & Export Actions */}
          <div className="flex items-center gap-1 border-l border-white/10 pl-3">
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset Zoom"
              className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors text-[10px] font-mono font-bold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDownloadSvg}
              disabled={!svgContent}
              title="Download SVG"
              className="flex items-center gap-1.5 ml-1 px-2.5 py-1 rounded-md bg-[#00ffca]/10 border border-[#00ffca]/30 text-[#00ffca] hover:bg-[#00ffca]/20 text-[11px] font-bold tracking-wider transition-all disabled:opacity-30"
            >
              <Download className="w-3.5 h-3.5" />
              <span>SVG</span>
            </button>
          </div>
        </div>
      </div>

      {/* Diagram Canvas */}
      <div className="relative flex-1 min-h-[420px] overflow-auto p-6 flex items-center justify-center bg-[#01040a]">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        {isLoading || isRendering ? (
          <div className="flex flex-col items-center gap-3 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-[#00ffca]" />
            <p className="text-xs text-white/50 font-mono tracking-wider">
              Rendering corporate organogram...
            </p>
          </div>
        ) : renderError ? (
          <div className="flex flex-col items-center gap-3 p-6 max-w-md text-center z-10">
            <AlertCircle className="w-8 h-8 text-rose-400" />
            <p className="text-xs text-rose-300 font-mono">{renderError}</p>
            <p className="text-[11px] text-white/40">
              The hierarchy definition could not be rendered as a diagram.
            </p>
          </div>
        ) : svgContent ? (
          <div
            ref={containerRef}
            className="transition-transform duration-200 origin-center max-w-full"
            style={{ transform: `scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="text-xs text-white/30 font-mono">No diagram available</div>
        )}
      </div>

      {/* Legend Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-black/60 border-t border-white/5 text-[10px] text-white/40">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1e1b4b] border border-[#818cf8]" />
            <span>Ultimate Parent</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1e293b] border border-[#94a3b8]" />
            <span>Direct Parent</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#064e3b] border border-[#34d399]" />
            <span className="text-[#34d399] font-bold">Target Entity</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#0f172a] border border-[#38bdf8]" />
            <span>Subsidiary</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1c1917] border border-[#fbbf24] border-dashed" />
            <span>Associate</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#2e1065] border border-[#c084fc]" />
            <span>Director / Governance</span>
          </span>
        </div>
        <span className="font-mono text-white/30">Click company node with CIN to drill down</span>
      </div>
    </div>
  );
};
export default EntityOrganogram;
