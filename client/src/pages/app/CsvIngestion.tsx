import React, { useState, useRef, useId } from 'react';
import { 
  UploadCloud, 
  FileSpreadsheet, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Building2, 
  Users, 
  RefreshCw, 
  Layers, 
  Sparkles,
  ArrowRight,
  Database,
  ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { resolveApiUrl } from '../../lib/api';

type IngestType = 'company' | 'employee' | 'unified';

interface PreviewData {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRowsEstimate: number;
  suggestedMapping: Record<string, string>;
  detectedType: IngestType;
}

interface IngestReport {
  totalRows: number;
  successCount: number;
  errorCount: number;
  updatedCount: number;
  createdCount: number;
  linkedEmployeesCount?: number;
  errors: Array<{ row: number; error: string; data?: any }>;
  durationMs: number;
}

const TARGET_FIELDS: Record<IngestType, Array<{ key: string; label: string; required?: boolean }>> = {
  company: [
    { key: 'canonicalName', label: 'Company Legal Name', required: true },
    { key: 'cin', label: 'Corporate CIN (21 chars)' },
    { key: 'pan', label: 'Company PAN' },
    { key: 'registeredState', label: 'State / Location' },
    { key: 'sector', label: 'Industry / NIC Sector' },
    { key: 'authorizedCapital', label: 'Authorized Capital (₹)' },
    { key: 'paidUpCapital', label: 'Paid-Up Capital (₹)' },
    { key: 'registeredAddress', label: 'Office Address' },
    { key: 'website', label: 'Website URL' },
    { key: 'phone', label: 'Official Phone' }
  ],
  employee: [
    { key: 'name', label: 'Employee / Executive Name', required: true },
    { key: 'designation', label: 'Title / Designation', required: true },
    { key: 'companyName', label: 'Company / Employer Name' },
    { key: 'cin', label: 'Employer CIN' },
    { key: 'email', label: 'Work Email Address' },
    { key: 'phone', label: 'Phone / Mobile' },
    { key: 'department', label: 'Department' },
    { key: 'linkedinUrl', label: 'LinkedIn Profile' }
  ],
  unified: [
    { key: 'canonicalName', label: 'Company Name', required: true },
    { key: 'cin', label: 'Company CIN' },
    { key: 'registeredState', label: 'State' },
    { key: 'sector', label: 'Sector' },
    { key: 'name', label: 'Contact Person Name' },
    { key: 'designation', label: 'Designation / Role' },
    { key: 'email', label: 'Work Email' },
    { key: 'phone', label: 'Phone' }
  ]
};

export default function CsvIngestion() {
  const [activeType, setActiveType] = useState<IngestType>('company');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [indexVector, setIndexVector] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [report, setReport] = useState<IngestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleSelectedFile = async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a valid .csv file.');
      return;
    }
    setFile(selectedFile);
    setError(null);
    setReport(null);
    setAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch(resolveApiUrl('/api/v1/ingest/csv/preview'), {
        method: 'POST',
        body: formData
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to inspect CSV file');
      }

      const data: PreviewData = json.data;
      setPreview(data);
      setActiveType(data.detectedType);

      // Invert suggested mapping for UI: csvHeader -> targetKey
      setColumnMapping(data.suggestedMapping || {});
    } catch (err: any) {
      console.error('[CSV Preview Error]', err);
      setError(err.message || 'Could not parse CSV');
      setFile(null);
      setPreview(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDownloadTemplate = (type: IngestType) => {
    window.open(resolveApiUrl(`/api/v1/ingest/csv/template/${type}`), '_blank');
  };

  const handleExecuteIngest = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', activeType);
      formData.append('indexVector', String(indexVector));
      formData.append('mapping', JSON.stringify(columnMapping));

      const res = await fetch(resolveApiUrl('/api/v1/ingest/csv/process'), {
        method: 'POST',
        body: formData
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Ingestion processing failed');
      }

      setReport(json.data);
    } catch (err: any) {
      console.error('[CSV Process Error]', err);
      setError(err.message || 'Error processing CSV rows');
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setReport(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#020813] text-gray-200 p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="p-2 rounded-lg bg-[#00ffca]/10 border border-[#00ffca]/20 text-[#00ffca]">
                <FileSpreadsheet className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-black uppercase tracking-wider text-white">
                CSV Ingestion Engine
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Live Importer
              </span>
            </div>
            <p className="text-xs text-white/50">
              Bulk ingest employee rosters, executive directories, and MCA company registries directly into the Intelligence Knowledge Graph & Vector Store.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => handleDownloadTemplate(activeType)}
              className="px-3 py-2 rounded-lg border border-white/10 hover:border-[#00ffca]/40 text-white/70 hover:text-white bg-white/5 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all"
            >
              <Download className="w-3.5 h-3.5 text-[#00ffca]" />
              Sample Template (.csv)
            </button>
          </div>
        </div>

        {/* Type Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setActiveType('company'); }}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all border ${
              activeType === 'company'
                ? 'bg-[#00ffca]/10 border-[#00ffca]/30 text-[#00ffca] shadow-[0_0_15px_rgba(0,255,202,0.1)]'
                : 'bg-white/[0.02] border-white/5 text-white/40 hover:text-white hover:bg-white/5'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Company Directory
          </button>

          <button
            onClick={() => { setActiveType('employee'); }}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all border ${
              activeType === 'employee'
                ? 'bg-[#00ffca]/10 border-[#00ffca]/30 text-[#00ffca] shadow-[0_0_15px_rgba(0,255,202,0.1)]'
                : 'bg-white/[0.02] border-white/5 text-white/40 hover:text-white hover:bg-white/5'
            }`}
          >
            <Users className="w-4 h-4" />
            Employee / Executive Roster
          </button>

          <button
            onClick={() => { setActiveType('unified'); }}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all border ${
              activeType === 'unified'
                ? 'bg-[#00ffca]/10 border-[#00ffca]/30 text-[#00ffca] shadow-[0_0_15px_rgba(0,255,202,0.1)]'
                : 'bg-white/[0.02] border-white/5 text-white/40 hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="w-4 h-4" />
            Unified Directory (Both)
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Ingestion Report Card */}
        {report && (
          <div className="p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </span>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-emerald-300">
                    Ingestion Successfully Completed
                  </h3>
                  <p className="text-[11px] text-white/40">
                    Processed {report.totalRows} rows in {(report.durationMs / 1000).toFixed(2)}s
                  </p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10"
              >
                Upload Another File
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Total Rows</span>
                <p className="text-xl font-black text-white mt-1">{report.totalRows}</p>
              </div>
              <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-emerald-400/80 tracking-wider">Created New</span>
                <p className="text-xl font-black text-emerald-400 mt-1">{report.createdCount}</p>
              </div>
              <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-cyan-400/80 tracking-wider">Updated Existing</span>
                <p className="text-xl font-black text-cyan-400 mt-1">{report.updatedCount}</p>
              </div>
              <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-indigo-400/80 tracking-wider">Employees Linked</span>
                <p className="text-xl font-black text-indigo-400 mt-1">{report.linkedEmployeesCount || 0}</p>
              </div>
            </div>

            {report.errors.length > 0 && (
              <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/10 space-y-2">
                <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider">
                  Skipped / Error Rows ({report.errors.length})
                </span>
                <div className="max-h-40 overflow-y-auto text-[11px] font-mono space-y-1">
                  {report.errors.map((e, idx) => (
                    <div key={idx} className="text-rose-300/80">
                      Row {e.row}: {e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Link
                to="/app/dossier"
                className="px-4 py-2 rounded-lg bg-[#00ffca]/10 text-[#00ffca] border border-[#00ffca]/30 hover:bg-[#00ffca]/20 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all"
              >
                Inspect in Company Dossier <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                to="/app/entities"
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all"
              >
                View in Entity Intelligence <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}

        {/* Upload Zone */}
        {!report && !preview && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-white/10 hover:border-[#00ffca]/40 rounded-2xl p-12 text-center bg-white/[0.01] hover:bg-[#00ffca]/[0.02] transition-all cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              id={fileInputId}
              type="file"
              ref={fileInputRef}
              onChange={(e) => e.target.files?.[0] && handleSelectedFile(e.target.files[0])}
              accept=".csv"
              className="hidden"
            />
            <div className="max-w-md mx-auto space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-[#00ffca]/10 border border-[#00ffca]/20 flex items-center justify-center text-[#00ffca] group-hover:scale-110 transition-transform">
                <UploadCloud className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  {analyzing ? 'Inspecting CSV Structure...' : 'Drop your CSV file here, or click to browse'}
                </h3>
                <p className="text-xs text-white/40 mt-1">
                  Supports company registries, executive directories, or combined contact rosters (up to 15MB).
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-white/50">
                <Sparkles className="w-3 h-3 text-[#00ffca]" />
                Auto-detects column names & data types
              </div>
            </div>
          </div>
        )}

        {/* Column Mapping & Preview State */}
        {preview && !report && (
          <div className="space-y-6">
            {/* File Summary Bar */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#00ffca]/10 text-[#00ffca]">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    {file?.name}
                  </h4>
                  <p className="text-[11px] text-white/40">
                    ~{preview.totalRowsEstimate} total rows detected • {preview.headers.length} columns found
                  </p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10"
              >
                Change File
              </button>
            </div>

            {/* Smart Column Mapping Card */}
            <div className="p-6 rounded-2xl bg-black/40 border border-white/5 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">
                    Smart Column Mapper
                  </h3>
                  <p className="text-xs text-white/40 mt-0.5">
                    Verify how your CSV columns map to NetJana data fields.
                  </p>
                </div>
                <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Mode: {activeType.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {TARGET_FIELDS[activeType].map(target => {
                  // Find which csv column is currently mapped to this target
                  const currentMappedCsvCol = Object.keys(columnMapping).find(
                    csvCol => columnMapping[csvCol] === target.key
                  ) || '';

                  return (
                    <div key={target.key} className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-white/80">
                          {target.label} {target.required && <span className="text-rose-400">*</span>}
                        </label>
                        {currentMappedCsvCol && (
                          <span className="text-[9px] font-black uppercase text-[#00ffca] bg-[#00ffca]/10 px-1.5 py-0.5 rounded">
                            Matched
                          </span>
                        )}
                      </div>
                      <select
                        aria-label={target.label}
                        value={currentMappedCsvCol}
                        onChange={(e) => {
                          const selectedCol = e.target.value;
                          const newMap = { ...columnMapping };
                          // Clear previous mapping for this target
                          for (const k of Object.keys(newMap)) {
                            if (newMap[k] === target.key) delete newMap[k];
                          }
                          if (selectedCol) {
                            newMap[selectedCol] = target.key;
                          }
                          setColumnMapping(newMap);
                        }}
                        className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#00ffca]/50"
                      >
                        <option value="">-- Do Not Map / Ignore --</option>
                        {preview.headers.map(h => (
                          <option key={h} value={h}>
                            CSV Column: "{h}"
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {/* Ingestion Settings */}
              <div className="pt-4 border-t border-white/5 flex flex-wrap items-center justify-between gap-4">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={indexVector}
                    onChange={(e) => setIndexVector(e.target.checked)}
                    className="rounded border-white/20 bg-black/40 text-[#00ffca] focus:ring-0 w-4 h-4 cursor-pointer"
                  />
                  <span>
                    Auto-Index in <strong>RAG Vector Store</strong> for instant AI Natural Language Search & Q&A
                  </span>
                </label>

                <button
                  onClick={handleExecuteIngest}
                  disabled={processing}
                  className="px-6 py-2.5 rounded-lg bg-[#00ffca] text-black font-black uppercase text-xs tracking-wider hover:bg-[#00ffca]/90 flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(0,255,202,0.3)] disabled:opacity-50"
                >
                  {processing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Ingesting & Triangulating...
                    </>
                  ) : (
                    <>
                      <Database className="w-4 h-4" />
                      Execute Ingestion ({preview.totalRowsEstimate} rows)
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Live Data Preview Table */}
            <div className="p-6 rounded-2xl bg-black/40 border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-white/80">
                  Data Preview (First 5 Rows)
                </h4>
                <span className="text-[10px] text-white/40">
                  Showing raw CSV rows
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-white/70">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-white/40">
                      {preview.headers.map(h => (
                        <th key={h} className="py-2.5 px-3">
                          {h}
                          {columnMapping[h] && (
                            <span className="block text-[9px] text-[#00ffca] font-normal lowercase">
                              → {columnMapping[h]}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                    {preview.sampleRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        {preview.headers.map(h => (
                          <td key={h} className="py-2.5 px-3 whitespace-nowrap text-white/80">
                            {row[h] || <span className="text-white/20">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
