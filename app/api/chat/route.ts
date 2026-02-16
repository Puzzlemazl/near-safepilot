import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
You are SafePilot.sys, a tactical DeFi interface for NEAR Protocol.
STYLE: Cyberpunk terminal, brief, robotic, military jargon.
INSTRUCTIONS:
1. If user asks about "balance", "wallet", "funds" -> "intent": "CABINET".
2. If user asks to "scan", "stake", "invest", "markets" -> "intent": "STAKE".
3. OUTPUT: JSON ONLY. Structure: { "text": "...", "intent": "..." }
`;

// Функция для получения цен из нескольких источников (Waterfall)
async function getMarketData() {
  // 1. Попытка через CoinGecko (самый стабильный для Vercel)
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=near,bitcoin&vs_currencies=usd", 
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.near?.usd && data.bitcoin?.usd) {
        return { near: data.near.usd, btc: data.bitcoin.usd };
      }
    }
  } catch (e) {
    console.warn("CoinGecko failed, switching to backup...");
  }

  // 2. Попытка через CoinCap (резервный, не требует API ключа)
  try {
    const res = await fetch(
      "https://api.coincap.io/v2/assets?ids=near-protocol,bitcoin", 
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const json = await res.json();
      const nearData = json.data.find((d: any) => d.id === "near-protocol");
      const btcData = json.data.find((d: any) => d.id === "bitcoin");
      
      if (nearData && btcData) {
        return { 
          near: parseFloat(nearData.priceUsd), 
          btc: parseFloat(btcData.priceUsd) 
        };
      }
    }
  } catch (e) {
    console.warn("CoinCap failed, switching to fallback...");
  }

  // 3. Fallback (Хардкод на случай ядерной войны)
  // Лучше обновить эти значения до актуальных на момент деплоя
  return { near: 3.25, btc: 96400 };
}

export async function POST(req: Request) {
  let detectedIntent = "GREETING";
  let nearAmount = "0.00"; 
  let rawBalance = "0";
  let portfolio: any[] = [];
  let options: any[] = [];
  let prices = { near: 0, btc: 0 };

  try {
    const body = await req.json();
    const { message, accountId } = body;
    const msgLower = message ? message.toLowerCase() : "";

    // Определение намерения
    if (msgLower.match(/stake|earn|yield|market|pool|invest|deploy|scan|find/)) detectedIntent = "STAKE";
    if (msgLower.match(/vault|cabinet|portfolio|asset|funds|balance|withdraw/)) detectedIntent = "CABINET";

    // 2. ПОЛУЧЕНИЕ КУРСОВ (ИСПРАВЛЕНО)
    prices = await getMarketData();

    // RPC helper
    const rpcCall = async (contract: string, method: string, args: any) => {
        try {
            const res = await fetch("https://rpc.mainnet.near.org", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    jsonrpc: "2.0", id: "safepilot", method: "query", 
                    params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } 
                })
            });
            const json = await res.json();
            if (json?.result?.result) return JSON.parse(Buffer.from(json.result.result).toString());
            return null;
        } catch (e) { return null; }
    };

    // 3. ПОРТФОЛИО
    if (accountId) {
      try {
        const accRes = await fetch("https://rpc.mainnet.near.org", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: "bal", method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } })
        });
        const accJson = await accRes.json();
        if (accJson?.result?.amount) {
            rawBalance = accJson.result.amount;
            nearAmount = (Number(rawBalance.slice(0, -18)) / 1000000).toFixed(2);
        }

        const protocols = [
            { id: "linear-protocol.near", name: "LiNEAR", rate: 1.15 },
            { id: "meta-pool.near", name: "MetaPool", rate: 1.18 },
            { id: "v2-nearx.stader-labs.near", name: "Stader", rate: 1.16 }
        ];

        for (const p of protocols) {
            const bal = await rpcCall(p.id, "ft_balance_of", { account_id: accountId });
            if (bal && parseFloat(bal) > 1000000) {
                const amt = (Number(bal.slice(0, -18)) / 1000000).toFixed(6);
                portfolio.push({ name: p.name, amount: amt, token: p.name, nearValue: (parseFloat(amt) * p.rate).toFixed(2), contract: p.id });
            }
        }
      } catch(e) { console.error("Portfolio check failed"); }
    }

    // 4. ПУЛЫ СТЕЙКИНГА
    options = [
        { id: "linear-stake", name: "LiNEAR", subName: "Liquid Staking", apy: "9.85%", min: 0.1, risk: "LOW", desc: "PROTOCOL: Top-tier liquid staking. Auto-compounding.", contract: "linear-protocol.near", method: "deposit_and_stake", isVerified: true },
        { id: "meta-stake", name: "META POOL", subName: "Liquid Staking", apy: "10.12%", min: 1.0, risk: "LOW", desc: "GOVERNANCE: Receive stNEAR. DAO voting rights.", contract: "meta-pool.near", method: "deposit_and_stake", isVerified: true },
        { id: "stader-stake", name: "STADER", subName: "NearX Yield", apy: "9.6%", min: 1.0, risk: "LOW", desc: "STRATEGY: Multi-validator architecture.", contract: "v2-nearx.stader-labs.near", method: "deposit_and_stake", isVerified: true }
    ];

    try {
        const refRes = await fetch("https://api.ref.finance/list-top-pools", { signal: AbortSignal.timeout(3000) });
        if (refRes.ok) {
            const allPools = await refRes.json();
            if (Array.isArray(allPools)) {
                allPools.filter((p: any) => Number(p?.tvl) > 500000).sort((a: any, b: any) => Number(b.tvl) - Number(a.tvl)).slice(0, 2).forEach((pool: any) => {
                    options.push({
                        id: `ref-${pool.id}`, name: "REF DEX", subName: pool.token_symbols?.join("-") || "ASSET", apy: `${pool.apy || "5"}%`, min: 0, risk: "MEDIUM",
                        desc: `MARKET DATA: TVL $${(Number(pool.tvl)/1000000).toFixed(1)}M. Requires wNEAR.`,
                        contract: "v2.ref-finance.near", method: "mft_transfer_call", isVerified: false 
                    });
                });
            }
        }
    } catch(e) { console.warn("Ref Finance API Slow or Offline"); }

    // 5. ОБРАБОТКА ПРИВЕТСТВИЯ
    if (message === "INITIALIZE_GREETING") {
       // Форматируем цены красиво
       const btcDisplay = Math.round(prices.btc).toLocaleString("en-US");
       const nearDisplay = prices.near.toFixed(2);
       
       const marketTicker = `MARKET: BTC $${btcDisplay} | NEAR $${nearDisplay}.`;
       return NextResponse.json({
         text: `SYSTEMS ONLINE. PILOT: ${accountId || "GUEST"}\n${marketTicker}\nLIQUID FUNDS: ${nearAmount} NEAR.\n\nAWAITING COMMAND.`,
         intent: "GREETING", options, portfolio, rawBalance
       });
    }

    // 6. AI ВЫЗОВ
    try {
        if (!process.env.GROQ_API_KEY) throw new Error("Missing AI Key");

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: SYSTEM_PROMPT }, 
              { role: "user", content: `Context: Wallet ${nearAmount} NEAR. Market: BTC ${prices.btc}, NEAR ${prices.near}. User Input: ${message}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2
          }),
        });

        const aiData = await groqRes.json();
        
        if (aiData && aiData.choices && aiData.choices.length > 0 && aiData.choices[0].message?.content) {
            const aiResponse = JSON.parse(aiData.choices[0].message.content);
            return NextResponse.json({ 
              ...aiResponse, 
              options, portfolio: portfolio.length > 0 ? portfolio : null, rawBalance 
            });
        } else {
            throw new Error("AI_INVALID_FORMAT");
        }

    } catch (aiError) {
        return NextResponse.json({ 
          text: `COMMAND ACKNOWLEDGED: ${detectedIntent === "STAKE" ? "SCANNING DEFI NODES..." : "ACCESSING CABINET..."}`,
          intent: detectedIntent,
          options, portfolio: portfolio.length > 0 ? portfolio : null, rawBalance 
        });
    }

  } catch (error: any) {
    console.error("GLOBAL CRITICAL ERROR:", error);
    return NextResponse.json({ 
        text: "SYSTEM CORE SECURED. COMMAND NOT RECOGNIZED.", 
        intent: "GREETING",
        options: [], portfolio: [], rawBalance: "0" 
    });
  }
}