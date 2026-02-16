"use client"; // Добавлено, так как есть интерактивность (onClick)

import { 
  Landmark, Activity, TrendingUp, AlertTriangle, ArrowDownCircle, CreditCard, Lock 
} from "lucide-react";
import { PoolOption } from "@/app/types";

interface PoolCardProps {
  pool: PoolOption;
  rawBalance: string;
  percent: number;
  onDeploy: (pool: PoolOption) => void;
  onResupply: () => void;
}

export default function PoolCard({ pool, rawBalance, percent, onDeploy, onResupply }: PoolCardProps) {
  // 1. Безопасный расчет ставки
  const balanceNum = parseFloat(rawBalance || "0") / 1e24;
  const currentStakeAmount = balanceNum * (percent / 100);

  // 2. Исправление ошибки сравнения (приводим pool.min к числу)
  const minAmount = Number(pool.min || 0);
  const tooSmall = !!pool.isVerified && currentStakeAmount < minAmount;
  
  // Цветовая схема риска
  const riskColor = pool.risk === "LOW" 
    ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" 
    : "text-amber-400 border-amber-400/30 bg-amber-400/10";

  // Стили карточки
  const cardStyle = pool.isVerified 
    ? "bg-slate-950/40 border-slate-800 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/10" 
    : "bg-slate-950/20 border-slate-800/50 opacity-70 hover:opacity-100 hover:border-slate-700"; 

  return (
    <div className={`relative p-6 rounded-[24px] border transition-all duration-300 group overflow-hidden ${cardStyle}`}>
      
      {/* Фон-предупреждение, если сумма меньше минимума */}
      {tooSmall && (
        <div className="absolute inset-0 bg-red-950/10 pointer-events-none z-0"></div>
      )}

      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="flex items-start gap-5">
          {/* Иконка пула */}
          <div className={`p-4 rounded-2xl border transition-colors ${pool.isVerified ? "bg-slate-900 border-slate-800 text-blue-500 group-hover:border-blue-500/30" : "bg-slate-900/50 border-slate-800 text-slate-600"}`}>
            {pool.isVerified ? <Landmark size={24} /> : <Activity size={24} />}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h4 className={`text-lg font-bold tracking-widest uppercase font-mono italic ${tooSmall ? "text-slate-500" : "text-white"}`}>
                {pool.name} <span className="text-xs text-slate-500 not-italic">{pool.subName}</span>
              </h4>
              <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold border ${riskColor}`}>
                {pool.risk}
              </span>
              {!pool.isVerified && (
                <span className="px-2 py-0.5 rounded text-[8px] font-mono font-bold border border-slate-700 text-slate-500">
                  READ ONLY
                </span>
              )}
            </div>
            
            <div className="text-[10px] font-mono uppercase text-slate-500 max-w-[280px] leading-relaxed">
              {pool.desc}
            </div>

            <div className="flex items-center gap-4 mt-2">
              <div className={`text-[10px] font-bold font-mono uppercase flex items-center gap-2 ${tooSmall ? "text-slate-600" : "text-emerald-500"}`}>
                <TrendingUp size={12}/> APY: {pool.apy} 
              </div>
              
              {tooSmall && (
                <div className="flex items-center gap-1 text-[10px] font-bold font-mono uppercase text-red-500 animate-pulse bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                  <AlertTriangle size={10} />
                  MIN REQ: {pool.min} NEAR
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Кнопки действий */}
        <div className="flex flex-col items-end gap-2 h-full justify-center min-w-[120px]">
          {pool.isVerified ? (
            <>
              <button 
                onClick={() => !tooSmall && onDeploy(pool)} 
                disabled={tooSmall}
                className={`w-full px-6 py-3 rounded-lg font-mono text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2
                  ${tooSmall 
                    ? "bg-slate-900 text-slate-600 cursor-not-allowed border border-slate-800 opacity-50" 
                    : "bg-white text-black hover:bg-blue-600 hover:text-white active:scale-95 cursor-pointer"
                  }`}
              >
                {tooSmall ? "LOCKED" : "DEPLOY"}
                {!tooSmall && <ArrowDownCircle size={14} className="-rotate-90" />}
              </button>

              {tooSmall && (
                <button 
                  onClick={onResupply}
                  className="w-full px-4 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 font-mono text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                >
                  <CreditCard size={12} />
                  RESUPPLY
                </button>
              )}
            </>
          ) : (
            <div className="px-4 py-3 rounded-lg border border-slate-800 bg-slate-900/30 text-slate-600 font-mono text-[10px] font-bold uppercase tracking-widest cursor-not-allowed flex items-center gap-2">
              <Lock size={12} />
              DETECTED
            </div>
          )}
        </div>
      </div>
    </div>
  );
}