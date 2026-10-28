export interface Env {
  ASSETS: Fetcher;
  REGIONAL_EARNINGS_ENABLED?: string;
  DB: D1Database;
  SESSION_SECRET: string;
  ADMIN_PHONES?: string;
  MARZPAY_API_KEY?: string;
  MARZPAY_API_SECRET?: string;
  MARZPAY_WEBHOOK_SECRET?: string;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const encoder = new TextEncoder();
const bytesToHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex: string) => new Uint8Array((hex.match(/.{1,2}/g) || []).map(v => parseInt(v, 16)));
const randomHex = (length = 16) => {
  const b = new Uint8Array(length);
  crypto.getRandomValues(b);
  return bytesToHex(b);
};
const PBKDF2_ITERATIONS = 100000; // Cloudflare Web Crypto supports at most 100,000 iterations here.
async function passwordHash(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
async function makeSession(userId: string, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ sub: userId, exp: Date.now() + 365 * 86400000 })).replace(/=/g, "");
  return payload + "." + await hmac(payload, secret);
}
async function sessionUser(request: Request, env: Env): Promise<string | null> {
  const cookieHeader = request.headers.get("Cookie") || "";
  const token = cookieHeader.split(";").map(s => s.trim()).find(s => s.startsWith("aurorar_session="))?.slice("aurorar_session=".length);
  if (!token || !env.SESSION_SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ (signature.charCodeAt(i) || 0);
  if (mismatch !== 0) return null;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!(data.exp > Date.now()) || typeof data.sub !== "string") return null;
    const account = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(data.sub).first();
    return account ? data.sub : null;
  } catch { return null; }
}
const cookie = (token: string, maxAge: number) => `aurorar_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
async function readJson(request: Request): Promise<any> {
  try { return await request.json(); } catch { return null; }
}
function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let phone = input.replace(/[\s()-]/g, "");
  if (/^0\d{9}$/.test(phone)) phone = "+256" + phone.slice(1);
  else if (/^256\d{9}$/.test(phone)) phone = "+" + phone;
  if (!/^\+\d{10,15}$/.test(phone)) return null;
  return phone;
}
export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Disabled unless an operator explicitly sets REGIONAL_EARNINGS_ENABLED=true.
    if (env.REGIONAL_EARNINGS_ENABLED !== "true") {
      console.log("Regional earnings scheduler disabled; no wallets changed.");
      return;
    }
    if (!env.DB) throw new Error("D1 binding is unavailable.");
    const dateRow = await env.DB.prepare("SELECT date(datetime('now','+3 hours')) AS earning_date").first<{earning_date:string}>();
    const earningDate = dateRow?.earning_date;
    if (!earningDate) throw new Error("Could not determine EAT earning date.");
    const eligible = await env.DB.prepare("SELECT rup.id AS product_id, rup.user_id, rup.currency, rup.daily_income FROM regional_user_products rup WHERE rup.status='active' AND rup.currency IN ('RWF','ZMW') AND rup.daily_income>0 AND datetime(rup.starts_at)<=datetime('now') AND datetime(rup.ends_at)>datetime('now') AND NOT EXISTS (SELECT 1 FROM regional_earning_ledger el WHERE el.user_product_id=rup.id AND el.earning_date=?)").bind(earningDate).all<{product_id:string;user_id:string;currency:string;daily_income:number}>();
    for (const p of eligible.results || []) {
      const ledgerId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO currency_wallets (user_id,currency,available_balance,total_deposited,total_earned,total_withdrawn,referral_earnings,updated_at) VALUES (?,?,0,0,0,0,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(p.user_id,p.currency),
        env.DB.prepare("INSERT OR IGNORE INTO regional_earning_ledger (id,user_product_id,user_id,currency,earning_date,amount,status) VALUES (?,?,?,?,?,?,'pending')").bind(ledgerId,p.product_id,p.user_id,p.currency,earningDate,Math.trunc(Number(p.daily_income))),
        env.DB.prepare("UPDATE currency_wallets SET available_balance=available_balance+(SELECT amount FROM regional_earning_ledger WHERE user_product_id=? AND earning_date=? AND status='pending'),total_earned=total_earned+(SELECT amount FROM regional_earning_ledger WHERE user_product_id=? AND earning_date=? AND status='pending'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND currency=? AND EXISTS (SELECT 1 FROM regional_earning_ledger WHERE user_product_id=? AND earning_date=? AND status='pending')").bind(p.product_id,earningDate,p.product_id,earningDate,p.user_id,p.currency,p.product_id,earningDate),
        env.DB.prepare("UPDATE regional_earning_ledger SET status='credited',credited_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_product_id=? AND earning_date=? AND status='pending' AND EXISTS (SELECT 1 FROM currency_wallets WHERE user_id=? AND currency=?)").bind(p.product_id,earningDate,p.user_id,p.currency)
      ]);
    }
    console.log("Regional earnings run completed.", { earningDate, eligibleMachines: eligible.results?.length || 0 });
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": url.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" } });
      if (!env.DB || !env.SESSION_SECRET) return json({ error: "Account service is not configured. Contact the site administrator." }, 503);
      try {
        if (url.pathname === "/api/payments/marzpay/callback" && request.method === "POST") {
          const rawBody = await request.text();
          const signingSecret = env.MARZPAY_WEBHOOK_SECRET;
          const timestamp = request.headers.get("X-MarzPay-Timestamp") || "";
          const signatureHeader = request.headers.get("X-MarzPay-Signature") || "";
          const signature = signatureHeader.split(",").map(v => v.trim()).find(v => v.startsWith("v1="))?.slice(3) || "";
          if (!signingSecret || !timestamp || !signature || !/^\\d{10,13}$/.test(timestamp)) return json({ error: "Webhook signature required." }, 401);
          const timestampMs = Number(timestamp) * (timestamp.length === 13 ? 1 : 1000);
          if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return json({ error: "Webhook timestamp expired." }, 401);
          const expected = await hmac(timestamp + "." + rawBody, signingSecret);
          if (signature.length !== expected.length) return json({ error: "Invalid webhook signature." }, 401);
          let diff = 0;
          for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (signature.charCodeAt(i) || 0);
          if (diff !== 0) return json({ error: "Invalid webhook signature." }, 401);
          let event: any;
          try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid webhook JSON." }, 400); }
          const tx = event?.transaction;
          const reference = typeof tx?.reference === "string" ? tx.reference : "";
          const eventType = typeof event?.event_type === "string" ? event.event_type : "";
          if (!reference || !tx?.uuid || !eventType.startsWith("collection.")) return json({ received: true, ignored: true });
          const local = await env.DB.prepare("SELECT id, user_id, amount_ugx, currency, status FROM transactions WHERE external_reference=? AND type='deposit'").bind(reference).first<any>();
          if (!local) return json({ received: true, ignored: true });
          const localCurrency = String(local.currency || "UGX").toUpperCase();
          const providerCurrency = String(tx?.amount?.currency || "").toUpperCase();
          if (Number(tx?.amount?.raw) !== Number(local.amount_ugx) || providerCurrency !== localCurrency) return json({ error: "Payment amount or currency mismatch." }, 409);
          if (tx.status === "completed" && eventType === "collection.completed") {
            // Regional users may not have a wallet row until their first confirmed payment.
            // Ensure the matching currency wallet exists before attempting to credit it.
            if (localCurrency !== "UGX") {
              await env.DB.prepare("INSERT OR IGNORE INTO currency_wallets (user_id,currency,available_balance,total_deposited,total_earned,total_withdrawn,referral_earnings,updated_at) VALUES (?,?,0,0,0,0,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(local.user_id, localCurrency).run();
            }
            const completedAt = new Date().toISOString();
            const completeTx = env.DB.prepare("UPDATE transactions SET status='completed', completed_at=?, description='MarzPay collection completed' WHERE id=? AND status IN ('pending','processing')").bind(completedAt,local.id);
            const ledgerUpdate = localCurrency === "UGX"
              ? env.DB.prepare("UPDATE wallets SET available_balance=available_balance+?, total_deposited=total_deposited+?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND EXISTS (SELECT 1 FROM transactions WHERE id=? AND status='completed' AND completed_at=? AND description='MarzPay collection completed')").bind(Number(local.amount_ugx),Number(local.amount_ugx),local.user_id,local.id,completedAt)
              : env.DB.prepare("UPDATE currency_wallets SET available_balance=available_balance+?, total_deposited=total_deposited+?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND currency=? AND EXISTS (SELECT 1 FROM transactions WHERE id=? AND status='completed' AND completed_at=? AND description='MarzPay collection completed')").bind(Number(local.amount_ugx),Number(local.amount_ugx),local.user_id,localCurrency,local.id,completedAt);
            // D1 batch is atomic, so transaction completion and wallet credit cannot separate.
            await env.DB.batch([
              completeTx,
              ledgerUpdate,
              env.DB.prepare("INSERT OR IGNORE INTO payment_events (id,provider,provider_event_id,user_id,transaction_id,event_type,verified,payload_json) VALUES (?,?,?,?,?,?,1,?)").bind(crypto.randomUUID(),"marzpay",String(tx.uuid),local.user_id,local.id,eventType,rawBody)
            ]);
          } else if (["failed","cancelled"].includes(tx.status) && ["collection.failed","collection.cancelled"].includes(eventType)) {
            await env.DB.prepare("UPDATE transactions SET status='failed', description=? WHERE id=? AND status IN ('pending','processing')").bind("MarzPay collection " + tx.status, local.id).run();
          }
          return json({ received: true });
        }
        if (url.pathname === "/api/payments/check" && request.method === "POST") {
          const userId = await sessionUser(request, env);
          if (!userId) return json({ error: "Please log in to check your deposit." }, 401);
          if (!env.MARZPAY_API_KEY || !env.MARZPAY_API_SECRET) return json({ error: "Payment status checking is not configured." }, 503);
          const body = await readJson(request);
          const transactionId = typeof body?.transactionId === "string" ? body.transactionId : "";
          if (!transactionId) return json({ error: "Select a deposit transaction to check." }, 400);
          const local = await env.DB.prepare("SELECT id,user_id,amount_ugx,currency,status,external_reference,provider_transaction_uuid FROM transactions WHERE id=? AND user_id=? AND type='deposit'").bind(transactionId,userId).first<any>();
          if (!local) return json({ error: "Deposit transaction not found." }, 404);
          if (local.status === "completed") return json({ ok: true, status: "completed", message: "This deposit is already credited." });
          if (["failed","reversed"].includes(local.status)) return json({ ok: true, status: local.status, message: "This deposit was not completed." });
          const auth = btoa(env.MARZPAY_API_KEY + ":" + env.MARZPAY_API_SECRET);
          let provider: any = null;
          try {
            // MarzPay documents transaction lookup by UUID and transaction listing with
            // optional reference filtering. Some merchant accounts do not honor the
            // reference filter consistently, so list collections and match the exact
            // local reference ourselves rather than trusting a filtered response.
            const path = local.provider_transaction_uuid
              ? "https://wallet.wearemarz.com/api/v1/transactions/" + encodeURIComponent(local.provider_transaction_uuid)
              : "https://wallet.wearemarz.com/api/v1/transactions?per_page=100&type=collection";
            const response = await fetch(path, { headers: { "Authorization": "Basic " + auth, "Accept": "application/json" } });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok || data?.status === "error") return json({ error: data?.message || "MarzPay could not verify this payment yet. Please try again later." }, 502);
            const rows = Array.isArray(data?.data?.transactions) ? data.data.transactions
              : Array.isArray(data?.transactions) ? data.transactions
              : Array.isArray(data?.data?.data?.transactions) ? data.data.data.transactions
              : Array.isArray(data?.data) ? data.data
              : Array.isArray(data?.results) ? data.results : [];
            const detail = data?.transaction || data?.data?.transaction || data?.data?.data?.transaction || null;
            provider = detail || rows.find((t: any) => String(t.reference || t.external_reference || "") === String(local.external_reference || "")) || null;
          } catch {
            return json({ error: "Could not contact MarzPay to verify this payment. Please try again later." }, 502);
          }
          if (!provider) return json({ ok: true, status: "processing", message: "MarzPay has not returned a matching transaction yet." });
          const providerStatus = String(provider.status || "").toLowerCase();
          const providerAmount = Number(provider.amount?.raw ?? provider.amount);
          const providerCurrency = String(provider.amount?.currency || local.currency || "UGX").toUpperCase();
          if (providerAmount !== Number(local.amount_ugx) || providerCurrency !== String(local.currency || "UGX").toUpperCase()) {
            return json({ error: "Provider transaction details do not match this deposit. Contact support before retrying." }, 409);
          }
          if (["completed","successful","succeeded"].includes(providerStatus)) {
            const currency = String(local.currency || "UGX").toUpperCase();
            // Ensure the regional wallet exists before attempting to credit a confirmed payment.
            if (currency !== "UGX") {
              await env.DB.prepare("INSERT OR IGNORE INTO currency_wallets (user_id,currency,available_balance,total_deposited,total_earned,total_withdrawn,referral_earnings) VALUES (?,?,0,0,0,0,0)").bind(userId,currency).run();
            }
            // Keep completion and wallet credit atomic and tie the credit to this exact state transition.
            const completedAt = new Date().toISOString();
            const completeTx = env.DB.prepare("UPDATE transactions SET status='completed',completed_at=?,description='MarzPay payment verified by status check' WHERE id=? AND user_id=? AND type='deposit' AND status IN ('pending','processing')").bind(completedAt,local.id,userId);
            const creditWallet = currency === "UGX"
              ? env.DB.prepare("UPDATE wallets SET available_balance=available_balance+?,total_deposited=total_deposited+?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND EXISTS (SELECT 1 FROM transactions WHERE id=? AND status='completed' AND completed_at=? AND description='MarzPay payment verified by status check')").bind(Number(local.amount_ugx),Number(local.amount_ugx),userId,local.id,completedAt)
              : env.DB.prepare("UPDATE currency_wallets SET available_balance=available_balance+?,total_deposited=total_deposited+?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND currency=? AND EXISTS (SELECT 1 FROM transactions WHERE id=? AND status='completed' AND completed_at=? AND description='MarzPay payment verified by status check')").bind(Number(local.amount_ugx),Number(local.amount_ugx),userId,currency,local.id,completedAt);
            const results = await env.DB.batch([completeTx,creditWallet]);
            const completed = Number(results[0]?.meta?.changes || 0) === 1;
            const credited = Number(results[1]?.meta?.changes || 0) === 1;
            if (completed && !credited) throw new Error("Confirmed deposit wallet credit did not apply.");
            return json({ ok: true, status: "completed", message: completed && credited
              ? "MarzPay confirmed this deposit. Your wallet has been updated; refresh your account balance."
              : "This deposit was already processed. Refresh your account balance." });
          }
          if (["failed","cancelled"].includes(providerStatus)) {
            await env.DB.prepare("UPDATE transactions SET status='failed',description='MarzPay reports payment '||? WHERE id=? AND status IN ('pending','processing')").bind(providerStatus,local.id).run();
            return json({ ok: true, status: "failed", message: "MarzPay reports this payment did not complete." });
          }
          return json({ ok: true, status: "processing", message: "MarzPay still reports this payment as processing. No balance has been added." });
        }
        if (url.pathname === "/api/payments/deposit" && request.method === "POST") {
          const userId = await sessionUser(request, env);
          if (!userId) return json({ error: "Please log in before depositing." }, 401);
          if (!env.MARZPAY_API_KEY || !env.MARZPAY_API_SECRET) return json({ error: "MarzPay API credentials are not configured. Contact support." }, 503);
          const body = await readJson(request);
          const account = await env.DB.prepare("SELECT country FROM users WHERE id = ? AND status = 'active'").bind(userId).first<{country:string}>();
          if (!account) return json({ error: "Active account not found." }, 401);
          const country = account.country || "UG";
          if (typeof body?.country === "string" && body.country.toUpperCase() !== country) return json({ error: "Payment country must match your registered account country." }, 403);
          const amount = Number(body?.amount);
          const markets: Record<string, { prefix: string; currency: string; name: string; min: number; max: number }> = {
            UG: { prefix: "+256", currency: "UGX", name: "Uganda", min: 15000, max: 10000000 },
            RW: { prefix: "+250", currency: "RWF", name: "Rwanda", min: 100, max: 10000000 },
            ZM: { prefix: "+260", currency: "ZMW", name: "Zambia", min: 1, max: 10000000 }
          };
          const market = markets[country];
          const phone = normalizePhone(body?.phone);
          // The current product catalogue and wallet ledger are UGX-only. Do not collect
          // RWF/ZMW until separate currency ledgers and country-specific product accounting exist.
          if (country !== "UG") return json({ error: "Rwanda and Zambia payments are being prepared. Deposits for these countries will open after separate RWF/ZMW wallet accounting is enabled. No payment has been requested." }, 409);
          if (!market) return json({ error: "Choose Uganda, Rwanda, or Zambia." }, 400);
          if (!Number.isSafeInteger(amount) || amount < market.min || amount > market.max) return json({ error: "Enter an amount between " + market.min + " and " + market.max + " " + market.currency + "." }, 400);
          if (!phone || !phone.startsWith(market.prefix)) return json({ error: "Enter a valid " + market.name + " mobile money number starting with " + market.prefix + "." }, 400);
          const reference = crypto.randomUUID();
          const transactionId = crypto.randomUUID();
          await env.DB.prepare("INSERT INTO transactions (id,user_id,type,amount_ugx,currency,status,external_reference,phone_number,description) VALUES (?,?,'deposit',?,?,'pending',?,?,?)").bind(transactionId,userId,amount,market.currency,reference,phone,"MarzPay mobile money deposit").run();
          const auth = btoa(env.MARZPAY_API_KEY + ":" + env.MARZPAY_API_SECRET);
          let providerResponse: any;
          try {
            const form = new FormData();
            form.set("amount", String(amount));
            form.set("phone_number", phone);
            form.set("country", country);
            form.set("currency", market.currency);
            form.set("reference", reference);
            form.set("description", "Aurorar account deposit");
            form.set("callback_url", new URL("/api/payments/marzpay/callback", url.origin).toString());
            form.set("metadata", JSON.stringify([{ transactionId }]));
            const response = await fetch("https://wallet.wearemarz.com/api/v1/collect-money", {
              method: "POST",
              headers: { "Authorization": "Basic " + auth },
              body: form
            });
            providerResponse = await response.json().catch(() => ({}));
            if (!response.ok || providerResponse?.status === "error") {
              await env.DB.prepare("UPDATE transactions SET status='failed', description='MarzPay rejected collection request' WHERE id=? AND status='pending'").bind(transactionId).run();
              return json({ error: providerResponse?.message || "MarzPay could not start this payment. Please try again." }, 502);
            }
          } catch {
            await env.DB.prepare("UPDATE transactions SET status='failed', description='MarzPay connection failed' WHERE id=? AND status='pending'").bind(transactionId).run();
            return json({ error: "Could not connect to MarzPay. Please try again." }, 502);
          }
          const providerTx = providerResponse?.transaction || providerResponse?.data?.transaction || providerResponse?.data || {};
          const providerUuid = providerTx?.uuid || providerTx?.transaction_uuid || providerTx?.id || providerResponse?.transaction_uuid || providerResponse?.uuid || null;
          await env.DB.prepare("UPDATE transactions SET status='processing', provider_transaction_uuid=COALESCE(?,provider_transaction_uuid), description='MarzPay payment request sent' WHERE id=? AND status='pending'").bind(providerUuid ? String(providerUuid) : null,transactionId).run();
          return json({ ok: true, message: providerResponse?.message || "Payment request sent. Approve it on your phone and wait for confirmation.", reference, status: "processing", country, currency: market.currency }, 201);
        }
        if (url.pathname === "/api/withdrawals" && (request.method === "POST" || request.method === "GET")) {
          const userId = await sessionUser(request, env);
          if (!userId) return json({ error: "Please log in before requesting a withdrawal." }, 401);
          if (request.method === "GET") {
            const rows = await env.DB.prepare("SELECT id, country, currency, amount, phone_number, status, created_at, updated_at FROM withdrawal_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(userId).all();
            return json({ requests: rows.results || [] });
          }
          const body = await readJson(request);
          const account = await env.DB.prepare("SELECT country FROM users WHERE id = ? AND status = 'active'").bind(userId).first<{country:string}>();
          if (!account) return json({ error: "Active account not found." }, 401);
          const country = account.country || "UG";
          if (typeof body?.country === "string" && body.country.toUpperCase() !== country) return json({ error: "Withdrawal country must match your registered account country." }, 403);
          const markets: Record<string, {currency:string; prefix:string; min:number; name:string}> = {
            UG: { currency:"UGX", prefix:"+256", min:3000, name:"Uganda" },
            RW: { currency:"RWF", prefix:"+250", min:100, name:"Rwanda" },
            ZM: { currency:"ZMW", prefix:"+260", min:10, name:"Zambia" }
          };
          const market = markets[country];
          if (!market) return json({ error: "Choose Uganda, Rwanda, or Zambia." }, 400);
          // Foreign currency withdrawals remain locked until that country's collection/disbursement
          // service and wallet accounting have been verified end-to-end by the operator.
          if (country !== "UG") return json({ error: "RWF and ZMW withdrawals are not open yet. Their separate wallet balances and payout callbacks must be verified first. No payout was sent." }, 409);
          // Enforce the Uganda withdrawal window on the server, not just in the UI.
          // EAT is UTC+3; allow requests from 10:00 through 16:59 EAT.
          const nowUtc = new Date();
          const eatMinutes = (((nowUtc.getUTCHours() + 3) % 24) * 60) + nowUtc.getUTCMinutes();
          if (eatMinutes < 10 * 60 || eatMinutes >= 17 * 60) {
            return json({ error: "Withdrawals are open from 10:00 AM to 5:00 PM Uganda time (EAT). Please try again during that window. No request was recorded and no money was deducted." }, 409);
          }
          const amount = Number(body?.amount);
          if (!Number.isSafeInteger(amount) || amount < market.min) return json({ error: "The minimum withdrawal is " + market.min + " " + market.currency + "." }, 400);
          const phone = normalizePhone(body?.phone);
          if (!phone || !phone.startsWith(market.prefix)) return json({ error: "Enter a valid " + market.name + " mobile money number starting with " + market.prefix + "." }, 400);
          const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.slice(0,80) : "";
          if (!/^[A-Za-z0-9_-]{12,80}$/.test(idempotencyKey)) return json({ error: "Please retry the request; a valid request reference is required." }, 400);
          const existing = await env.DB.prepare("SELECT id, country, currency, amount, phone_number, status, created_at FROM withdrawal_requests WHERE user_id=? AND idempotency_key=?").bind(userId,idempotencyKey).first<any>();
          if (existing) return json({ ok:true, request:existing, message:"This withdrawal request was already recorded. It has not been paid." }, 200);
          // Withdrawal eligibility: require both a confirmed deposit and an active machine purchase.
          // The welcome bonus is visible in the balance immediately, but remains withdrawal-locked
          // until these two account milestones are satisfied.
          const eligibility = await env.DB.prepare("SELECT EXISTS(SELECT 1 FROM transactions WHERE user_id=? AND type='deposit' AND status='completed' AND amount_ugx>0) AS has_deposit, EXISTS(SELECT 1 FROM user_products WHERE user_id=? AND status='active') AS has_machine").bind(userId,userId).first<any>();
          if (!Number(eligibility?.has_deposit || 0)) return json({ error:"To unlock withdrawals, first complete a successful deposit and then purchase a machine." }, 403);
          if (!Number(eligibility?.has_machine || 0)) return json({ error:"To unlock withdrawals, purchase a machine after your successful deposit." }, 403);
          const wallet = await env.DB.prepare("SELECT available_balance FROM wallets WHERE user_id=?").bind(userId).first<any>();
          if (!wallet || Number(wallet.available_balance || 0) < amount) return json({ error:"Your available UGX balance is not enough for this withdrawal. No money was deducted." }, 400);
          const id = crypto.randomUUID();
          try {
            await env.DB.prepare("INSERT INTO withdrawal_requests (id,user_id,country,currency,amount,phone_number,status,idempotency_key) VALUES (?,?,?, ?,?,?, 'requested',?)").bind(id,userId,country,market.currency,amount,phone,idempotencyKey).run();
          } catch {
            const duplicate = await env.DB.prepare("SELECT id, country, currency, amount, phone_number, status, created_at FROM withdrawal_requests WHERE user_id=? AND idempotency_key=?").bind(userId,idempotencyKey).first<any>();
            if (duplicate) return json({ ok:true, request:duplicate, message:"This withdrawal request was already recorded. It has not been paid." }, 200);
            throw new Error("Could not record the withdrawal request.");
          }
          return json({ ok:true, request:{id,country,currency:market.currency,amount,phone_number:phone,status:"requested"}, message:"Withdrawal request recorded for review. This is not a payment confirmation; no money has been deducted and no payout has been sent. The balance will be rechecked before any payout is approved." }, 201);
        }
        if (url.pathname === "/api/auth/register" && request.method === "POST") {
          const body = await readJson(request);
          const country = typeof body?.country === "string" ? body.country.toUpperCase() : "UG";
          const countryConfig: Record<string, {prefix:string;name:string}> = { UG:{prefix:"+256",name:"Uganda"}, RW:{prefix:"+250",name:"Rwanda"}, ZM:{prefix:"+260",name:"Zambia"} };
          const config = countryConfig[country];
          const phone = normalizePhone(body?.phone);
          const password = body?.password;
          const refCode = typeof body?.referralCode === "string" ? body.referralCode.trim().slice(0, 40) : "";
          if (!config) return json({ error: "Choose Uganda, Rwanda, or Zambia." }, 400);
          if (!phone || !phone.startsWith(config.prefix)) return json({ error: "Enter a valid " + config.name + " phone number starting with " + config.prefix + "." }, 400);
          if (typeof password !== "string" || password.length < 8 || password.length > 128) return json({ error: "Password must be 8–128 characters." }, 400);
          const exists = await env.DB.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first();
          if (exists) return json({ error: "An account with this phone number already exists. Please log in." }, 409);
          const id = crypto.randomUUID();
          const salt = randomHex(16);
          const hash = await passwordHash(password, salt);
          const referralCode = "AU" + randomHex(5).toUpperCase();
          const referrer = refCode ? await env.DB.prepare("SELECT id FROM users WHERE referral_code = ? AND status = 'active'").bind(refCode).first<{id:string}>() : null;
          // Insert the user first, then dependent rows separately so the failing
          // operation is isolated in Worker logs and account creation is recoverable.
          await env.DB.prepare("INSERT INTO users (id, phone, password_hash, password_salt, referral_code, referred_by, welcome_bonus, status, country) VALUES (?, ?, ?, ?, ?, ?, 5000, 'active', ?)").bind(id, phone, hash, salt, referralCode, referrer?.id || null, country).run();
          try {
            await env.DB.prepare("INSERT INTO wallets (user_id, available_balance, total_deposited, total_earned, total_withdrawn, referral_earnings) VALUES (?, 0, 0, 0, 0, 0)").bind(id).run();
            if (referrer) {
              await env.DB.prepare("INSERT INTO referrals (id, referrer_user_id, referred_user_id, level) VALUES (?, ?, ?, 1)").bind(crypto.randomUUID(), referrer.id, id).run();
            }
          } catch (dependentInsertError) {
            // Do not leave a half-created account if wallet/referral setup fails.
            await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
            throw dependentInsertError;
          }
          const token = await makeSession(id, env.SESSION_SECRET);
          return json({ ok: true, user: { phone, referralCode }, message: "Account created." }, 201, { "Set-Cookie": cookie(token, 31536000) });
        }
        if (url.pathname === "/api/auth/login" && request.method === "POST") {
          const body = await readJson(request);
          const phone = normalizePhone(body?.phone);
          if (!phone || typeof body?.password !== "string") return json({ error: "Enter your phone number and password." }, 400);
          const user = await env.DB.prepare("SELECT id, phone, password_hash, password_salt, referral_code, status, country FROM users WHERE phone = ?").bind(phone).first<any>();
          if (!user || user.status !== "active") return json({ error: "Phone number or password is incorrect." }, 401);
          const candidate = await passwordHash(body.password, user.password_salt);
          if (candidate !== user.password_hash) return json({ error: "Phone number or password is incorrect." }, 401);
          const token = await makeSession(user.id, env.SESSION_SECRET);
          return json({ ok: true, user: { phone: user.phone, referralCode: user.referral_code, country: user.country || "UG" } }, 200, { "Set-Cookie": cookie(token, 31536000) });
        }
        if (url.pathname === "/api/auth/change-password" && request.method === "POST") {
          const userId = await sessionUser(request, env);
          if (!userId) return json({ error: "Please log in again before changing your password." }, 401);
          const body = await readJson(request);
          if (typeof body?.currentPassword !== "string" || typeof body?.newPassword !== "string" || body.newPassword.length < 8 || body.newPassword.length > 128) {
            return json({ error: "Enter your current password and a new password of 8–128 characters." }, 400);
          }
          const user = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ? AND status = 'active'").bind(userId).first<any>();
          if (!user || await passwordHash(body.currentPassword, user.password_salt) !== user.password_hash) return json({ error: "Current password is incorrect." }, 401);
          const salt = randomHex(16);
          const hash = await passwordHash(body.newPassword, salt);
          await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, userId).run();
          return json({ ok: true, message: "Password changed successfully." });
        }
        if (url.pathname === "/api/auth/logout" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
        if (url.pathname === "/api/me" && request.method === "GET") {
          const id = await sessionUser(request, env);
          if (!id) return json({ error: "Please log in." }, 401);
          const user = await env.DB.prepare("SELECT phone, referral_code, welcome_bonus, country FROM users WHERE id = ? AND status = 'active'").bind(id).first<any>();
          if (!user) return json({ error: "Account not found." }, 401);
          // Credit the one-time UGX welcome bonus into the real wallet exactly once.
          // A stable unique reference makes this safe to retry for existing accounts.
          if ((user.country || "UG") === "UG" && Number(user.welcome_bonus || 0) > 0) {
            const bonusRef = "welcome-bonus:" + id;
            const bonusInsert = await env.DB.prepare("INSERT OR IGNORE INTO transactions (id,user_id,type,amount_ugx,currency,status,external_reference,description,completed_at) VALUES (?,?,'welcome_bonus',5000,'UGX','completed',?,'One-time welcome bonus credited to UGX wallet',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(crypto.randomUUID(),id,bonusRef).run();
            if (Number(bonusInsert.meta?.changes || 0) === 1) {
              await env.DB.prepare("UPDATE wallets SET available_balance=available_balance+5000,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=?").bind(id).run();
            }
          }
          const countryCurrency: Record<string, string> = { UG: "UGX", RW: "RWF", ZM: "ZMW" };
          const currency = countryCurrency[user.country] || "UGX";
          const ugWallet = await env.DB.prepare("SELECT available_balance, total_deposited, total_earned, total_withdrawn, referral_earnings FROM wallets WHERE user_id = ?").bind(id).first<any>();
          const products = await env.DB.prepare("SELECT up.id, p.id AS product_id, p.name, up.purchase_price_ugx AS price, p.duration_days AS days, up.starts_at, up.ends_at, up.status, 'UGX' AS currency FROM user_products up JOIN products p ON p.id = up.product_id WHERE up.user_id = ? AND up.status = 'active' ORDER BY up.purchased_at DESC").bind(id).all();
          const regionalProducts = currency === "UGX" ? { results: [] as any[] } : await env.DB.prepare("SELECT rup.id, rp.id AS product_id, rp.name, rup.purchase_price AS price, rp.duration_days AS days, rup.starts_at, rup.ends_at, rup.status, rup.currency, rup.daily_income FROM regional_user_products rup JOIN regional_products rp ON rp.id=rup.product_id AND rp.currency=rup.currency WHERE rup.user_id=? AND rup.status='active' ORDER BY rup.purchased_at DESC").bind(id).all();
          await env.DB.batch([
            env.DB.prepare("INSERT OR IGNORE INTO currency_wallets (user_id, currency) VALUES (?, 'RWF')").bind(id),
            env.DB.prepare("INSERT OR IGNORE INTO currency_wallets (user_id, currency) VALUES (?, 'ZMW')").bind(id)
          ]);
          const currencyWallets = await env.DB.prepare("SELECT currency, available_balance, total_deposited, total_earned, total_withdrawn, referral_earnings FROM currency_wallets WHERE user_id = ? AND currency = ?").bind(id, currency).all();
          const selectedWallet = currency === "UGX" ? (ugWallet || {}) : ((currencyWallets.results || [])[0] || {});
          const transactions = await env.DB.prepare("SELECT id, type, amount_ugx, currency, status, created_at FROM transactions WHERE user_id = ? AND COALESCE(currency, 'UGX') = ? AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 50").bind(id, currency).all();
          return json({ user, wallet: selectedWallet, currencyWallets: currencyWallets.results || [], products: products.results || [], regionalProducts: regionalProducts.results || [], transactions: transactions.results || [] });
        }
        if (url.pathname === "/api/referrals" && request.method === "GET") {
          const userId = await sessionUser(request, env);
          if (!userId) return json({ error: "Please log in." }, 401);
          const rows = await env.DB.prepare(`
            SELECT u.phone, r.level, r.created_at,
              COALESCE((SELECT SUM(t.amount_ugx) FROM transactions t WHERE t.user_id = u.id AND t.type = 'deposit' AND t.status = 'completed' AND t.amount_ugx > 0), 0) AS confirmed_deposit
            FROM referrals r JOIN users u ON u.id = r.referred_user_id
            WHERE r.referrer_user_id = ?
            ORDER BY r.created_at DESC LIMIT 100
          `).bind(userId).all();
          return json({ referrals: rows.results || [] });
        }
        if (url.pathname.startsWith("/api/admin/")) {
          const adminUserId = await sessionUser(request, env);
          if (!adminUserId) return json({ error: "Log in with your account first." }, 401);
          const adminConfig = (env.ADMIN_PHONES || "").split(",").map(v => normalizePhone(v.trim())).filter(Boolean);
          if (!adminConfig.length) return json({ error: "Admin access is not configured yet." }, 503);
          const adminUser = await env.DB.prepare("SELECT phone FROM users WHERE id = ? AND status = 'active'").bind(adminUserId).first<{phone:string}>();
          if (!adminUser || !adminConfig.includes(adminUser.phone)) return json({ error: "This account is not authorized for administration." }, 403);
          if (url.pathname === "/api/admin/overview" && request.method === "GET") {
            const [users, products, deposits, withdrawals, pending, balances] = await Promise.all([
              env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM users").first<any>(),
              env.DB.prepare("SELECT COUNT(*) AS active FROM user_products WHERE status='active'").first<any>(),
              env.DB.prepare("SELECT COALESCE(SUM(amount_ugx),0) AS total FROM transactions WHERE type='deposit' AND status='completed'").first<any>(),
              env.DB.prepare("SELECT COALESCE(SUM(amount_ugx),0) AS total FROM transactions WHERE type='withdrawal' AND status='completed'").first<any>(),
              env.DB.prepare("SELECT COUNT(*) AS total FROM transactions WHERE status IN ('pending','processing')").first<any>(),
              env.DB.prepare("SELECT COALESCE(SUM(available_balance),0) AS total FROM wallets").first<any>()
            ]);
            const [regionalWallets, regionalTransactions] = await Promise.all([
              env.DB.prepare("SELECT currency, COALESCE(SUM(available_balance),0) AS available_balance, COALESCE(SUM(total_deposited),0) AS total_deposited, COALESCE(SUM(total_earned),0) AS total_earned, COALESCE(SUM(total_withdrawn),0) AS total_withdrawn, COALESCE(SUM(referral_earnings),0) AS referral_earnings FROM currency_wallets GROUP BY currency ORDER BY currency").all(),
              env.DB.prepare("SELECT currency, type, status, COUNT(*) AS count, COALESCE(SUM(amount_ugx),0) AS total FROM transactions WHERE currency IN ('RWF','ZMW') GROUP BY currency, type, status ORDER BY currency, type, status").all()
            ]);
            return json({
              users: users || {},
              activeProducts: products?.active || 0,
              depositsUgx: deposits?.total || 0,
              withdrawalsUgx: withdrawals?.total || 0,
              pendingTransactions: pending?.total || 0,
              walletBalancesUgx: balances?.total || 0,
              regionalWalletAccounting: regionalWallets.results || [],
              regionalTransactionSummary: regionalTransactions.results || []
            });
          }
          if (url.pathname === "/api/admin/users" && request.method === "GET") {
            const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
            const rows = await env.DB.prepare(`SELECT u.id, u.phone, u.referral_code, u.status, u.created_at, COALESCE(w.available_balance,0) AS balance, COALESCE(w.total_deposited,0) AS total_deposited, COALESCE(w.total_withdrawn,0) AS total_withdrawn FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE (? = '' OR u.phone LIKE ? OR u.referral_code LIKE ?) ORDER BY u.created_at DESC LIMIT 100`).bind(q, "%" + q + "%", "%" + q + "%").all();
            return json({ users: rows.results || [] });
          }
          if (url.pathname.startsWith("/api/admin/users/") && url.pathname.endsWith("/status") && request.method === "POST") {
            const targetId = decodeURIComponent(url.pathname.slice("/api/admin/users/".length, -"/status".length)).trim();
            if (!targetId || targetId.length > 100) return json({ error: "Invalid user id." }, 400);
            if (targetId === adminUserId) return json({ error: "You cannot suspend or change the status of the administrator account you are using." }, 409);
            const body = await readJson(request);
            const status = body?.status;
            if (status !== "active" && status !== "suspended") return json({ error: "Choose active or suspended." }, 400);
            const target = await env.DB.prepare("SELECT id, phone FROM users WHERE id=?").bind(targetId).first<{id:string;phone:string}>();
            if (!target) return json({ error: "User not found." }, 404);
            await env.DB.prepare("UPDATE users SET status=? WHERE id=?").bind(status, targetId).run();
            return json({ ok: true, message: status === "suspended" ? "Account suspended. The user will be unable to log in." : "Account reactivated. The user can log in again.", status });
          }
          if (url.pathname.startsWith("/api/admin/users/") && request.method === "DELETE") {
            const targetId = decodeURIComponent(url.pathname.slice("/api/admin/users/".length)).trim();
            if (!targetId || targetId.length > 100) return json({ error: "Invalid user id." }, 400);
            if (targetId === adminUserId) return json({ error: "You cannot delete the administrator account you are currently using." }, 409);
            const target = await env.DB.prepare("SELECT id, phone FROM users WHERE id=?").bind(targetId).first<{id:string;phone:string}>();
            if (!target) return json({ error: "User not found." }, 404);
            const [transactions, purchases, referrals, paymentEvents, referredBy] = await Promise.all([
              env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id=?").bind(targetId).first<any>(),
              env.DB.prepare("SELECT COUNT(*) AS n FROM user_products WHERE user_id=?").bind(targetId).first<any>(),
              env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_user_id=? OR referred_user_id=?").bind(targetId,targetId).first<any>(),
              env.DB.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE user_id=?").bind(targetId).first<any>(),
              env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE referred_by=?").bind(target.phone).first<any>()
            ]);
            if ([transactions,purchases,referrals,paymentEvents,referredBy].some(x => Number(x?.n || 0) > 0)) {
              return json({ error: "This account has financial, machine, referral, or payment records. For audit safety, it cannot be permanently deleted; suspend the account instead." }, 409);
            }
            await env.DB.batch([
              env.DB.prepare("DELETE FROM wallets WHERE user_id=?").bind(targetId),
              env.DB.prepare("DELETE FROM users WHERE id=?").bind(targetId)
            ]);
            return json({ ok: true, message: "Account permanently deleted." });
          }
          if (url.pathname.startsWith("/api/admin/users/") && request.method === "GET") {
            const targetId = decodeURIComponent(url.pathname.slice("/api/admin/users/".length)).trim();
            if (!targetId || targetId.length > 100) return json({ error: "Invalid user id." }, 400);
            const user = await env.DB.prepare("SELECT u.id, u.phone, u.referral_code, u.referred_by, u.status, u.created_at, u.welcome_bonus, COALESCE(w.available_balance,0) AS balance, COALESCE(w.total_deposited,0) AS total_deposited, COALESCE(w.total_earned,0) AS total_earned, COALESCE(w.total_withdrawn,0) AS total_withdrawn, COALESCE(w.referral_earnings,0) AS referral_earnings FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=?").bind(targetId).first<any>();
            if (!user) return json({ error: "User not found." }, 404);
            const [products, transactions] = await Promise.all([
              env.DB.prepare("SELECT up.id, p.name, up.purchase_price_ugx AS price, up.purchased_at, up.starts_at, up.ends_at, up.status FROM user_products up JOIN products p ON p.id=up.product_id WHERE up.user_id=? ORDER BY up.purchased_at DESC LIMIT 50").bind(targetId).all(),
              env.DB.prepare("SELECT type, amount_ugx, currency, status, external_reference, description, created_at FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(targetId).all()
            ]);
            return json({ user, products: products.results || [], transactions: transactions.results || [] });
          }
          if (url.pathname === "/api/admin/transactions" && request.method === "GET") {
            const rows = await env.DB.prepare("SELECT t.id, u.phone, t.type, t.amount_ugx, t.currency, t.status, t.external_reference, t.description, t.created_at FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 100").all();
            return json({ transactions: rows.results || [] });
          }
          return json({ error: "Not found" }, 404);
        }
        if (url.pathname === "/api/products/purchase" && request.method === "POST") {
          const userId = await sessionUser(request, env);
          if (!userId) return json({ error: "Please log in before purchasing a machine." }, 401);
          const body = await readJson(request);
          const productId = Number(body?.productId);
          const currency = typeof body?.currency === "string" ? body.currency.toUpperCase() : "UGX";
          if (!Number.isSafeInteger(productId) || productId < 1 || productId > 10) return json({ error: "Select a valid machine." }, 400);
          if (!["UGX","RWF","ZMW"].includes(currency)) return json({ error: "Choose a supported wallet currency." }, 400);

          if (currency !== "UGX") {
            const account = await env.DB.prepare("SELECT country FROM users WHERE id=? AND status='active'").bind(userId).first<{country:string}>();
            const expectedCountry = currency === "RWF" ? "RW" : "ZM";
            if (!account || account.country !== expectedCountry) return json({ error: "Your registered country does not match this wallet currency. No money was deducted." }, 403);
            if (env.REGIONAL_EARNINGS_ENABLED !== "true") return json({ error: "Regional machine purchases are temporarily paused while daily earnings are being verified. No money was deducted." }, 409);
            const product = await env.DB.prepare("SELECT id,name,price,daily_income,duration_days,active FROM regional_products WHERE id=? AND currency=?").bind(productId,currency).first<any>();
            if (!product || Number(product.active) !== 1) return json({ error: "This " + currency + " machine is not configured and enabled yet. No money was deducted." }, 409);
            const price = Number(product.price), dailyIncome = Number(product.daily_income), durationDays = Number(product.duration_days);
            if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(dailyIncome) || dailyIncome < 0 || !Number.isSafeInteger(durationDays) || durationDays < 1) return json({ error: "This regional machine has invalid pricing. No money was deducted." }, 409);
            const purchaseId = crypto.randomUUID(), transactionId = crypto.randomUUID();
            const result = await env.DB.batch([
              env.DB.prepare("UPDATE currency_wallets SET available_balance=available_balance-?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND currency=? AND available_balance>=?").bind(price,userId,currency,price),
              env.DB.prepare("INSERT INTO regional_user_products (id,user_id,product_id,currency,purchase_price,daily_income,starts_at,ends_at,status) SELECT ?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),datetime('now','+' || ? || ' days'),'active' WHERE changes()=1").bind(purchaseId,userId,productId,currency,price,dailyIncome,durationDays),
              env.DB.prepare("INSERT INTO transactions (id,user_id,type,amount_ugx,currency,status,external_reference,description,completed_at) SELECT ?,?, 'product_purchase', ?, ?, 'completed', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE EXISTS (SELECT 1 FROM regional_user_products WHERE id=?)").bind(transactionId,userId,-price,currency,"regional-purchase:"+purchaseId,"Purchased "+product.name+" ("+currency+")",purchaseId)
            ]);
            if (Number(result[0]?.meta?.changes || 0) !== 1) return json({ error: "Insufficient " + currency + " wallet balance. No money was deducted." }, 409);
            if (Number(result[1]?.meta?.changes || 0) !== 1 || Number(result[2]?.meta?.changes || 0) !== 1) return json({ error: "Purchase could not be recorded. No money was deducted." }, 409);
            return json({ok:true,message:product.name+" purchased using "+currency+".",purchase:{id:purchaseId,productId,name:product.name,price,currency}},201);
          }

          const account = await env.DB.prepare("SELECT country FROM users WHERE id=? AND status='active'").bind(userId).first<{country:string}>();
          if (!account || (account.country || "UG") !== "UG") return json({ error: "This account is registered outside Uganda. UGX machine purchases are not available for your market. No money was deducted." }, 403);
          const product = await env.DB.prepare("SELECT id,name,price_ugx,active,duration_days FROM products WHERE id=?").bind(productId).first<any>();
          if (!product || Number(product.active) !== 1) return json({ error: "This machine is not currently available." }, 404);
          const price = Number(product.price_ugx), durationDays = Number(product.duration_days);
          if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(durationDays) || durationDays < 1) return json({ error: "This machine has invalid pricing. No money was deducted." }, 409);
          const purchaseId = crypto.randomUUID(), transactionId = crypto.randomUUID();
          const result = await env.DB.batch([
            env.DB.prepare("UPDATE wallets SET available_balance=available_balance-?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND available_balance>=?").bind(price,userId,price),
            env.DB.prepare("INSERT INTO user_products (id,user_id,product_id,purchase_price_ugx,starts_at,ends_at,status) SELECT ?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),datetime('now','+' || ? || ' days'),'active' WHERE changes()=1").bind(purchaseId,userId,product.id,price,durationDays),
            env.DB.prepare("INSERT INTO transactions (id,user_id,type,amount_ugx,currency,status,external_reference,description,completed_at) SELECT ?,?, 'product_purchase', ?, 'UGX', 'completed', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE EXISTS (SELECT 1 FROM user_products WHERE id=?)").bind(transactionId,userId,-price,"purchase:"+purchaseId,"Purchased "+product.name,purchaseId)
          ]);
          if (Number(result[0]?.meta?.changes || 0) !== 1) return json({ error: "Your UGX wallet does not have enough available funds. No money was deducted." }, 409);
          if (Number(result[1]?.meta?.changes || 0) !== 1 || Number(result[2]?.meta?.changes || 0) !== 1) return json({ error: "Purchase could not be recorded. No money was deducted." }, 409);
          return json({ok:true,message:product.name+" purchased.",purchase:{id:purchaseId,productId:product.id,name:product.name,priceUgx:price,currency:"UGX"}},201);
        }
        if (url.pathname === "/api/products" && request.method === "GET") {
          const currency = (url.searchParams.get("currency") || "UGX").toUpperCase();
          if (currency === "RWF" || currency === "ZMW") {
            const products = await env.DB.prepare("SELECT id,name,price,daily_income,duration_days,currency FROM regional_products WHERE currency=? AND active=1 ORDER BY id").bind(currency).all();
            return json({currency,products:products.results || [],enabled:(products.results || []).length > 0, message:(products.results || []).length ? undefined : "Local-currency product prices have not been configured yet."});
          }
          if (currency !== "UGX") return json({error:"Choose UGX, RWF, or ZMW."},400);
          const products = await env.DB.prepare("SELECT id, name, price_ugx, daily_income_ugx, duration_days, 'UGX' AS currency FROM products WHERE active = 1 ORDER BY id").all();
          return json({currency:"UGX",products: products.results || []});
        }
        return json({ error: "Not found" }, 404);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("Aurorar API error:", detail);
        // Return a useful diagnostic without exposing credentials or stack traces.
        return json({ error: "Account service failed. Please retry shortly." }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
