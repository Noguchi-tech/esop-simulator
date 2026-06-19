#!/usr/bin/env node
/*
 * 良品計画（証券コード 7453 / Yahoo シンボル 7453.T）の
 * 株価と「直近12か月の配当合計（1株あたり）」を取得して data/quote.json を更新する。
 *
 * 特長：
 *  - APIキー不要（Yahoo Finance の公開 chart エンドポイントのみ使用）
 *  - 取得失敗時は既存の data/quote.json を維持（壊さない）
 *  - GitHub Actions 上で定期実行する想定（runner はインターネット接続可）
 *
 * ※ 公開リポジトリにシークレットを置く必要はありません。
 *    もし将来、キーが必要な有料データソースに切り替える場合でも、
 *    キーは GitHub の「Secrets」に置き、ここでは process.env から読むだけにします。
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "data", "quote.json");

const SYMBOL = "7453.T";
const NAME = "株式会社良品計画";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// 簡易リトライ
async function withRetry(fn, n = 3) {
  let err;
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw err;
}

async function main() {
  // range=2y で直近の配当イベント（events=div）と現値（meta）を1回で取得
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}` +
    `?range=2y&interval=1d&events=div`;

  const data = await withRetry(() => getJSON(url));
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("Unexpected response shape (no chart.result)");

  const meta = result.meta || {};
  const price = meta.regularMarketPrice ?? meta.previousClose;
  if (!Number.isFinite(price)) throw new Error("No usable price in meta");

  // 直近365日の配当を合計 → 年間配当（1株あたり）
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * 24 * 3600;
  const divs = result.events?.dividends || {};
  let annualDividend = 0;
  for (const k of Object.keys(divs)) {
    const d = divs[k];
    if (Number.isFinite(d?.amount) && Number(d.date) >= oneYearAgo) {
      annualDividend += d.amount;
    }
  }
  // 直近1年に配当イベントが無い場合は、既存値があれば踏襲
  if (annualDividend <= 0 && existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, "utf8"));
      if (Number.isFinite(prev.annualDividendPerShare)) {
        annualDividend = prev.annualDividendPerShare;
      }
    } catch {
      /* ignore */
    }
  }

  const out = {
    symbol: SYMBOL,
    name: NAME,
    currency: meta.currency || "JPY",
    price: Math.round(price * 100) / 100,
    annualDividendPerShare: Math.round(annualDividend * 100) / 100,
    dividendYield:
      price > 0 ? Math.round((annualDividend / price) * 10000) / 10000 : 0,
    asOf: new Date().toISOString().slice(0, 10),
    source: "Yahoo Finance (chart API, no key)",
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Updated quote.json:", JSON.stringify(out));
}

main().catch((e) => {
  // 失敗しても CI を赤くせず、既存ファイルを維持する
  console.error("fetch-quote failed (keeping existing data/quote.json):", e.message);
  process.exit(0);
});
