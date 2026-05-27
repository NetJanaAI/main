import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';

interface Job {
    jobId: string;
    domain: string;
    status: 'queued' | 'ingesting' | 'analyzing' | 'complete' | 'failed';
    logs: string[];
    startedAt: string;
}

interface JobMonitorProps {
    socket: any;
}

const statusConfig = {
    queued: { icon: Clock, color: 'text-yellow-400', label: 'Queued' },
    ingesting: { icon: Loader2, color: 'text-blue-400', label: 'Ingesting', spin: true },
    analyzing: { icon: Loader2, color: 'text-purple-400', label: 'Analyzing AI', spin: true },
    complete: { icon: CheckCircle, color: 'text-emerald-400', label: 'Complete' },
    failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
};

export const JobMonitor: React.FC<JobMonitorProps> = ({ socket }) => {
    const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
    const [expandedJob, setExpandedJob] = useState<string | null>(null);

    useEffect(() => {
        if (!socket) return;

        const handleLog = ({ jobId, message, type }: any) => {
            setJobs(prev => {
                const next = new Map(prev);
                const job = next.get(jobId);
                if (job) {
                    job.logs = [...job.logs.slice(-49), `[${type?.toUpperCase() || 'INFO'}] ${message}`];
                    job.status = message.includes('Adversarial') ? 'analyzing' : 'ingesting';
                    next.set(jobId, { ...job });
                }
                return next;
            });
        };

        const handleComplete = ({ jobId }: any) => {
            setJobs(prev => {
                const next = new Map(prev);
                const job = next.get(jobId);
                if (job) next.set(jobId, { ...job, status: 'complete' });
                return next;
            });
        };

        const handleError = ({ jobId }: any) => {
            setJobs(prev => {
                const next = new Map(prev);
                const job = next.get(jobId);
                if (job) next.set(jobId, { ...job, status: 'failed' });
                return next;
            });
        };

        socket.on('log', handleLog);
        socket.on('complete', handleComplete);
        socket.on('error', handleError);

        return () => {
            socket.off('log', handleLog);
            socket.off('complete', handleComplete);
            socket.off('error', handleError);
        };
    }, [socket]);


    const jobList = Array.from(jobs.values()).reverse();

    if (!jobList.length) return null;

    return (
        <div className="w-full mt-8 glass-panel p-6 border-primary/20 bg-primary/5">
            <div className="flex items-center gap-3 mb-5">
                <Activity className="w-4 h-4 text-primary animate-pulse" />
                <h3 className="text-[10px] font-black uppercase tracking-[3px] text-primary">Live Signal Ingress</h3>
                <span className="ml-auto institution-badge text-primary/60 border-primary/20 bg-primary/5">
                    {jobList.filter(j => j.status !== 'complete' && j.status !== 'failed').length} Active Nodes
                </span>
            </div>
            <div className="space-y-3">
                {jobList.map(job => {
                    const cfg = statusConfig[job.status];
                    const Icon = cfg.icon;
                    const isExpanded = expandedJob === job.jobId;

                    return (
                        <div key={job.jobId} className={`border rounded-xl transition-all duration-300 ${isExpanded ? 'border-primary/40 bg-primary/10' : 'border-white/5 bg-white/2 hover:border-primary/20'}`}>
                            <button
                                onClick={() => setExpandedJob(isExpanded ? null : job.jobId)}
                                className="w-full flex items-center gap-4 p-4 transition-colors"
                            >
                                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.color} ${(cfg as any).spin ? 'animate-spin' : ''}`} />
                                <span className="text-white/80 text-xs font-black uppercase tracking-widest flex-1 text-left truncate">{job.domain}</span>
                                <span className={`text-[10px] font-black uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
                                <span className="text-white/20 text-[10px] uppercase font-black tracking-tighter">{new Date(job.startedAt).toLocaleTimeString()}</span>
                            </button>
                            {isExpanded && job.logs.length > 0 && (
                                <div className="border-t border-primary/10 bg-black/40 p-5 font-mono text-[10px] text-white/40 max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
                                    {job.logs.map((log, i) => (
                                        <div key={i} className="leading-relaxed flex gap-3">
                                            <span className="text-primary/30 font-bold shrink-0">[{i+1}]</span>
                                            <span className="break-all">{log}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
