import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
You are SafePilot.sys, a tactical DeFi interface for NEAR Protocol.
STYLE: Cyberpunk terminal, brief, robotic, military jargon.
INSTRUCTIONS:
1. If user asks about "balance", "wallet", "funds" -> "intent": "CABINET".
2. If user asks to "scan", "stake", "invest", "markets" -> "intent": "STAKE".
3. OUTPUT: JSON ONLY. Structure: { "text": "...", "intent": "..." }
`;

export async function POST(req: Request) {
  // 1. Инициализация всех переменных заранее (Scope Fix)
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

    // 2. БЕЗОПАСНЫЙ КУРС ВАЛЮТ (Binance часто блокирует Vercel)
    try {
      const nearRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=NEARUSDT", { next: { revalidate: 60 } });
      const btcRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", { next: { revalidate: 60 } });
      if (nearRes.ok && btcRes.ok) {
        const n = await nearRes.json();
        const b = await btcRes.json();
        prices = { 
            near: n.price ? parseFloat(n.price) : 3.25, 
            btc: b.price ? parseFloat(b.price) : 96000 
        };
      }
    } catch (e) { 
        console.warn("Binance blocked or offline, using fallback prices");
        prices = { near: 3.25, btc: 96400 }; 
    }

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

    // 3. ПОРТФОЛИО (БЕЗОПАСНО)
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

        // Чекаем протоколы (LiNEAR, Meta, Stader)
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

    // 4. ПУЛЫ СТЕЙКИНГА (СНАЧАЛА ЖЕСТКИЕ, ПОТОМ ДИНАМИЧЕСКИЕ)
    options = [
        { id: "linear-stake", name: "LiNEAR", subName: "Liquid Staking", apy: "9.85%", min: 0.1, risk: "LOW", desc: "PROTOCOL: Top-tier liquid staking. Auto-compounding.", contract: "linear-protocol.near", method: "deposit_and_stake", isVerified: true },
        { id: "meta-stake", name: "META POOL", subName: "Liquid Staking", apy: "10.12%", min: 1.0, risk: "LOW", desc: "GOVERNANCE: Receive stNEAR. DAO voting rights.", contract: "meta-pool.near", method: "deposit_and_stake", isVerified: true },
        { id: "stader-stake", name: "STADER", subName: "NearX Yield", apy: "9.6%", min: 1.0, risk: "LOW", desc: "STRATEGY: Multi-validator architecture.", contract: "v2-nearx.stader-labs.near", method: "deposit_and_stake", isVerified: true }
    ];

    // Добавляем Ref Finance только если он отвечает
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
       const marketTicker = `MARKET: BTC $${Math.round(prices.btc).toLocaleString()} | NEAR $${prices.near.toFixed(2)}.`;
       return NextResponse.json({
         text: `SYSTEMS ONLINE. PILOT: ${accountId || "GUEST"}\n${marketTicker}\nLIQUID FUNDS: ${nearAmount} NEAR.\n\nAWAITING COMMAND.`,
         intent: "GREETING", options, portfolio, rawBalance
       });
    }

    // 6. AI ВЫЗОВ (МАКСИМАЛЬНАЯ ЗАЩИТА)
    try {
        if (!process.env.GROQ_API_KEY) throw new Error("Missing AI Key");

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: SYSTEM_PROMPT }, 
              { role: "user", content: `Context: Wallet ${nearAmount} NEAR. User Input: ${message}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2
          }),
        });

        const aiData = await groqRes.json();
        
        // Проверяем choices[0] максимально глубоко
        if (aiData && aiData.choices && aiData.choices.length > 0 && aiData.choices[0].message?.content) {
            const aiResponse = JSON.parse(aiData.choices[0].message.content);
            return NextResponse.json({ 
              ...aiResponse, 
              options, portfolio: portfolio.length > 0 ? portfolio : null, rawBalance 
            });
        } else {
            console.error("AI returned strange data:", aiData);
            throw new Error("AI_INVALID_FORMAT");
        }

    } catch (aiError) {
        // Если AI упал - НЕ ПАДАЕМ, а возвращаем данные с заготовленным текстом
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