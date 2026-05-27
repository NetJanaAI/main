import React from 'react';
import { ShieldAlert, ShieldCheck, Scale, Zap } from 'lucide-react';

export interface VerityStep {
    role: 'advocate' | 'critic' | 'consensus';
    content: string;
    score?: number;
}

interface LogicDialogueProps {
    steps: VerityStep[];
}

export const LogicDialogue: React.FC<LogicDialogueProps> = ({ steps }) => {
    if (!steps || steps.length === 0) return null;

    return (
        <div className="mt-10 space-y-6">
            <div className="flex items-center gap-3">
                <Scale className="w-4 h-4 text-primary" />
                <h3 className="text-[10px] font-black uppercase tracking-[4px] text-white/40">Adversarial Logic Dialogue</h3>
            </div>

            <div className="space-y-4">
                {steps.map((step, i) => (
                    <div key={i} className={`p-6 glass-panel border-white/5 bg-white/[0.01] relative overflow-hidden transition-all duration-500
                        ${step.role === 'critic' ? 'border-primary/10 bg-primary/[0.01]' : ''}
                        ${step.role === 'consensus' ? 'border-primary/30 bg-primary/[0.05] shadow-[0_0_20px_rgba(0,255,202,0.05)]' : ''}`}>
                        
                        <div className="flex items-start gap-5">
                            <div className={`mt-1 shrink-0 p-2 rounded-lg bg-white/5 border border-white/5
                                ${step.role === 'advocate' ? 'text-white/40' : ''}
                                ${step.role === 'critic' ? 'text-primary/60' : ''}
                                ${step.role === 'consensus' ? 'text-primary' : ''}`}>
                                {step.role === 'advocate' && <ShieldCheck className="w-3.5 h-3.5" />}
                                {step.role === 'critic' && <ShieldAlert className="w-3.5 h-3.5" />}
                                {step.role === 'consensus' && <Zap className="w-3.5 h-3.5 animate-pulse" />}
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center justify-between mb-3">
                                    <span className={`text-[8px] font-black uppercase tracking-[3px] 
                                        ${step.role === 'advocate' ? 'text-white/30' : ''}
                                        ${step.role === 'critic' ? 'text-primary/40' : ''}
                                        ${step.role === 'consensus' ? 'text-primary' : ''}`}>
                                        {step.role === 'advocate' && 'Strategic Proposal'}
                                        {step.role === 'critic' && 'Adversarial Audit'}
                                        {step.role === 'consensus' && 'Sovereign Consensus'}
                                    </span>
                                    {step.score !== undefined && (
                                        <div className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded-md border border-white/5">
                                            <span className="text-[7px] font-black uppercase tracking-widest text-white/20">Alpha Index</span>
                                            <span className="text-[10px] font-black text-primary/80">{step.score}</span>
                                        </div>
                                    )}
                                </div>
                                <p className="text-[11px] text-white/60 font-sans italic leading-relaxed tracking-wide">
                                    "{step.content}"
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
