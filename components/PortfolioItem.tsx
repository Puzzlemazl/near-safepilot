import { ArrowDownCircle } from "lucide-react";
import { PortfolioItem as IPortfolioItem } from "@/app/types"; 

interface PortfolioItemProps {
  item: IPortfolioItem; 
  index: number;
  onWithdraw: (item: IPortfolioItem) => void;
}

export default function PortfolioItem({ item, index, onWithdraw }: PortfolioItemProps) {
  return (
    <div className="bg-slate-950/40 border border-slate-800 p-8 rounded-[24px] flex justify-between items-center group hover:border-blue-500/40 transition-all shadow-lg">
      <div>
        <div className="text-[8px] font-mono text-blue-500 font-black uppercase mb-2 tracking-[0.3em]">
          Node // 0{index + 1}
        </div>
        <h4 className="text-4xl font-light text-white tracking-tighter font-mono">
          {item.amount} <span className="text-lg text-slate-500 font-sans">{item.token}</span>
        </h4>
        <p className="text-[10px] text-slate-500 font-mono uppercase mt-3 tracking-widest font-bold text-blue-500/60">
          ≈ {item.nearValue} NEAR
        </p>
      </div>
      <button 
        onClick={() => onWithdraw(item)} 
        className="p-4 bg-slate-900 text-slate-500 hover:text-red-400 border border-slate-800 rounded-xl transition-all active:scale-90 hover:shadow-[0_0_20px_rgba(239,68,68,0.2)] cursor-pointer"
      >
        <ArrowDownCircle size={24}/>
      </button>
    </div>
  );
}