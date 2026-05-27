import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import type { RegistrySignalResult } from '../types';
import { api } from '../lib/api';

interface KnowledgeCenterProps {
    onUploadSuccess?: (data: RegistrySignalResult) => void;
}

export const KnowledgeCenter: React.FC<KnowledgeCenterProps> = ({ onUploadSuccess }) => {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setStatus(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploading(true);
        setStatus(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('jobId', 'global_rag');

        try {
            const response = await api.postForm('/api/knowledge/upload', formData);
            const data = await response.json();

            if (response.ok) {
                setStatus({ type: 'success', message: `Doc ingested: ${data.chunks} semantic chunks indexed.` });
                setFile(null);
                if (onUploadSuccess) onUploadSuccess(data);
            } else {
                throw new Error(data.error || 'Upload failed');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setStatus({ type: 'error', message: message });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="glass-panel p-6 border-primary/20 bg-primary/5">
            <h2 className="text-[10px] font-black uppercase tracking-[3px] text-primary mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Knowledge Ingress
            </h2>
            <p className="text-white/40 text-[10px] uppercase tracking-widest leading-relaxed mb-6">
                Upload PDFs or Text files to ground the AI's "Sovereign Alpha" logic for better RAG results.
            </p>

            <div className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all duration-300 ${file ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-primary/40'}`}>
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    onChange={handleFileChange}
                    accept=".pdf,.txt"
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                    <Upload className={`w-8 h-8 mb-3 transition-colors ${file ? 'text-primary' : 'text-white/20'}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/60 text-center">
                        {file ? file.name : 'Select PDF or Text document'}
                    </span>
                    <span className="text-[8px] text-white/20 uppercase tracking-widest mt-2">Max 10MB per file</span>
                </label>
            </div>

            {file && (
                <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="w-full mt-4 py-3 bg-primary text-black font-black uppercase tracking-[4px] text-[10px] rounded-lg hover:bg-primary/80 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {uploading ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Ingesting Alpha...
                        </>
                    ) : (
                        <>Ingest Into Sovereign RAG</>
                    )}
                </button>
            )}

            {status && (
                <div className={`mt-4 p-3 rounded-lg flex items-start gap-3 ${status.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                    {status.type === 'success' ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-tight">{status.message}</span>
                </div>
            )}
        </div>
    );
};
