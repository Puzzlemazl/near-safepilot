"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useWallet } from "@/context/WalletContext";
import { 
  Send, ShieldCheck, Loader2, Activity, Terminal, Mic, MicOff, Zap, 
  ChevronLeft, Briefcase, CreditCard, X, ExternalLink, CheckCircle, Copy, AlertTriangle 
} from "lucide-react";
import { PoolOption, PortfolioItem as IPortfolioItem, TxStatus } from "./types";
import PoolCard from "@/components/PoolCard";
import PortfolioItem from "@/components/PortfolioItem";

export default function Home() {
  const { accountId, signIn, signOut, selector } = useWallet();
  const accountRef = useRef(accountId);

  useEffect(() => {
    accountRef.current = accountId;
  }, [accountId]);

  // UI State
  const [input, setInput] = useState("");
  const [fullResponseText, setFullResponseText] = useState(""); 
  const [displayedText, setDisplayedText] = useState("");       
  const [isTyping, setIsTyping] = useState(false);              
  const [isLoading, setIsLoading] = useState(false);            
  const [mounted, setMounted] = useState(false);
  const [isListening, setIsListening] = useState(false);        
  
  // Data State
  const [options, setOptions] = useState<PoolOption[] | null>(null);
  const [portfolio, setPortfolio] = useState<IPortfolioItem[] | null>(null);
  const [rawBalance, setRawBalance] = useState<string>("0");
  const [percent, setPercent] = useState(50);
  const [view, setView] = useState<"GREETING" | "STAKE" | "CABINET">("GREETING");
  const [logs, setLogs] = useState<string[]>(["[00:00:00] SYSTEM ONLINE"]);
  const [liveReward, setLiveReward] = useState(0);
  
  // Modals & Status
  const [isPingOpen, setIsPingOpen] = useState(false);
  const [txState, setTxState] = useState<{ status: TxStatus; msg: string }>({ status: "IDLE", msg: "" });

  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const hints = [
    { label: "SCAN_MARKET", cmd: "find yield markets" },
    { label: "OPEN_VAULT", cmd: "show cabinet" },
    { label: "STATUS", cmd: "system status" }
  ];

  const shortenAddress = (addr: string) => {
    if (!addr) return "UNKNOWN";
    if (addr.length < 20) return addr; 
    return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
  };

  const copyToClipboard = () => {
    if (accountId) {
      navigator.clipboard.writeText(accountId);
      addLog("SYSTEM: ID COPIED TO CLIPBOARD");
    }
  };

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 8));
  };

  // Chat & Data Fetching Logic
  const handleSendMessage = async (overrideMsg?: string) => {
    const currentAccount = accountRef.current;
    const msgToSend = overrideMsg || input;

    if (!msgToSend.trim() || isTyping || isLoading) return;
    if (!currentAccount) {
      addLog("ERROR: AUTH REQUIRED. PILOT NOT IDENTIFIED.");
      return;
    }

    setIsLoading(true);
    setFullResponseText(""); 
    setDisplayedText(""); 
    addLog(`OUTBOUND: ${msgToSend.toUpperCase()}`);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: msgToSend, accountId: currentAccount }),
        headers: { 
            "Content-Type": "application/json",
            "Cache-Control": "no-cache"
        },
        cache: "no-store"
      });
      
      const data = await res.json();
      
      if (data.options) setOptions(data.options);
      if (data.portfolio) setPortfolio(data.portfolio);
      if (data.rawBalance) setRawBalance(data.rawBalance);
      if (data.intent) setView(data.intent);

      if (msgToSend === "INITIALIZE_GREETING" || msgToSend.toLowerCase().includes("status") || msgToSend.toLowerCase().includes("balance")) {
          const currentBalance = parseFloat(data.rawBalance || rawBalance || "0") / 1e24;
          const currentStaked = (data.portfolio || portfolio || []).reduce((sum: number, item: any) => sum + parseFloat(item.amount), 0);
          
          
          let marketLine = "MARKET: [SYNCING NETWORK DATA...]";
          const marketMatch = data.text ? data.text.match(/MARKET:.*(?=\n|$)/i) : null;
          
          if (marketMatch) {
             marketLine = marketMatch[0];
          } else if (data.prices && data.prices.near > 0) {
             marketLine = `MARKET: BTC $${Math.round(data.prices.btc).toLocaleString()} | NEAR $${data.prices.near.toFixed(2)}.`;
          }

          const formattedText = `SYSTEMS ONLINE. PILOT:\n${shortenAddress(currentAccount)}\n${marketLine}\nLIQUID FUNDS: ${currentBalance.toFixed(2)} NEAR | STAKED: ${currentStaked.toFixed(4)} NEAR.\n\nAWAITING COMMAND.`;
          
          setFullResponseText(formattedText);
      } else {
          setFullResponseText(data.text || "SYSTEM ERROR: NO DATA STREAM.");
      }

      addLog(`INBOUND: ${data.intent || "UNKNOWN"}`);

    } catch (err: any) {
      setFullResponseText(`CRITICAL ERROR: CONNECTION LOST.`);
      addLog("ERROR: API UNREACHABLE");
    } finally {
      setIsLoading(false);
    }
  };

  // Transaction: Deploy (Stake)
  const executeAction = async (pool: PoolOption) => {
    if (!selector || !accountId) return;

    setTxState({ status: "PROCESSING", msg: "SIGNING TRANSACTION..." });
    addLog(`ACTION: DEPLOYING ASSETS TO ${pool.name.toUpperCase()}...`);

    try {
      const wallet = await selector.wallet();
      
      const totalYocto = BigInt(rawBalance) * BigInt(percent) / BigInt(100);
      const GAS_RESERVE = BigInt(5e22); // 0.05 NEAR
      let deposit = totalYocto;
      if (percent === 100 && deposit > GAS_RESERVE) {
          deposit = deposit - GAS_RESERVE;
      }

      const argsJson = {};
      const argsBytes = new TextEncoder().encode(JSON.stringify(argsJson));
      const argsArray = Array.from(argsBytes); 

      // Support for MyNearWallet direct calls if needed
      const directMNW = typeof window !== 'undefined' ? (window as any).myNearWallet : null;

      if (directMNW && wallet.id === "my-near-wallet") {
          addLog("DEBUG: DIRECT CONNECTION");
          await directMNW.signAndSendTransaction({
            receiverId: pool.contract,
            actions: [{
              type: "FunctionCall",
              params: {
                methodName: pool.method,
                args: argsJson,
                gas: "300000000000000",
                deposit: deposit.toString()
              }
            }]
          });
      } else {
          await wallet.signAndSendTransaction({
            signerId: accountId,
            receiverId: pool.contract,
            actions: [{
              functionCall: {
                methodName: pool.method,
                args: argsArray,
                gas: "300000000000000",
                deposit: deposit.toString()
              }
            } as any] 
          });
      }

      setTxState({ status: "SUCCESS", msg: "DEPLOYMENT CONFIRMED" });
      addLog("SUCCESS: ASSETS DEPLOYED.");
      setTimeout(() => handleSendMessage("system status"), 2500);

    } catch (err: any) {
      console.error("TX ERROR:", err);
      const errStr = JSON.stringify(err) + (err.message || "");
      if (errStr.includes("maybe executed") || errStr.includes("not found")) {
          setTxState({ status: "SUCCESS", msg: "TX BROADCASTED" });
          addLog("WARN: NETWORK SLOW, BUT TX LIKELY SENT.");
          return;
      }
      setTxState({ status: "ERROR", msg: "TRANSACTION FAILED" });
      addLog(`ERROR: ${err.message?.slice(0, 50)}`);
    }
  };

  // Transaction: Withdraw (Unstake)
  const executeWithdraw = async (item: IPortfolioItem) => {
    if (!selector || !accountId) return;

    setTxState({ status: "PROCESSING", msg: "INITIATING WITHDRAWAL..." });
    addLog(`ACTION: WITHDRAWING FROM ${item.name.toUpperCase()}...`);

    try {
      const wallet = await selector.wallet();

      
      const rawItem = item as any;
      let amountYocto = "0";

      if (rawItem.rawBalance) {
          amountYocto = rawItem.rawBalance;
      } else {
          // Fallback для безопасности
          amountYocto = (BigInt(Math.floor(parseFloat(item.amount) * 1e8)) * BigInt(1e16)).toString(); 
      }

      const argsJson = { amount: amountYocto };
      const argsBytes = new TextEncoder().encode(JSON.stringify(argsJson));
      const argsArray = Array.from(argsBytes);

      const directMNW = typeof window !== 'undefined' ? (window as any).myNearWallet : null;

      const actions = [{
        functionCall: {
          methodName: "unstake",
          args: argsArray,
          gas: "300000000000000",
          deposit: "0" 
        }
      } as any];

      
      if (directMNW && wallet.id === "my-near-wallet") {
          await directMNW.signAndSendTransaction({
            receiverId: item.contract,
            actions: [{
              type: "FunctionCall",
              params: {
                methodName: "unstake",
                args: argsJson,
                gas: "300000000000000",
                deposit: "0" 
              }
            }]
          });
      } else {
          await wallet.signAndSendTransaction({
            signerId: accountId,
            receiverId: item.contract,
            actions
          });
      }

      setTxState({ status: "SUCCESS", msg: "ASSETS RECALLED" });
      addLog("SUCCESS: WITHDRAWAL EXECUTED.");
      setTimeout(() => handleSendMessage("system status"), 2500);

    } catch (err: any) { 
        console.error("TX ERROR:", err);
        const errStr = JSON.stringify(err) + (err.message || "");
        if (errStr.includes("maybe executed")) {
            setTxState({ status: "SUCCESS", msg: "TX BROADCASTED" });
            return;
        }
        setTxState({ status: "ERROR", msg: "WITHDRAWAL FAILED" });
        addLog(`ERROR: ${err.message?.slice(0, 50)}`);
    }
  };

  // Setup Effects
  useEffect(() => {
    setMounted(true);
    // Speech Recognition Setup
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.lang = "en-US"; 
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        recognitionRef.current.onstart = () => {
          setIsListening(true);
          addLog("AUDIO: LISTENING CHANNEL OPEN...");
        };
        recognitionRef.current.onend = () => setIsListening(false);
        recognitionRef.current.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            addLog(`AUDIO: "${transcript}"`);
            setInput(transcript);
            setTimeout(() => handleSendMessage(transcript), 500);
          }
        };
      }
    }
  }, []); 

  // Typing effect
  useEffect(() => {
    if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    if (fullResponseText) {
      setIsTyping(true);
      setDisplayedText(""); 
      let charIndex = 0;
      typingTimerRef.current = setInterval(() => {
        setDisplayedText(fullResponseText.slice(0, charIndex + 1));
        charIndex++;
        if (charIndex >= fullResponseText.length) {
          if (typingTimerRef.current) clearInterval(typingTimerRef.current);
          setIsTyping(false);
        }
      }, 15); 
    } else {
      setDisplayedText("");
      setIsTyping(false);
    }
    return () => { if (typingTimerRef.current) clearInterval(typingTimerRef.current); };
  }, [fullResponseText]);

  // Live Reward Simulation
  const totalStaked = useMemo(() => portfolio?.reduce((sum, item) => sum + parseFloat(item.amount), 0) || 0, [portfolio]);
  useEffect(() => {
    if (totalStaked > 0 && accountId) {
      const STORAGE_KEY = `safepilot_mining_${accountId}`;
      let startTime = parseInt(localStorage.getItem(STORAGE_KEY) || "0");
      if (!startTime) {
        startTime = Date.now();
        localStorage.setItem(STORAGE_KEY, startTime.toString());
      }
      const rewardPerSecond = (totalStaked * 0.0912) / 31536000;
      const timer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        setLiveReward(elapsed * rewardPerSecond);
      }, 100);
      return () => clearInterval(timer);
    }
  }, [totalStaked, accountId]);

  // Init Greeting
  useEffect(() => {
    if (accountId && mounted && !fullResponseText && !isLoading && logs.length === 1) {
      const t = setTimeout(() => handleSendMessage("INITIALIZE_GREETING"), 800);
      return () => clearTimeout(t);
    }
  }, [accountId, mounted]);

  // Tx Toast Cleanup
  useEffect(() => {
    if (txState.status === "SUCCESS" || txState.status === "ERROR") {
      const timer = setTimeout(() => setTxState({ status: "IDLE", msg: "" }), 6000);
      return () => clearTimeout(timer);
    }
  }, [txState]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
        alert("Voice control not supported.");
        return;
    }
    if (isListening) recognitionRef.current.stop();
    else recognitionRef.current.start();
  };

  const pingUrl = `https://pingpay.io/?pilot_id=${accountId || ""}`;
  const openPingUplink = () => { setIsPingOpen(true); addLog("LOGISTICS: PING UPLINK ESTABLISHED"); };
  const closePing = () => { setIsPingOpen(false); addLog("LOGISTICS: CHANNEL CLOSED"); };

  if (!mounted) return null;

  return (
    <main className="min-h-screen bg-[#020617] text-slate-300 font-sans tracking-tight selection:bg-blue-500/30 overflow-x-hidden">
      
      {/* Background Grid */}
      <div className="fixed inset-0 opacity-[0.04] pointer-events-none z-0" 
           style={{ backgroundImage: 'linear-gradient(#4f46e5 1px, transparent 1px), linear-gradient(90deg, #4f46e5 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      {/* Navigation */}
      <nav className="border-b border-slate-800/60 bg-slate-950/60 backdrop-blur-xl h-16 flex items-center px-8 justify-between relative z-50">
        <div onClick={() => { if(accountId) setView("GREETING") }} className="flex items-center gap-2 cursor-pointer group hover:opacity-80 transition-opacity">
          <ShieldCheck className="text-blue-500 w-8 h-8 shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
          <span className="text-lg font-bold text-white font-mono uppercase tracking-tighter transition-all group-hover:tracking-normal group-hover:text-blue-400">SafePilot.sys</span>
        </div>
        {accountId && (
          <div className="flex items-center gap-6 font-mono text-[10px] font-bold uppercase tracking-widest">
            <button onClick={() => setView("CABINET")} className={`transition-all hover:text-white cursor-pointer ${view === "CABINET" ? "text-blue-400" : "text-slate-500"}`}>Cabinet</button>
            <button onClick={() => setView("STAKE")} className={`transition-all hover:text-white cursor-pointer ${view === "STAKE" ? "text-blue-400" : "text-slate-500"}`}>Scanner</button>
            <div className="h-4 w-px bg-slate-800"></div>
            
            <button 
                onClick={copyToClipboard}
                className="text-blue-500/70 lowercase font-medium cursor-pointer hover:text-blue-400 active:scale-95 transition-all flex items-center gap-2"
                title="Copy Address"
            >
                {shortenAddress(accountId)}
                <Copy size={10} className="opacity-50" />
            </button>

            <button onClick={signOut} className="hover:text-red-500 transition-colors ml-2 cursor-pointer">EXIT</button>
          </div>
        )}
      </nav>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto pt-10 px-6 grid grid-cols-1 lg:grid-cols-4 gap-8 relative z-10 h-[calc(100vh-100px)]">
        
        {/* Sidebar */}
        <div className="hidden lg:flex flex-col gap-6">
          <div className="space-y-2">
            <div className="text-[9px] font-mono font-bold text-slate-500 uppercase flex items-center gap-2 tracking-[0.3em]">
              <Activity size={12} className="text-blue-500" /> System Logs
            </div>
            <div className="bg-slate-950/80 border border-slate-800/50 rounded-xl p-4 font-mono text-[9px] space-y-2 text-slate-400 shadow-inner min-h-[200px] overflow-hidden">
              {logs.map((log, i) => (
                <div key={i} className={`truncate ${i === 0 ? "text-blue-400 animate-pulse" : "opacity-50"}`}>{log}</div>
              ))}
            </div>
          </div>

          {totalStaked > 0 && (
            <div className="bg-blue-900/10 border border-blue-500/20 rounded-2xl p-6 space-y-4 shadow-[0_0_30px_rgba(37,99,235,0.1)]">
              <div className="text-[9px] font-mono font-bold text-blue-400 uppercase flex items-center gap-2 tracking-[0.3em]">
                <Zap size={12} /> Live Yield
              </div>
              <div className="text-3xl font-mono font-bold text-white tabular-nums tracking-tighter">
                +{liveReward.toFixed(9)}<span className="text-xs text-blue-500 ml-1 font-sans">NEAR</span>
              </div>
            </div>
          )}
        </div>

        {/* Terminal Area */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div ref={chatContainerRef} className="bg-slate-900/40 border border-slate-800/80 rounded-[32px] shadow-2xl backdrop-blur-xl flex flex-col flex-1 relative overflow-hidden">
            {!accountId ? (
               <div className="flex-1 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-500">
                  <h1 className="text-7xl lg:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-600 mb-6 tracking-tighter uppercase font-mono italic">
                    Safe<span className="text-blue-600">Pilot</span>
                  </h1>
                  <button onClick={signIn} className="group relative bg-white text-black px-12 py-4 rounded-full font-mono text-xs font-bold uppercase tracking-[0.3em] shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:bg-blue-600 hover:text-white hover:shadow-[0_0_60px_rgba(37,99,235,0.6)] transition-all active:scale-95 cursor-pointer">
                    <span className="relative z-10">Establish Neural Link</span>
                  </button>
               </div>
            ) : (
               <>
                <div className="absolute top-0 left-0 right-0 p-8 flex justify-between items-start pointer-events-none z-20">
                    <div className="text-blue-500/30 font-mono text-[9px] font-bold uppercase tracking-[0.5em]">
                       SafePilot_v2.0 // Decrypted_Stream
                    </div>
                    {view !== "GREETING" && (
                      <button onClick={() => setView("GREETING")} className="pointer-events-auto flex items-center gap-2 text-[9px] font-mono font-bold uppercase text-slate-500 hover:text-blue-400 transition-all bg-slate-950/50 px-3 py-1 rounded-full border border-slate-800 cursor-pointer">
                        <ChevronLeft size={14} /> Return to Terminal
                      </button>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-10 sm:p-14 custom-scrollbar">
                    
                    <div className="mt-10 mb-10 min-h-[120px] transition-all duration-500 opacity-100">
                        {isLoading ? (
                            <div className="space-y-3 py-2 opacity-50">
                                <div className="h-2 bg-blue-500/20 rounded-full w-24 animate-pulse"></div>
                                <div className="flex items-center gap-3 text-blue-400/50 mt-4 font-mono text-[10px] font-bold tracking-[0.3em] animate-pulse">
                                    <Loader2 size={16} className="animate-spin" /> PROCESSING NEURAL REQUEST...
                                </div>
                            </div>
                        ) : (
                            <p className="text-lg md:text-xl text-slate-200 leading-relaxed font-mono font-medium tracking-wide whitespace-pre-wrap drop-shadow-md">
                                {displayedText}
                                {isTyping && <span className="inline-block w-2 h-5 bg-blue-500 ml-1 animate-pulse align-middle shadow-[0_0_10px_rgba(59,130,246,0.8)]"></span>}
                            </p>
                        )}
                    </div>

                    <div className={`transition-all duration-700 ${isTyping || isLoading ? "opacity-0 translate-y-10" : "opacity-100 translate-y-0"}`}>
                        
                        {view === "CABINET" && (
                            <div className="grid gap-4 animate-in slide-in-from-bottom-10 fade-in duration-500">
                                <div className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest px-2 flex items-center justify-between mb-2">
                                    <span className="flex items-center gap-2"><Briefcase size={12}/> Vault Assets</span>
                                    <button onClick={openPingUplink} className="flex items-center gap-1 text-emerald-500 hover:text-emerald-400 transition-colors cursor-pointer active:scale-95">
                                        <CreditCard size={10} /> ADD FUNDS
                                    </button>
                                </div>
                                {portfolio && portfolio.length > 0 ? portfolio.map((item, i) => (
                                    <PortfolioItem 
                                      key={i} 
                                      item={item} 
                                      index={i} 
                                      onWithdraw={executeWithdraw} 
                                    />
                                )) : (
                                    <div className="text-center py-20 border border-dashed border-slate-800 rounded-2xl flex flex-col items-center gap-4">
                                        <div className="text-slate-600 font-mono text-xs uppercase tracking-[0.2em]">No Active Nodes Found</div>
                                        <button onClick={openPingUplink} className="px-6 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/20 transition-all flex items-center gap-2 active:scale-95 cursor-pointer">
                                            <CreditCard size={12} /> Acquire Assets via Ping
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {view === "STAKE" && (
                            <div className="space-y-8 animate-in slide-in-from-bottom-10 fade-in duration-500">
                                <div className="bg-slate-950/50 p-8 rounded-3xl border border-blue-500/10 shadow-inner">
                                    <div className="flex justify-between items-end mb-8 font-mono text-white">
                                        <div>
                                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Deployment Size</div>
                                            <div className="text-4xl font-light text-white">{percent}%</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-blue-400 mb-1">Target Amount</div>
                                            <div className="text-xl font-bold text-blue-400">
                                                {/* ИСПРАВЛЕНИЕ: Визуальная синхронизация с реальным вычетом газа */}
                                                {(() => {
                                                    const total = parseFloat(rawBalance) / 1e24;
                                                    let amt = total * (percent / 100);
                                                    if (percent === 100 && amt > 0.05) amt -= 0.05;
                                                    return amt < 0 ? "0.00" : amt.toFixed(4);
                                                })()} N
                                            </div>
                                        </div>
                                    </div>
                                    <input 
                                        type="range" min="10" max="100" step="10" 
                                        value={percent} onChange={(e) => setPercent(parseInt(e.target.value))} 
                                        className="w-full h-2 bg-slate-800 rounded-full appearance-none accent-blue-600 cursor-pointer hover:accent-blue-500 transition-all" 
                                    />
                                </div>

                                <div className="grid gap-4">
                                    {options?.map((pool, i) => (
                                      <PoolCard 
                                        key={i} 
                                        pool={pool} 
                                        rawBalance={rawBalance} 
                                        percent={percent}
                                        onDeploy={executeAction}
                                        onResupply={openPingUplink}
                                      />
                                    ))}
                                </div>
                            </div>
                        )}

                        {view === "GREETING" && !isLoading && !isTyping && displayedText && (
                            <div className="mt-10 flex justify-center opacity-10 animate-pulse">
                                <Terminal size={64} strokeWidth={0.5} />
                            </div>
                        )}
                    </div>
                </div>

                {/* Input Area */}
                <div className="p-6 bg-slate-950/80 border-t border-slate-800/80 backdrop-blur-3xl rounded-b-[32px]">
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide mask-fade-right">
                        {hints.map((h, i) => (
                            <button key={i} onClick={() => handleSendMessage(h.cmd)} className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/50 text-[8px] font-mono font-bold text-slate-500 uppercase tracking-widest hover:border-blue-500/50 hover:text-blue-400 transition-all whitespace-nowrap active:scale-95 cursor-pointer">
                                {h.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative flex items-center gap-3">
                        <button 
                            onClick={toggleListening} 
                            className={`p-4 rounded-xl border transition-all duration-300 active:scale-90 cursor-pointer ${isListening ? "bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse" : "bg-slate-900 border-slate-800 text-slate-500 hover:text-white hover:border-slate-600"}`}
                        >
                            {isListening ? <Mic size={20} /> : <MicOff size={20} />}
                        </button>
                        
                        <div className="relative flex-1 group">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                                disabled={isTyping || isLoading}
                                placeholder={isTyping ? "INCOMING TRANSMISSION..." : "Input strategic command..."}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl py-4 px-6 pr-16 focus:border-blue-500/50 focus:bg-slate-900 text-white font-mono text-sm outline-none transition-all placeholder:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <button 
                                onClick={() => handleSendMessage()} 
                                disabled={!input || isTyping}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all active:scale-90 disabled:opacity-0 disabled:scale-50 shadow-lg cursor-pointer"
                            >
                                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            </button>
                        </div>
                    </div>
                </div>
               </>
            )}
          </div>
        </div>
      </div>

      {/* Ping Modal */}
      {isPingOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300 p-6">
          <div className="relative w-full max-w-2xl h-[80vh] bg-[#0f172a] border border-emerald-500/30 rounded-2xl shadow-[0_0_50px_rgba(16,185,129,0.2)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
               <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold uppercase tracking-widest">
                 <CreditCard size={14} /> Ping Logistics Uplink
               </div>
               <div className="flex items-center gap-2">
                 <a 
                    href={pingUrl} 
                    target="_blank" 
                    rel="noreferrer"
                    className="p-2 text-slate-500 hover:text-emerald-400 transition-colors cursor-pointer"
                    title="Open in new window"
                 >
                    <ExternalLink size={16} />
                 </a>
                 <button onClick={closePing} className="p-2 text-slate-500 hover:text-white transition-colors cursor-pointer">
                    <X size={16} />
                 </button>
               </div>
            </div>

            <div className="flex-1 relative bg-slate-900">
                <iframe src={pingUrl} className="w-full h-full border-0" title="Ping Payment Interface" allow="payment" />
                <div className="absolute inset-0 flex items-center justify-center -z-10 text-slate-700 font-mono text-xs">
                    CONNECTING TO SATELLITE...
                </div>
            </div>
            
            <div className="p-2 bg-slate-950 text-center flex justify-between px-6">
              <span className="text-[8px] text-slate-600 font-mono uppercase">Secure Channel: TLS_1.3</span>
              <span className="text-[8px] text-emerald-500/50 font-mono uppercase">Powered by NEAR Intents</span>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Status Toast */}
      {txState.status !== "IDLE" && (
        <div className="fixed top-24 right-6 z-[60] animate-in slide-in-from-right duration-300">
           <div className={`
              backdrop-blur-md border px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 min-w-[300px]
              ${txState.status === "PROCESSING" ? "bg-blue-900/40 border-blue-500/50 text-blue-100" : ""}
              ${txState.status === "SUCCESS" ? "bg-emerald-900/40 border-emerald-500/50 text-emerald-100" : ""}
              ${txState.status === "ERROR" ? "bg-red-900/40 border-red-500/50 text-red-100" : ""}
           `}>
              <div className={`p-2 rounded-full border ${
                  txState.status === "PROCESSING" ? "bg-blue-500/20 border-blue-500 animate-spin" :
                  txState.status === "SUCCESS" ? "bg-emerald-500/20 border-emerald-500" :
                  "bg-red-500/20 border-red-500"
              }`}>
                  {txState.status === "PROCESSING" && <Loader2 size={20} />}
                  {txState.status === "SUCCESS" && <CheckCircle size={20} />}
                  {txState.status === "ERROR" && <AlertTriangle size={20} />}
              </div>

              <div>
                  <div className="font-mono text-[10px] font-bold uppercase opacity-70 tracking-widest">
                    {txState.status === "PROCESSING" ? "BLOCKCHAIN OPERATION" : 
                     txState.status === "SUCCESS" ? "OPERATION SUCCESSFUL" : "OPERATION FAILED"}
                  </div>
                  <div className="font-bold font-mono text-xs uppercase mt-1">
                    {txState.msg}
                  </div>
              </div>
           </div>
        </div>
      )}
    </main>
  );
}
