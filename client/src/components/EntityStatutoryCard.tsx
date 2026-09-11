import React from 'react';
import {
  Building2,
  MapPin,
  Calendar,
  Users,
  Briefcase,
  Layers,
  ExternalLink,
} from 'lucide-react';

interface Director {
  din: string;
  name: string;
  designation: string;
  appointedDate?: string;
}

interface CompanyCharge {
  holderName: string;
  amount: number;
  creationDate?: string;
  status?: string;
}

interface Establishment {
  gstin: string;
  tradeName?: string;
  stateCode: string;
  stateName?: string;
  status?: string;
}

interface EntityStatutoryCardProps {
  entity: {
    entityId: string;
    canonicalName: string;
    cin?: string;
    pan?: string;
    companyStatus?: string;
    incorporationDate?: string;
    authorizedCapital?: number;
    paidUpCapital?: number;
    registeredAddress?: string;
    registeredState?: string;
    registeredPincode?: string;
    nicCode?: string;
    nicDescription?: string;
    directors?: Director[];
    charges?: CompanyCharge[];
    establishments?: Establishment[];
    groupHierarchy?: {
      parentCin?: string;
      parentName?: string;
      ultimateParentCin?: string;
      ultimateParentName?: string;
      subsidiaries?: Array<{ cin: string; name: string }>;
      associates?: Array<{ cin: string; name: string }>;
    };
    resolutionMethod?: string;
    enrichmentStatus?: string;
  };
  onSearchCin?: (cin: string) => void;
}

export const EntityStatutoryCard: React.FC<EntityStatutoryCardProps> = ({ entity, onSearchCin }) => {
  const statusColor = (status?: string) => {
    switch (status?.toUpperCase()) {
      case 'ACTIVE':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'UNDER_LIQUIDATION':
      case 'DISSOLVED':
      case 'STRIKE_OFF':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'INACTIVE':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      default:
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    }
  };

  const formatCurrency = (amt?: number) => {
    if (amt == null || isNaN(amt)) return '—';
    if (amt >= 10000000) {
      return `₹${(amt / 10000000).toFixed(2)} Cr`;
    }
    if (amt >= 100000) {
      return `₹${(amt / 100000).toFixed(2)} Lakh`;
    }
    return `₹${amt.toLocaleString('en-IN')}`;
  };

  return (
    <div className="flex flex-col gap-6 bg-[#030914] border border-white/10 rounded-xl p-6 shadow-2xl">
      {/* Header Profile */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-white/10">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-[#00ffca]/20 to-blue-500/10 border border-[#00ffca]/30 shrink-0">
            <Building2 className="w-8 h-8 text-[#00ffca]" />
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-black tracking-wide text-white uppercase">
                {entity.canonicalName}
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${statusColor(
                  entity.companyStatus
                )}`}
              >
                {entity.companyStatus || 'ACTIVE'}
              </span>
              <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-white/60">
                Method: {entity.resolutionMethod || 'EXACT_MATCH'}
              </span>
            </div>

            <div className="flex items-center gap-4 mt-2 flex-wrap text-xs text-white/50 font-mono">
              {entity.cin && (
                <div className="flex items-center gap-1.5">
                  <span className="text-white/30">CIN:</span>
                  <span className="text-white font-bold">{entity.cin}</span>
                </div>
              )}
              {entity.pan && (
                <div className="flex items-center gap-1.5">
                  <span className="text-white/30">PAN:</span>
                  <span className="text-amber-300 font-bold">{entity.pan}</span>
                </div>
              )}
              {entity.registeredState && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-white/40" />
                  <span>{entity.registeredState}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Capital Metric Quick Badges */}
        <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-white/10 pt-3 md:pt-0 md:pl-6">
          <div className="text-left">
            <span className="text-[10px] uppercase font-bold tracking-wider text-white/40 block">
              Paid-Up Capital
            </span>
            <span className="text-sm font-black text-[#00ffca] font-mono">
              {formatCurrency(entity.paidUpCapital)}
            </span>
          </div>
          <div className="text-left">
            <span className="text-[10px] uppercase font-bold tracking-wider text-white/40 block">
              Authorized Capital
            </span>
            <span className="text-sm font-black text-white/80 font-mono">
              {formatCurrency(entity.authorizedCapital)}
            </span>
          </div>
        </div>
      </div>

      {/* Statutory Grid Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Address Card */}
        <div className="p-4 rounded-lg bg-black/30 border border-white/5 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white/60 uppercase tracking-wider">
            <MapPin className="w-3.5 h-3.5 text-[#00ffca]" />
            <span>Registered Address</span>
          </div>
          <p className="text-xs text-white/80 leading-relaxed font-mono">
            {entity.registeredAddress || 'Registered address on file with MCA'}
          </p>
          {entity.registeredPincode && (
            <span className="text-[11px] text-white/40 font-mono">
              Pincode: {entity.registeredPincode}
            </span>
          )}
        </div>

        {/* Industry / NIC Card */}
        <div className="p-4 rounded-lg bg-black/30 border border-white/5 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white/60 uppercase tracking-wider">
            <Briefcase className="w-3.5 h-3.5 text-sky-400" />
            <span>Industry & NIC Classification</span>
          </div>
          <p className="text-xs text-white/80 font-mono">
            {entity.nicDescription || 'Manufacturing / Services / Commercial'}
          </p>
          {entity.nicCode && (
            <span className="text-[11px] text-white/40 font-mono">NIC Code: {entity.nicCode}</span>
          )}
        </div>

        {/* Key Statutory Dates */}
        <div className="p-4 rounded-lg bg-black/30 border border-white/5 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white/60 uppercase tracking-wider">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>Statutory Lifecycle</span>
          </div>
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-white/40">Incorporated:</span>
            <span className="text-white">{entity.incorporationDate || '—'}</span>
          </div>
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-white/40">ROC Jurisdiction:</span>
            <span className="text-white">{entity.registeredState || 'ROC India'}</span>
          </div>
        </div>
      </div>

      {/* Directors Governance Table */}
      {entity.directors && entity.directors.length > 0 && (
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
              <Users className="w-4 h-4 text-purple-400" />
              <span>Board of Directors & Governance ({entity.directors.length})</span>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-black/60 text-white/40 uppercase text-[10px] tracking-wider border-b border-white/10">
                <tr>
                  <th className="px-4 py-2.5">DIN</th>
                  <th className="px-4 py-2.5">Director Name</th>
                  <th className="px-4 py-2.5">Designation</th>
                  <th className="px-4 py-2.5">Appointed Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-black/20">
                {entity.directors.map((dir, idx) => (
                  <tr key={dir.din || idx} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 text-white/50">{dir.din || '—'}</td>
                    <td className="px-4 py-2.5 text-white font-medium">{dir.name}</td>
                    <td className="px-4 py-2.5 text-[#00ffca]">{dir.designation || 'Director'}</td>
                    <td className="px-4 py-2.5 text-white/50">{dir.appointedDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Corporate Hierarchy Summary */}
      {entity.groupHierarchy && (
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
            <Layers className="w-4 h-4 text-[#00ffca]" />
            <span>Affiliated Corporate Hierarchy</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {entity.groupHierarchy.ultimateParentName && (
              <div className="p-3 rounded-lg bg-black/30 border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-white/40 uppercase font-bold block">
                    Ultimate Parent
                  </span>
                  <span className="text-xs text-white font-medium">
                    {entity.groupHierarchy.ultimateParentName}
                  </span>
                  {entity.groupHierarchy.ultimateParentCin && (
                    <span className="text-[10px] font-mono text-white/40 block">
                      {entity.groupHierarchy.ultimateParentCin}
                    </span>
                  )}
                </div>
                {entity.groupHierarchy.ultimateParentCin && onSearchCin && (
                  <button
                    onClick={() => onSearchCin(entity.groupHierarchy!.ultimateParentCin!)}
                    className="p-1.5 rounded hover:bg-white/10 text-[#00ffca]"
                    title="Search this company"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {entity.groupHierarchy.parentName && (
              <div className="p-3 rounded-lg bg-black/30 border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-white/40 uppercase font-bold block">
                    Direct Parent
                  </span>
                  <span className="text-xs text-white font-medium">
                    {entity.groupHierarchy.parentName}
                  </span>
                  {entity.groupHierarchy.parentCin && (
                    <span className="text-[10px] font-mono text-white/40 block">
                      {entity.groupHierarchy.parentCin}
                    </span>
                  )}
                </div>
                {entity.groupHierarchy.parentCin && onSearchCin && (
                  <button
                    onClick={() => onSearchCin(entity.groupHierarchy!.parentCin!)}
                    className="p-1.5 rounded hover:bg-white/10 text-[#00ffca]"
                    title="Search this company"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default EntityStatutoryCard;
