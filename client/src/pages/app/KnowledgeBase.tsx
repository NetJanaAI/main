import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Search,
  Sparkles,
  FileText,
  UploadCloud,
  Database,
  Layers,
  History,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RefreshCw,
  Send,
  Edit3,
  Eye,
  Building2,
  Radio,
  FileCheck
} from 'lucide-react';
import { resolveApiUrl } from '../../lib/api';

interface SourceItem {
  id: string;
  docType: string;
  sourceId: string;
  entityId?: string;
  score: number;
  chunkIndex: number;
  snippet: string;
}

interface QueryResponse {
  answer: string;
  sources: SourceItem[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  tokensUsed: number;
  sourcesCount: number;
}

interface WikiPage {
  id?: string;
  entity_id: string;
  title: string;
  slug: string;
  body_md: string;
  author_name?: string;
  version: number;
  updated_at?: string;
}

interface WikiRevision {
  id: string;
  version: number;
  author_name: string;
  change_summary: string;
  created_at: string;
  char_count: number;
}

interface IngestedSource {
  source_id: string;
  doc_type: string;
  entity_id?: string;
  chunk_count: string | number;
  first_indexed: string;
  last_updated: string;
}

export const KnowledgeBase: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'ask';

  const setTab = (tab: string) => {
    setSearchParams(prev => {
      prev.set('tab', tab);
      return prev;
    });
  };

  // --- Tab 1: Ask State ---
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [ragResult, setRagResult] = useState<QueryResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [selectedDocTypes, setSelectedDocTypes] = useState<string[]>([]);
  const [entityFilter, setEntityFilter] = useState('');

  // --- Tab 2: Wiki State ---
  const [wikiEntityId, setWikiEntityId] = useState('');
  const [wikiPage, setWikiPage] = useState<WikiPage | null>(null);
  const [wikiBody, setWikiBody] = useState('');
  const [wikiTitle, setWikiTitle] = useState('');
  const [wikiLoading, setWikiLoading] = useState(false);
  const [wikiSaving, setWikiSaving] = useState(false);
  const [wikiSavedSuccess, setWikiSavedSuccess] = useState(false);
  const [wikiRevisions, setWikiRevisions] = useState<WikiRevision[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [wikiPagesList, setWikiPagesList] = useState<any[]>([]);

  // --- Tab 3: Sources State ---
  const [sourcesList, setSourcesList] = useState<IngestedSource[]>([]);
  const [stats, setStats] = useState<{ entity: number; signal: number; upload: number; wiki: number; total: number }>({
    entity: 0,
    signal: 0,
    upload: 0,
    wiki: 0,
    total: 0
  });
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  // -------------------------------------------------------------
  // Load Stats and Source inventory
  // -------------------------------------------------------------
  const fetchSourcesAndStats = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const [statsRes, sourcesRes] = await Promise.all([
        fetch(resolveApiUrl('/api/knowledge/stats')),
        fetch(resolveApiUrl('/api/knowledge/sources'))
      ]);

      if (statsRes.ok) {
        const d = await statsRes.json();
        if (d.stats) setStats(d.stats);
      }
      if (sourcesRes.ok) {
        const d = await sourcesRes.json();
        if (d.sources) setSourcesList(d.sources);
      }
    } catch (e: any) {
      console.warn('Sources fetch error:', e.message);
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  const fetchWikiPagesList = useCallback(async () => {
    try {
      const res = await fetch(resolveApiUrl('/api/wiki'));
      if (res.ok) {
        const d = await res.json();
        setWikiPagesList(d.pages || []);
      }
    } catch (e) {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchSourcesAndStats();
    fetchWikiPagesList();
  }, [fetchSourcesAndStats, fetchWikiPagesList]);

  // -------------------------------------------------------------
  // Ask RAG Execution
  // -------------------------------------------------------------
  const handleAsk = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = question.trim();
    if (!q) return;

    setIsAsking(true);
    setAskError(null);
    setRagResult(null);

    try {
      const res = await fetch(resolveApiUrl('/api/knowledge/query'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          entityId: entityFilter ? entityFilter.trim() : undefined,
          docTypes: selectedDocTypes.length > 0 ? selectedDocTypes : undefined,
          k: 6
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details || err.error || 'Failed to synthesize answer');
      }

      const data: QueryResponse = await res.json();
      setRagResult(data);
    } catch (err: any) {
      setAskError(err.message);
    } finally {
      setIsAsking(false);
    }
  };

  // -------------------------------------------------------------
  // Wiki Operations
  // -------------------------------------------------------------
  const loadWikiPage = async (id: string) => {
    if (!id.trim()) return;
    setWikiLoading(true);
    setWikiSavedSuccess(false);
    try {
      const res = await fetch(resolveApiUrl(`/api/wiki/${encodeURIComponent(id.trim())}`));
      if (res.ok) {
        const data = await res.json();
        if (data.page) {
          setWikiPage(data.page);
          setWikiTitle(data.page.title);
          setWikiBody(data.page.body_md);
        }
      } else {
        // Not found: initialize template
        setWikiTitle(id.toUpperCase());
        setWikiBody(`# ${id.toUpperCase()}\n\nAdd verified company notes, deal memos, or research here...`);
        setWikiPage({
          entity_id: id,
          title: id.toUpperCase(),
          slug: id.toLowerCase(),
          body_md: `# ${id.toUpperCase()}\n\nAdd verified company notes, deal memos, or research here...`,
          version: 0
        });
      }

      // Fetch history
      const histRes = await fetch(resolveApiUrl(`/api/wiki/${encodeURIComponent(id.trim())}/history`));
      if (histRes.ok) {
        const histData = await histRes.json();
        setWikiRevisions(histData.revisions || []);
      }
    } catch (err) {
      console.warn('Load wiki error:', err);
    } finally {
      setWikiLoading(false);
    }
  };

  const handleSaveWiki = async () => {
    if (!wikiEntityId.trim() || !wikiTitle.trim()) return;
    setWikiSaving(true);
    setWikiSavedSuccess(false);
    try {
      const res = await fetch(resolveApiUrl(`/api/wiki/${encodeURIComponent(wikiEntityId.trim())}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: wikiTitle,
          bodyMd: wikiBody,
          changeSummary: `Revision saved on ${new Date().toLocaleDateString()}`
        })
      });

      if (res.ok) {
        setWikiSavedSuccess(true);
        fetchSourcesAndStats();
        fetchWikiPagesList();
        loadWikiPage(wikiEntityId);
        setTimeout(() => setWikiSavedSuccess(false), 4000);
      }
    } catch (err: any) {
      console.error('Save wiki error:', err);
    } finally {
      setWikiSaving(false);
    }
  };

  // -------------------------------------------------------------
  // Upload Document
  // -------------------------------------------------------------
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    setUploadMsg(null);

    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      const res = await fetch(resolveApiUrl('/api/knowledge/upload'), {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details || err.error || 'Upload failed');
      }

      const d = await res.json();
      setUploadMsg(`Successfully indexed ${d.filename} into ${d.chunks} vector chunks.`);
      setUploadFile(null);
      fetchSourcesAndStats();
    } catch (err: any) {
      setUploadMsg(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!window.confirm(`Purge all vector embeddings for "${sourceId}"?`)) return;
    try {
      await fetch(resolveApiUrl(`/api/knowledge/sources/${encodeURIComponent(sourceId)}`), {
        method: 'DELETE'
      });
      fetchSourcesAndStats();
    } catch (err) {
      // non-fatal
    }
  };

  const docTypeOptions = [
    { id: 'entity', label: 'Entity Profiles', icon: Building2 },
    { id: 'signal', label: 'Market Signals', icon: Radio },
    { id: 'wiki', label: 'Company Wiki', icon: BookOpen },
    { id: 'upload', label: 'Uploaded Docs', icon: FileCheck }
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#020813] text-gray-200 p-6 lg:p-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-white/5 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#00ffca]/10 border border-[#00ffca]/20 text-[#00ffca]">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-wider text-white">
                Company Knowledge & Wiki (RAG)
              </h1>
              <p className="text-xs text-white/40 mt-0.5">
                Self-learning enterprise intelligence vector store and human-curated corporate wiki
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-black/40 p-1.5 rounded-xl border border-white/5">
          <button
            onClick={() => setTab('ask')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
              currentTab === 'ask'
                ? 'bg-[#00ffca] text-black shadow-[0_0_15px_rgba(0,255,202,0.3)]'
                : 'text-white/40 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Ask Intelligence
          </button>
          <button
            onClick={() => setTab('wiki')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
              currentTab === 'wiki'
                ? 'bg-[#00ffca] text-black shadow-[0_0_15px_rgba(0,255,202,0.3)]'
                : 'text-white/40 hover:text-white hover:bg-white/5'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Company Wiki
          </button>
          <button
            onClick={() => setTab('sources')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
              currentTab === 'sources'
                ? 'bg-[#00ffca] text-black shadow-[0_0_15px_rgba(0,255,202,0.3)]'
                : 'text-white/40 hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Source Inventory ({stats.total})
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* TAB 1: ASK INTELLIGENCE (RAG Q&A) */}
      {/* ------------------------------------------------------------- */}
      {currentTab === 'ask' && (
        <div className="mt-8 space-y-6">
          {/* Query Bar */}
          <div className="p-6 rounded-2xl bg-black/40 border border-white/5 backdrop-blur-xl shadow-2xl">
            <form onSubmit={handleAsk} className="space-y-4">
              <div className="relative">
                <input
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="Ask anything about a resolved company, directors, charges, or market signals..."
                  className="w-full pl-5 pr-36 py-4 bg-[#051124] border border-white/10 rounded-xl text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#00ffca] focus:ring-1 focus:ring-[#00ffca] transition-all"
                />
                <button
                  type="submit"
                  disabled={isAsking || !question.trim()}
                  className="absolute right-2.5 top-2.5 bottom-2.5 px-5 bg-[#00ffca] text-black font-bold uppercase tracking-wider text-xs rounded-lg flex items-center gap-2 hover:bg-[#00e5b5] disabled:opacity-50 transition-all shadow-[0_0_15px_rgba(0,255,202,0.2)]"
                >
                  {isAsking ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Thinking...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Synthesize
                    </>
                  )}
                </button>
              </div>

              {/* Filters & Options */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-white/40 font-mono uppercase text-[10px]">Filter Sources:</span>
                  {docTypeOptions.map(t => {
                    const active = selectedDocTypes.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setSelectedDocTypes(prev =>
                            active ? prev.filter(x => x !== t.id) : [...prev, t.id]
                          );
                        }}
                        className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] font-mono ${
                          active
                            ? 'bg-[#00ffca]/15 text-[#00ffca] border border-[#00ffca]/30'
                            : 'bg-white/5 text-white/40 hover:text-white/70 border border-transparent'
                        }`}
                      >
                        <t.icon className="w-3 h-3" />
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-white/40 font-mono uppercase text-[10px]">Scope to Entity ID:</span>
                  <input
                    type="text"
                    value={entityFilter}
                    onChange={e => setEntityFilter(e.target.value)}
                    placeholder="e.g. org_ent_... (optional)"
                    className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-md text-white/80 placeholder-white/20 text-xs w-44 focus:outline-none focus:border-[#00ffca]"
                  />
                </div>
              </div>
            </form>

            {/* Canned Prompt Suggestions */}
            <div className="mt-4 pt-4 border-t border-white/5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Quick Prompts:</span>
              {[
                'Who are the key directors and what charges exist on resolved companies?',
                'Which companies have open GeM bids or buyer requests?',
                'Summarize statutory registrations and active GST establishments.'
              ].map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setQuestion(prompt);
                  }}
                  className="px-2.5 py-1 rounded-full bg-white/[0.03] hover:bg-white/10 border border-white/5 text-[11px] text-white/60 transition-all text-left"
                >
                  "{prompt}"
                </button>
              ))}
            </div>
          </div>

          {/* Error Notice */}
          {askError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-3 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{askError}</span>
            </div>
          )}

          {/* Synthesis Output */}
          {ragResult && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Answer Column */}
              <div className="lg:col-span-2 space-y-4">
                <div className="p-6 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl space-y-4 shadow-xl">
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#00ffca]" />
                      <span className="text-xs font-bold uppercase tracking-wider text-white">
                        Synthesized Executive Intelligence
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          ragResult.confidence === 'HIGH'
                            ? 'bg-[#00ffca]/10 text-[#00ffca] border-[#00ffca]/30'
                            : ragResult.confidence === 'MEDIUM'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-red-500/10 text-red-400 border-red-500/30'
                        }`}
                      >
                        Confidence: {ragResult.confidence}
                      </span>
                      <span className="text-[10px] font-mono text-white/40">
                        {ragResult.tokensUsed} tokens
                      </span>
                    </div>
                  </div>

                  <div className="prose prose-invert max-w-none text-sm text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">
                    {ragResult.answer}
                  </div>
                </div>
              </div>

              {/* Citations & Evidence Column */}
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5">
                    <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-[#00ffca]" />
                      Grounded Citations ({ragResult.sources.length})
                    </span>
                  </div>

                  {ragResult.sources.length === 0 ? (
                    <p className="text-xs text-white/40 italic py-4 text-center">
                      No external document chunks cited.
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                      {ragResult.sources.map((src, idx) => (
                        <div
                          key={src.id || idx}
                          className="p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-[#00ffca]/30 transition-all space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-[#00ffca] font-bold">SOURCE #{idx + 1}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/40 uppercase">
                              {src.docType}
                            </span>
                          </div>
                          <p className="text-xs text-white/80 font-bold truncate">
                            {src.sourceId}
                          </p>
                          <p className="text-[11px] text-white/50 line-clamp-3 leading-relaxed">
                            {src.snippet}
                          </p>
                          {src.score > 0 && (
                            <div className="text-[9px] font-mono text-white/30 text-right">
                              Cosine Relevance: {(src.score * 100).toFixed(0)}%
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 2: COMPANY WIKI LAYER */}
      {/* ------------------------------------------------------------- */}
      {currentTab === 'wiki' && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Column: Wiki Directory */}
          <div className="lg:col-span-1 space-y-4">
            <div className="p-5 rounded-2xl bg-black/40 border border-white/5 backdrop-blur-xl space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-[#00ffca]" />
                Company Directory
              </span>

              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Enter Entity ID or CIN..."
                  value={wikiEntityId}
                  onChange={e => setWikiEntityId(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#00ffca]"
                />
                <button
                  type="button"
                  onClick={() => loadWikiPage(wikiEntityId)}
                  disabled={!wikiEntityId.trim() || wikiLoading}
                  className="w-full py-2 bg-[#00ffca]/10 border border-[#00ffca]/30 text-[#00ffca] text-xs font-bold uppercase rounded-lg hover:bg-[#00ffca]/20 transition-all flex items-center justify-center gap-2"
                >
                  {wikiLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  Open or Draft Wiki
                </button>
              </div>

              <div className="pt-3 border-t border-white/5 space-y-2">
                <span className="text-[10px] font-mono uppercase text-white/40 block">Saved Wiki Pages:</span>
                {wikiPagesList.length === 0 ? (
                  <p className="text-xs text-white/30 italic py-2">No wiki pages created yet.</p>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {wikiPagesList.map(wp => (
                      <button
                        key={wp.id}
                        type="button"
                        onClick={() => {
                          setWikiEntityId(wp.entity_id);
                          loadWikiPage(wp.entity_id);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs truncate transition-all flex items-center justify-between ${
                          wikiEntityId === wp.entity_id
                            ? 'bg-[#00ffca]/10 text-[#00ffca] border border-[#00ffca]/20'
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate">{wp.title}</span>
                        <span className="text-[9px] font-mono text-white/30">v{wp.version}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Center Column: Wiki Editor & Preview */}
          <div className="lg:col-span-3 space-y-4">
            <div className="p-6 rounded-2xl bg-black/40 border border-white/5 backdrop-blur-xl space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                <div className="flex-1">
                  <input
                    type="text"
                    value={wikiTitle}
                    onChange={e => setWikiTitle(e.target.value)}
                    placeholder="Company Page Title (e.g. Tata Motors Limited)"
                    className="w-full bg-transparent text-lg font-black uppercase tracking-wide text-white focus:outline-none border-b border-transparent focus:border-[#00ffca] pb-1"
                  />
                  <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-white/40">
                    <span>Entity ID: {wikiEntityId || 'None selected'}</span>
                    {wikiPage && <span>Version: v{wikiPage.version}</span>}
                    {wikiPage?.updated_at && (
                      <span>Updated: {new Date(wikiPage.updated_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/70 flex items-center gap-1.5 transition-all"
                  >
                    {showPreview ? <Edit3 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showPreview ? 'Edit' : 'Preview'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowHistory(!showHistory)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/70 flex items-center gap-1.5 transition-all"
                  >
                    <History className="w-3.5 h-3.5" />
                    Revisions ({wikiRevisions.length})
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveWiki}
                    disabled={wikiSaving || !wikiTitle.trim() || !wikiEntityId.trim()}
                    className="px-4 py-1.5 rounded-lg bg-[#00ffca] text-black font-bold text-xs uppercase tracking-wider hover:bg-[#00e5b5] disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-[0_0_15px_rgba(0,255,202,0.2)]"
                  >
                    {wikiSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Save & Index RAG
                  </button>
                </div>
              </div>

              {wikiSavedSuccess && (
                <div className="p-3 rounded-lg bg-[#00ffca]/10 border border-[#00ffca]/30 text-[#00ffca] text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Wiki page saved, revision snapshot created, and vector embeddings updated in RAG.
                </div>
              )}

              {/* Editor or Preview Pane */}
              {showPreview ? (
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 min-h-[400px] text-sm text-gray-200 leading-relaxed whitespace-pre-wrap font-sans">
                  {wikiBody || '(Empty document)'}
                </div>
              ) : (
                <textarea
                  value={wikiBody}
                  onChange={e => setWikiBody(e.target.value)}
                  placeholder="Enter markdown-formatted corporate intelligence, executive bios, ongoing legal disputes, or deal memos..."
                  rows={18}
                  className="w-full p-4 bg-[#051124] border border-white/10 rounded-xl font-mono text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00ffca] leading-relaxed resize-y"
                />
              )}

              {/* Revision History Drawer */}
              {showHistory && wikiRevisions.length > 0 && (
                <div className="p-4 rounded-xl bg-black/60 border border-white/10 space-y-2 mt-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-white block">
                    Version History Snapshot
                  </span>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {wikiRevisions.map(rev => (
                      <div
                        key={rev.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] text-xs font-mono"
                      >
                        <div>
                          <span className="text-[#00ffca] font-bold mr-2">v{rev.version}</span>
                          <span className="text-white/60">{rev.change_summary}</span>
                        </div>
                        <div className="text-[10px] text-white/40">
                          {new Date(rev.created_at).toLocaleString()} · {rev.char_count} chars
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 3: SOURCE INVENTORY & UPLOAD */}
      {/* ------------------------------------------------------------- */}
      {currentTab === 'sources' && (
        <div className="mt-8 space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="p-4 rounded-xl bg-black/40 border border-white/5 backdrop-blur-xl">
              <span className="text-[10px] font-black uppercase text-white/40 tracking-wider">Total Chunks</span>
              <p className="text-2xl font-black text-[#00ffca] mt-1">{stats.total}</p>
            </div>
            <div className="p-4 rounded-xl bg-black/40 border border-white/5 backdrop-blur-xl">
              <span className="text-[10px] font-black uppercase text-white/40 tracking-wider">Entity Records</span>
              <p className="text-2xl font-black text-white mt-1">{stats.entity}</p>
            </div>
            <div className="p-4 rounded-xl bg-black/40 border border-white/5 backdrop-blur-xl">
              <span className="text-[10px] font-black uppercase text-white/40 tracking-wider">Market Signals</span>
              <p className="text-2xl font-black text-white mt-1">{stats.signal}</p>
            </div>
            <div className="p-4 rounded-xl bg-black/40 border border-white/5 backdrop-blur-xl">
              <span className="text-[10px] font-black uppercase text-white/40 tracking-wider">Wiki Articles</span>
              <p className="text-2xl font-black text-white mt-1">{stats.wiki}</p>
            </div>
            <div className="p-4 rounded-xl bg-black/40 border border-white/5 backdrop-blur-xl">
              <span className="text-[10px] font-black uppercase text-white/40 tracking-wider">Document Uploads</span>
              <p className="text-2xl font-black text-white mt-1">{stats.upload}</p>
            </div>
          </div>

          {/* Document Ingestion Card */}
          <div className="p-6 rounded-2xl bg-black/40 border border-white/5 backdrop-blur-xl space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-[#00ffca]" />
              Ingest Document (PDF, Text, Markdown, CSV)
            </span>

            <form onSubmit={handleUpload} className="flex flex-col sm:flex-row items-center gap-4">
              <input
                type="file"
                accept=".pdf,.txt,.md,.csv,.json"
                onChange={e => setUploadFile(e.target.files ? e.target.files[0] : null)}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:uppercase file:bg-white/10 file:text-white hover:file:bg-white/20 text-xs text-white/60 w-full sm:w-auto"
              />
              <button
                type="submit"
                disabled={!uploadFile || uploading}
                className="px-5 py-2.5 bg-[#00ffca] text-black font-bold uppercase tracking-wider text-xs rounded-lg hover:bg-[#00e5b5] disabled:opacity-50 transition-all flex items-center gap-2 shrink-0"
              >
                {uploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                Chunk & Index
              </button>
            </form>

            {uploadMsg && (
              <p className="text-xs font-mono text-[#00ffca] bg-[#00ffca]/10 p-3 rounded-lg border border-[#00ffca]/20">
                {uploadMsg}
              </p>
            )}
          </div>

          {/* Sources Table */}
          <div className="p-6 rounded-2xl bg-black/40 border border-white/5 backdrop-blur-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-[#00ffca]" />
                Indexed Knowledge Sources ({sourcesList.length})
              </span>
              <button
                type="button"
                onClick={fetchSourcesAndStats}
                disabled={sourcesLoading}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${sourcesLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {sourcesList.length === 0 ? (
              <div className="py-12 text-center text-white/40 text-xs">
                No external sources indexed yet. Search and resolve companies in Entity Intel or upload documents above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] uppercase font-mono text-white/40">
                      <th className="pb-3 font-semibold">Source Identifier</th>
                      <th className="pb-3 font-semibold">Doc Type</th>
                      <th className="pb-3 font-semibold">Entity Link</th>
                      <th className="pb-3 font-semibold">Chunks</th>
                      <th className="pb-3 font-semibold">Last Ingested</th>
                      <th className="pb-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {sourcesList.map(src => (
                      <tr key={`${src.source_id}_${src.doc_type}`} className="hover:bg-white/[0.02]">
                        <td className="py-3 font-medium text-white max-w-xs truncate">
                          {src.source_id}
                        </td>
                        <td className="py-3 font-mono">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-white/70 uppercase">
                            {src.doc_type}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-white/40 text-[11px] truncate max-w-xs">
                          {src.entity_id || 'Global'}
                        </td>
                        <td className="py-3 font-mono text-[#00ffca] font-bold">
                          {src.chunk_count}
                        </td>
                        <td className="py-3 text-white/40 text-[11px]">
                          {new Date(src.last_updated).toLocaleDateString()}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteSource(src.source_id)}
                            className="p-1 text-white/30 hover:text-red-400 transition-colors"
                            title="Purge embeddings"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
