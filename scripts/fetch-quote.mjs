#!/usr/bin/env node
/*
 * 良品計画（証券コード 7453 / Yahoo シンボル 7453.T）の market データ更新スクリプト。
 *
 *  - 株価：Yahoo Finance chart API（キー不要）で自動更新する。
 *  - 年間配当：会社予想（IR）の値を data/quote.json に保持する（自動上書きしない）。
 *
 * なぜ配当は自動取得しないのか：
 *  無料・APIキー不要で「会社予想（forward）の年間配当」を確実に取得できる先が無い。
 *  実測（GitHub Actions 上）で Yahoo の summaryDetail.dividendRate（forward）は未提供、
 *  trailingAnnualDividendRate は決算期跨ぎ/調整値で実態とズレる（例：18.2 や 30 など）。
 *  配当の一次情報は会社の IR（決算短信の配当予想）であり、改定は年に数回のみ。
 *  そこで「正しい予想値」を data/quote.json に保持し、株価だけを自動更新する。
 *
 *  IR が配当予想を改定したら、data/quote.json の annualDividendPerShare（または
 *  下の DEFAULT_DIVIDEND）を更新するか、アプリの「配当金の設定」で手入力上書きしてください。
 *
 * APIキーは不要。公開リポジトリにシークレットは置かない。
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "data", "quote.json");

const SYMBOL = "7453.T";
const NAME = "株式会社良品計画";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// IR予想の年間配当（2026年8月期 予想）。IR改定時にここ／data/quote.json を更新。
const DEFAULT_DIVIDEND = 32;

function readExisting() {
  try { return JSON.parse(readFileSync(OUT, "utf8")); } catch { return {}; }
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
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

async function main() {
  const prev = readExisting();
  const { price, currency } = await getPrice();

  // 配当は IR 予想（手動保持）。既存値があればそれを維持。
  const dividend = Number.isFinite(prev.annualDividendPerShare)
    ? prev.annualDividendPerShare
    : DEFAULT_DIVIDEND;
  const dividendSource = prev.dividendSource || "IR予想（手動保持）";

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
