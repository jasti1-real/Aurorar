export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SESSION_SECRET: string;
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
  const payload = btoa(JSON.stringify({ sub: userId, exp: Date.now() + 7 * 86400000 })).replace(/=/g, "");
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
    return data.exp > Date.now() && typeof data.sub === "string" ? data.sub : null;
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": url.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" } });
      if (!env.DB || !env.SESSION_SECRET) return json({ error: "Account service is not configured. Contact the site administrator." }, 503);
      try {
        if (url.pathname === "/api/auth/register" && request.method === "POST") {
          const body = await readJson(request);
          const phone = normalizePhone(body?.phone);
          const password = body?.password;
          const refCode = typeof body?.referralCode === "string" ? body.referralCode.trim().slice(0, 40) : "";
          if (!phone) return json({ error: "Enter a valid phone number, including Uganda's country code if needed." }, 400);
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
          await env.DB.prepare("INSERT INTO users (id, phone, password_hash, password_salt, referral_code, referred_by, welcome_bonus, status) VALUES (?, ?, ?, ?, ?, ?, 5000, 'active')").bind(id, phone, hash, salt, referralCode, referrer?.id || null).run();
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
          return json({ ok: true, user: { phone, referralCode }, message: "Account created." }, 201, { "Set-Cookie": cookie(token, 604800) });
        }
        if (url.pathname === "/api/auth/login" && request.method === "POST") {
          const body = await readJson(request);
          const phone = normalizePhone(body?.phone);
          if (!phone || typeof body?.password !== "string") return json({ error: "Enter your phone number and password." }, 400);
          const user = await env.DB.prepare("SELECT id, phone, password_hash, password_salt, referral_code, status FROM users WHERE phone = ?").bind(phone).first<any>();
          if (!user || user.status !== "active") return json({ error: "Phone number or password is incorrect." }, 401);
          const candidate = await passwordHash(body.password, user.password_salt);
          if (candidate !== user.password_hash) return json({ error: "Phone number or password is incorrect." }, 401);
          const token = await makeSession(user.id, env.SESSION_SECRET);
          return json({ ok: true, user: { phone: user.phone, referralCode: user.referral_code } }, 200, { "Set-Cookie": cookie(token, 604800) });
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
          const user = await env.DB.prepare("SELECT phone, referral_code, welcome_bonus FROM users WHERE id = ? AND status = 'active'").bind(id).first<any>();
          if (!user) return json({ error: "Account not found." }, 401);
          const wallet = await env.DB.prepare("SELECT available_balance, total_deposited, total_earned, total_withdrawn, referral_earnings FROM wallets WHERE user_id = ?").bind(id).first<any>();
          const products = await env.DB.prepare("SELECT up.id, p.id AS product_id, p.name, up.purchase_price_ugx AS price, p.duration_days AS days, up.starts_at, up.ends_at, up.status FROM user_products up JOIN products p ON p.id = up.product_id WHERE up.user_id = ? AND up.status = 'active' ORDER BY up.purchased_at DESC").bind(id).all();
          const transactions = await env.DB.prepare("SELECT type, amount_ugx, status, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(id).all();
          return json({ user, wallet: wallet || {}, products: products.results || [], transactions: transactions.results || [] });
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
        if (url.pathname === "/api/products/purchase" && request.method === "POST") {
          const userId = await sessionUser(request, env);
          if (!userId) return json({ error: "Please log in before purchasing a machine." }, 401);
          const body = await readJson(request);
          const productId = Number(body?.productId);
          if (!Number.isSafeInteger(productId) || productId < 1 || productId > 10) return json({ error: "Select a valid machine." }, 400);
          const product = await env.DB.prepare("SELECT id, name, price_ugx, active FROM products WHERE id = ?").bind(productId).first<any>();
          if (!product || product.active !== 1) return json({ error: "This machine is not currently available." }, 404);
          const price = Number(product.price_ugx);
          const purchaseId = crypto.randomUUID();
          const transactionId = crypto.randomUUID();
          // The conditional debit prevents concurrent requests spending the same balance twice.
          const debit = await env.DB.prepare("UPDATE wallets SET available_balance = available_balance - ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND available_balance >= ?").bind(price, userId, price).run();
          if ((debit.meta?.changes || 0) !== 1) return json({ error: "Insufficient available balance. Deposit funds through a verified payment method before purchasing." }, 409);
          try {
            await env.DB.batch([
              env.DB.prepare("INSERT INTO user_products (id, user_id, product_id, purchase_price_ugx, starts_at, ends_at, status) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), datetime('now', '+' || (SELECT duration_days FROM products WHERE id = ?) || ' days'), 'active')").bind(purchaseId, userId, product.id, price, product.id),
              env.DB.prepare("INSERT INTO transactions (id, user_id, type, amount_ugx, status, external_reference, description, completed_at) VALUES (?, ?, 'product_purchase', ?, 'completed', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(transactionId, userId, -price, "purchase:" + purchaseId, "Purchased " + product.name)
            ]);
          } catch (writeError) {
            await env.DB.prepare("UPDATE wallets SET available_balance = available_balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?").bind(price, userId).run();
            throw writeError;
          }
          return json({ ok: true, message: product.name + " purchased.", purchase: { id: purchaseId, productId: product.id, name: product.name, priceUgx: price } }, 201);
        }
        if (url.pathname === "/api/products" && request.method === "GET") {
          const products = await env.DB.prepare("SELECT id, name, price_ugx, daily_income_ugx, duration_days FROM products WHERE active = 1 ORDER BY id").all();
          return json({ products: products.results || [] });
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
