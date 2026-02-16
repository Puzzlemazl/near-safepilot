import { NextResponse } from "next/server";

// --- CONFIG ---
const SYSTEM_PROMPT = `
You are SafePilot.sys, a tactical DeFi interface for NEAR Protocol.
STYLE: Cyberpunk terminal, brief, robotic, military jargon.
INSTRUCTIONS:
1. If user asks about "balance", "wallet", "funds" -> "intent": "CABINET".
2. If user asks to "scan", "stake", "invest", "markets" -> "intent": "STAKE".
3. OUTPUT: JSON ONLY. Structure: { "text": "...", "intent": "..." }
`;

export async function POST(req: Request) {
  // 1. Инициализируем переменные заранее (Scope Fix)
  let detectedIntent = "GREETING";
  let options: any[] = [];
  let portfolio: any[] = [];
  let rawBalance = "0";
  let nearAmount = "0.00";
  let prices = { near: 0, btc: 0 };

  try {
    const body = await req.json();
    const { message, accountId } = body;
    const msgLower = message?.toLowerCase() || "";

    // Определение интента
    if (msgLower.match(/stake|earn|yield|market|pool|invest|deploy|scan|find/)) detectedIntent = "STAKE";
    if (msgLower.match(/vault|cabinet|portfolio|asset|funds|balance|withdraw/)) detectedIntent = "CABINET";

    // --- 2. MARKET DATA ---
    try {
      const [nearRes, btcRes] = await Promise.all([
        fetch("https://api.binance.com/api/v3/ticker/price?symbol=NEARUSDT"),
        fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
      ]);
      const [n, b] = await Promise.all([nearRes.json(), btcRes.json()]);
      prices = { near: parseFloat(n.price), btc: parseFloat(b.price) };
    } catch (e) { console.warn("Market Data Offline"); }

    // --- 3. RPC HELPER ---
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
            if (json.result?.result) return JSON.parse(Buffer.from(json.result.result).toString());
            return null;
        } catch (e) { return null; }
    };

    // --- 4. PORTFOLIO CHECK (HIGH PRECISION) ---
    if (accountId) {
      try {
        const accRes = await fetch("https://rpc.mainnet.near.org", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: "bal", method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } })
        });
        const accJson = await accRes.json();
        if (accJson.result?.amount) {
            rawBalance = accJson.result.amount;
            nearAmount = (Number(rawBalance.slice(0, -18)) / 1000000).toFixed(2);
        }

        // LiNEAR
        const linBal = await rpcCall("linear-protocol.near", "ft_balance_of", { account_id: accountId });
        if (linBal && parseFloat(linBal) > 1000000) {
            const amt = (Number(linBal.slice(0, -18)) / 1000000).toFixed(6);
            portfolio.push({ name: "LiNEAR", amount: amt, token: "LiNEAR", nearValue: (parseFloat(amt) * 1.15).toFixed(2), contract: "linear-protocol.near" });
        }

        // Meta Pool
        const metaBal = await rpcCall("meta-pool.near", "ft_balance_of", { account_id: accountId });
        if (metaBal && parseFloat(metaBal) > 1000000) {
            const amt = (Number(metaBal.slice(0, -18)) / 1000000).toFixed(6);
            portfolio.push({ name: "MetaPool", amount: amt, token: "stNEAR", nearValue: (parseFloat(amt) * 1.18).toFixed(2), contract: "meta-pool.near" });
        }

        // Stader
        const staderBal = await rpcCall("v2-nearx.stader-labs.near", "ft_balance_of", { account_id: accountId });
        if (staderBal && parseFloat(staderBal) > 1000000) {
            const amt = (Number(staderBal.slice(0, -18)) / 1000000).toFixed(6);
            portfolio.push({ name: "Stader", amount: amt, token: "NearX", nearValue: (parseFloat(amt) * 1.16).toFixed(2), contract: "v2-nearx.stader-labs.near" });
        }
      } catch(e) { console.error("Portfolio Scan Error"); }
    }

    // --- 5. DEFI SCANNER (OPTIONS) ---
    // A. LiNEAR (Dynamic APY)
    let linearAPY = "9.85%";
    try {
        const linData = await rpcCall("linear-protocol.near", "get_summary", {});
        if (linData?.apy) linearAPY = `${(parseFloat(linData.apy)*100).toFixed(2)}%`;
    } catch(e) {}

    options.push({
        id: "linear-stake", name: "LiNEAR", subName: "Liquid Staking", apy: linearAPY, min: 0.1, risk: "LOW",
        desc: "PROTOCOL: Top-tier liquid staking. Auto-compounding.",
        contract: "linear-protocol.near", method: "deposit_and_stake", isVerified: true
    });

    // B. META POOL
    options.push({
        id: "meta-stake", name: "META POOL", subName: "Liquid Staking", apy: "10.12%", min: 1.0, risk: "LOW",
        desc: "GOVERNANCE: Receive stNEAR. DAO voting rights.",
        contract: "meta-pool.near", method: "deposit_and_stake", isVerified: true
    });

    // C. STADER
    options.push({
        id: "stader-stake", name: "STADER", subName: "NearX Yield", apy: "9.6%", min: 1.0, risk: "LOW",
        desc: "STRATEGY: Multi-validator architecture. High security.",
        contract: "v2-nearx.stader-labs.near", method: "deposit_and_stake", isVerified: true
    });

    // D. REF FINANCE (Live API)
    try {
        const refRes = await fetch("https://api.ref.finance/list-top-pools");
        if (refRes.ok) {
            const allPools = await refRes.json();
            const topPools = allPools.filter((p: any) => Number(p.tvl) > 500000).sort((a: any, b: any) => Number(b.tvl) - Number(a.tvl)).slice(0, 3);
            topPools.forEach((pool: any) => {
                const tvl = Number(pool.tvl);
                const vol24 = Number(pool.vol24h);
                let calcApy = ((vol24 * 0.002 * 365) / tvl) * 100; 
                if (calcApy < 1) calcApy = Number(pool.apy);
                options.push({
                    id: `ref-${pool.id}`, name: "REF DEX", subName: pool.token_symbols.join("-"), apy: `${calcApy.toFixed(2)}%`, min: 0, risk: "MEDIUM",
                    desc: `MARKET DATA: TVL $${(tvl/1000000).toFixed(1)}M. Requires wNEAR.`,
                    contract: "v2.ref-finance.near", method: "mft_transfer_call", isVerified: false 
                });
            });
        }
    } catch(e) { console.warn("Ref Scan Fail"); }

    // --- 6. RESPONSE LOGIC ---
    if (message === "INITIALIZE_GREETING") {
       const marketTicker = `BTC $${Math.round(prices.btc).toLocaleString()} | NEAR $${prices.near.toFixed(2)}`;
       return NextResponse.json({
         text: `SYSTEMS ONLINE. PILOT: ${accountId || "GUEST"}\n${marketTicker}\nLIQUID FUNDS: ${nearAmount} NEAR.\n\nSCAN COMPLETE: ${options.length} HIGH-YIELD NODES DETECTED.`,
         intent: "GREETING",
         options, portfolio, rawBalance
       });
    }

    // AI Request (Safe Version)
    try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: SYSTEM_PROMPT }, 
              { role: "user", content: `Context: Wallet ${nearAmount} N. Options: ${options.map(o => o.name).join(", ")}. User Input: ${message}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2
          }),
        });

        const aiData = await groqRes.json();
        
        if (!aiData?.choices?.[0]?.message?.content) {
            throw new Error("AI Offline");
        }

        const aiResponse = JSON.parse(aiData.choices[0].message.content);

        return NextResponse.json({ 
          ...aiResponse, 
          options, 
          portfolio: portfolio.length > 0 ? portfolio : null, 
          rawBalance 
        });

    } catch (aiError) {
        console.error("AI Error Fallback triggered");
        return NextResponse.json({ 
          text: `COMMAND ACKNOWLEDGED: ${detectedIntent === "STAKE" ? "SCANNING DEFI NODES..." : "FETCHING CABINET DATA..."}`,
          intent: detectedIntent,
          options, 
          portfolio: portfolio.length > 0 ? portfolio : null, 
          rawBalance 
        });
    }

  } catch (error: any) {
    console.error("CRITICAL ERROR:", error);
    return NextResponse.json({ text: "SYSTEM ERROR: SCANNER FAILED.", intent: "GREETING" });
  }
}