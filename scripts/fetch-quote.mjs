#!/usr/bin/env node
/*
 * 良品計画（証券コード 7453 / Yahoo シンボル 7453.T）の
 *  - 株価：Yahoo Finance chart API（キー不要）
 *  - 年間配当：会社予想ベースの forward 配当（Yahoo Finance quoteSummary の dividendRate / キー不要・crumb方式）
 * を取得して data/quote.json を更新する。
 *
 * 重要：
 *  - 配当は「会社予想（forward）の年間配当」を優先する。
 *    良品計画は中間・期末の2回配当のため、「直近12か月の支払い合算」は
 *    決算期をまたいで混ざり（例：前期末14円＋今期中間16円＝30円）、IR予想（例：32円）と一致しない。
 *    そこで forward 値を使い、取得できない場合は既存 quote.json の配当値を維持して
 *    誤った実績合算で上書きしないようにする。
 *  - 取得失敗時は既存ファイルを維持（CIは赤くしない）。
 *  - APIキー不要。公開リポジトリにシークレットは置かない。
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
// 自動取得に失敗した場合の既定（IR予想・2026年8月期）。IR改定時はここ／data/quote.json を更新。
const DEFAULT_DIVIDEND = 32;

function readExisting() {
  try { return JSON.parse(readFileSync(OUT, "utf8")); } catch { return {}; }
}

async function getJSON(url, headers) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...(headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function withRetry(fn, n = 3) {
  let err;
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) { err = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw err;
}

async function getPrice() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}?range=5d&interval=1d`;
  const data = await withRetry(() => getJSON(url));
  const meta = data?.chart?.result?.[0]?.meta || {};
  const price = meta.regularMarketPrice ?? meta.previousClose;
  if (!Number.isFinite(price)) throw new Error("No usable price in meta");
  return { price: Math.round(price * 100) / 100, currency: meta.currency || "JPY" };
}

// Yahoo の cookie + crumb を取得（quoteSummary に必要）
async function getCrumb() {
  const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const setCookies = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("no cookie from fc.yahoo.com");
  const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("no crumb");
  return { cookie, crumb };
}

// 会社予想ベースの forward 年間配当（dividendRate）を取得
async function getForecastDividend() {
  const { cookie, crumb } = await getCrumb();
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${SYMBOL}` +
    `?modules=summaryDetail&crumb=${encodeURIComponent(crumb)}`;
  const data = await getJSON(url, { Cookie: cookie });
  const sd = data?.quoteSummary?.result?.[0]?.summaryDetail || {};
  const fwd = sd.dividendRate?.raw;                 // forward（予想）年間配当
  const trailing = sd.trailingAnnualDividendRate?.raw;
  console.log("summaryDetail.dividendRate(forward)=", fwd, " trailingAnnualDividendRate=", trailing);
  return Number.isFinite(fwd) ? fwd : null;
}

async function main() {
  const prev = readExisting();
  const { price, currency } = await getPrice();

  // 配当：forward（予想）を優先。取れなければ既存値を維持し、無ければ既定（IR予想）。
  let dividend = Number.isFinite(prev.annualDividendPerShare) ? prev.annualDividendPerShare : DEFAULT_DIVIDEND;
  let dividendSource = prev.dividendSource || "IR予想（既定値）";
  try {
    const fwd = await withRetry(getForecastDividend, 2);
    if (Number.isFinite(fwd) && fwd > 0 && fwd < 300) {
      dividend = Math.round(fwd * 100) / 100;
      dividendSource = "Yahoo Finance 予想配当(forward dividendRate)";
    } else {
      console.error("forward dividend not available; keep existing value", dividend);
    }
  } catch (e) {
    console.error("forecast dividend fetch failed; keep existing value:", e.message);
  }

  const out = {
    symbol: SYMBOL,
    name: NAME,
    currency,
    price,
    annualDividendPerShare: dividend,
    dividendYield: price > 0 ? Math.round((dividend / price) * 10000) / 10000 : 0,
    asOf: new Date().toISOString().slice(0, 10),
    source: "Yahoo Finance (price, no key)",
    dividendSource,
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
