import { Redis } from '@upstash/redis';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { products } from './store';

export type Crash = 'db' | 'gateway' | 'dependency' | null;
export type Log = { id: string; at: string; level: string; message: string };
export type Account = { id: string; email: string; name: string; passwordHash: string; createdAt: string };
type Order = { id: string; at: string; lines: string[]; total: number };
type Ops = { crash: Crash; logs: Log[] };
type Memory = { users: Map<string, Account>; sessions: Map<string, string>; active: Set<string>; carts: Map<string, string[]>; orders: Map<string, Order[]>; wishlists: Map<string, Set<string>>; newsletter: Set<string>; ops: Ops };

const TTL = 60 * 60 * 24 * 7;
const ACTIVE = 'zon:v1:active';
const OPS = 'zon:v1:ops';
const clientGlobal = globalThis as typeof globalThis & { __zonRedis?: Redis; __zonMemory?: Memory };
const memory = clientGlobal.__zonMemory ?? (clientGlobal.__zonMemory = { users: new Map(), sessions: new Map(), active: new Set(), carts: new Map(), orders: new Map(), wishlists: new Map(), newsletter: new Set(), ops: { crash: null, logs: [] } });

const high: Record<Exclude<Crash, null>, string> = {
  db: 'CRITICAL [DB_POOL_EMPTY]: Database connection pool exhausted. Available slots: 0/50. Entire data layer hanging.',
  gateway: 'ERROR [GATEWAY_504]: User-facing router cannot communicate with upstream backend microservices on route /api/v1/products.',
  dependency: 'CRITICAL [DEP_FAILURE]: Downstream Payment Gateway / Order Processor is completely down. Transaction ID generation blocked.',
};
const noise = [
  'WARNING [HTTP_404_ECHO]: End-user resource fetch failed for /assets/nav-sprite-v2.png (Frontend asset missing during overload).',
  'INFO [STATIC_LATENCY]: Marketing tracking script and footer analytics elements delayed beyond 4500ms.',
  'WARNING [CASCADING_CPU]: Secondary recommendation microservice throwing generic CPU spike warning (Waiting on slow database response).',
];

export class BackendUnavailable extends Error {}
export class PoolLimitError extends Error {}
export class AuthError extends Error { constructor(public code: string, message: string) { super(message); } }
const chaosEnabled = () => process.env.NODE_ENV !== 'production' || process.env.ENABLE_CHAOS === 'true';

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return clientGlobal.__zonRedis ?? (clientGlobal.__zonRedis = new Redis({ url, token }));
  if (process.env.NODE_ENV === 'production') throw new BackendUnavailable('Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable persistent production storage.');
  return null;
}
export function databaseConfigured() { return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN); }
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const userKey = (email: string) => 'zon:v1:user:' + digest(email);
const sessionKey = (token: string) => 'zon:v1:session:' + token;
const userSessionKey = (uid: string) => 'zon:v1:user-session:' + uid;
const cartKey = (uid: string) => 'zon:v1:cart:' + uid;
const orderKey = (uid: string) => 'zon:v1:orders:' + uid;
const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const passwordHash = (password: string, salt = randomBytes(16).toString('hex')) => salt + ':' + scryptSync(password, salt, 64).toString('hex');
function passwordMatches(password: string, saved: string) { const [salt, hex] = saved.split(':'); if (!salt || !hex) return false; const actual = scryptSync(password, salt, 64); const expected = Buffer.from(hex, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function userId(email: string) { return digest(email); }

export async function currentAccount(token?: string | null) {
  if (!token) return null;
  const redis = redisClient();
  if (!redis) {
    const uid = memory.sessions.get(token);
    if (!uid) return null;
    const account = [...memory.users.values()].find((u) => u.id === uid) ?? null;
    if (account) memory.active.add(uid);
    return account;
  }
  const uid = await redis.get<string>(sessionKey(token));
  if (!uid) return null;
  const account = await redis.get<Account>('zon:v1:account:' + uid);
  if (!account) return null;
  const expires = Math.floor(Date.now() / 1000) + TTL;
  await redis.expire(sessionKey(token), TTL);
  await redis.expire(userSessionKey(uid), TTL);
  await redis.zadd(ACTIVE, { score: expires, member: uid });
  return account;
}

async function opsState(): Promise<Ops> {
  const redis = redisClient();
  if (!redis) return memory.ops;
  const value = await redis.get<Ops>(OPS);
  return value ?? { crash: null, logs: [] };
}
export async function getSnapshot(token?: string | null, includeLogs = false) {
  const redis = redisClient();
  const account = await currentAccount(token);
  const ops = await opsState();
  let activeUsers: number;
  let cart: string[] = [];
  let wishlist: string[] = [];
  if (!redis) {
    activeUsers = memory.active.size;
    if (account) { cart = memory.carts.get(account.id) ?? []; wishlist = [...(memory.wishlists.get(account.id) ?? [])]; }
  } else {
    await redis.zremrangebyscore(ACTIVE, '-inf', Math.floor(Date.now() / 1000));
    activeUsers = await redis.zcard(ACTIVE);
    if (account) { cart = (await redis.get<string[]>(cartKey(account.id))) ?? []; wishlist = await redis.smembers('zon:v1:wishlist:' + account.id); }
  }
  return { crash: ops.crash, activeUsers, logs: includeLogs ? ops.logs : [], user: account ? { email: account.email, name: account.name } : null, cart: account ? cart : null, wishlist: account ? wishlist : [], storage: redis ? 'shared' : 'local-demo' };
}

export async function emitCrash(crash: Exclude<Crash, null>) {
  const redis = redisClient();
  const ops = await opsState();
  ops.crash = crash;
  const now = Date.now();
  ops.logs.push({ id: randomBytes(12).toString('hex'), at: new Date(now).toISOString(), level: crash === 'gateway' ? 'ERROR' : 'CRITICAL', message: high[crash] });
  const count = 8 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) { const message = noise[i % noise.length]; ops.logs.push({ id: randomBytes(12).toString('hex'), at: new Date(now + i + 1).toISOString(), level: message.startsWith('INFO') ? 'INFO' : 'WARNING', message }); }
  ops.logs = ops.logs.slice(-400);
  if (redis) await redis.set(OPS, ops); else memory.ops = ops;
}

async function findAccount(email: string): Promise<Account | null> {
  const redis = redisClient();
  return redis ? await redis.get<Account>(userKey(email)) : memory.users.get(email) ?? null;
}
async function saveAccount(account: Account) {
  const redis = redisClient();
  if (redis) { const result = await redis.set(userKey(account.email), account, { nx: true }); if (!result) throw new AuthError('ACCOUNT_EXISTS', 'An account with this email already exists. Sign in instead.'); await redis.set('zon:v1:account:' + account.id, account); }
  else { if (memory.users.has(account.email)) throw new AuthError('ACCOUNT_EXISTS', 'An account with this email already exists. Sign in instead.'); memory.users.set(account.email, account); }
}

const ADMIT_SCRIPT = "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); local exists = redis.call('ZSCORE', KEYS[1], ARGV[2]); if not exists and redis.call('ZCARD', KEYS[1]) >= 4 then return 0 end; local old = redis.call('GET', KEYS[3]); if old and old ~= ARGV[4] then redis.call('DEL', 'zon:v1:session:' .. old) end; redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2]); redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[5]); redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[5]); return redis.call('ZCARD', KEYS[1])";

async function createSession(account: Account) {
  const token = randomBytes(32).toString('base64url');
  const redis = redisClient();
  if (!redis) {
    if (chaosEnabled() && !memory.active.has(account.id) && memory.active.size >= 4) { await emitCrash('db'); throw new PoolLimitError('The store is experiencing unusually high traffic. Please try again later.'); }
    memory.active.add(account.id); memory.sessions.set(token, account.id); return token;
  }
  const now = Math.floor(Date.now() / 1000), expires = now + TTL;
  if (!chaosEnabled()) {
    const oldToken = await redis.get<string>(userSessionKey(account.id));
    if (oldToken) await redis.del(sessionKey(oldToken));
    await redis.zadd(ACTIVE, { score: expires, member: account.id });
    await redis.set(sessionKey(token), account.id, { ex: TTL });
    await redis.set(userSessionKey(account.id), token, { ex: TTL });
    return token;
  }
  const admitted = Number(await redis.eval(ADMIT_SCRIPT, [ACTIVE, sessionKey(token), userSessionKey(account.id)], [now, account.id, expires, token, TTL]));
  if (!admitted) { await emitCrash('db'); throw new PoolLimitError('The store is experiencing unusually high traffic. Please try again later.'); }
  return token;
}

export async function registerAccount(input: { email: unknown; password: unknown; name: unknown }) {
  if (!validEmail(input.email)) throw new AuthError('INVALID_EMAIL', 'Enter a valid email address.');
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 80) throw new AuthError('INVALID_NAME', 'Enter your name (2–80 characters).');
  if (typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 128) throw new AuthError('WEAK_PASSWORD', 'Use a password between 10 and 128 characters.');
  const email = input.email.trim().toLowerCase();
  const ops = await opsState();
  if (ops.crash) throw new AuthError('SERVICE_UNAVAILABLE', 'Sign-in is temporarily unavailable while we restore the store.');
  const account: Account = { id: userId(email), email, name: input.name.trim(), passwordHash: passwordHash(input.password), createdAt: new Date().toISOString() };
  await saveAccount(account);
  const token = await createSession(account);
  return { account, token };
}
export async function loginAccount(emailInput: unknown, password: unknown) {
  if (!validEmail(emailInput) || typeof password !== 'string' || password.length > 128) throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  const ops = await opsState();
  if (ops.crash) throw new AuthError('SERVICE_UNAVAILABLE', 'Sign-in is temporarily unavailable while we restore the store.');
  const account = await findAccount(emailInput.trim().toLowerCase());
  if (!account || !passwordMatches(password, account.passwordHash)) throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  const token = await createSession(account);
  return { account, token };
}
export async function logoutAccount(token?: string | null) {
  if (!token) return;
  const redis = redisClient();
  if (!redis) { const uid = memory.sessions.get(token); memory.sessions.delete(token); if (uid) memory.active.delete(uid); return; }
  const uid = await redis.get<string>(sessionKey(token));
  if (uid) { const activeToken = await redis.get<string>(userSessionKey(uid)); if (activeToken === token) { await redis.del(userSessionKey(uid)); await redis.zrem(ACTIVE, uid); } }
  await redis.del(sessionKey(token));
}

function validProductId(id: unknown) { return typeof id === 'string' && /^p[1-8]$/.test(id); }
function indexForProduct(id: string) { return Number(id.slice(1)) - 1; }
async function readCart(uid: string): Promise<string[]> { const redis = redisClient(); return redis ? ((await redis.get<string[]>(cartKey(uid))) as string[] | null) ?? [] : memory.carts.get(uid) ?? []; }
async function writeCart(uid: string, cart: string[]) { const redis = redisClient(); if (redis) await redis.set(cartKey(uid), cart); else memory.carts.set(uid, cart); }
export async function addCartItem(account: Account, id: unknown) { if (!validProductId(id)) throw new AuthError('INVALID_PRODUCT', 'That item is no longer available.'); const cart = await readCart(account.id); cart.push(String(id)); await writeCart(account.id, cart); return cart; }
export async function removeCartItem(account: Account, index: unknown) { if (!Number.isInteger(index) || Number(index) < 0) throw new AuthError('INVALID_CART', 'That cart item could not be removed.'); const cart = await readCart(account.id); cart.splice(Number(index), 1); await writeCart(account.id, cart); return cart; }
export async function toggleWishlist(account: Account, id: unknown) {
  if (!validProductId(id)) throw new AuthError('INVALID_PRODUCT', 'That item is no longer available.');
  const redis = redisClient();
  if (redis) { const key = 'zon:v1:wishlist:' + account.id; const exists = await redis.sismember(key, String(id)); if (exists) await redis.srem(key, String(id)); else await redis.sadd(key, String(id)); return await redis.smembers(key); }
  const items = memory.wishlists.get(account.id) ?? new Set<string>();
  if (items.has(String(id))) items.delete(String(id)); else items.add(String(id));
  memory.wishlists.set(account.id, items);
  return [...items];
}
export async function placeOrder(account: Account) {
  const cart = await readCart(account.id);
  if (!cart.length) throw new AuthError('EMPTY_CART', 'Your bag is empty. Add an item before checking out.');
  const lines: (typeof products)[number][] = cart.map((id) => products[indexForProduct(id)]).filter((p): p is (typeof products)[number] => Boolean(p));
  const order: Order = { id: 'ZON-' + randomBytes(4).toString('hex').toUpperCase(), at: new Date().toISOString(), lines: cart, total: lines.reduce((sum: number, p) => sum + p[2], 0) };
  const redis = redisClient();
  if (redis) { await redis.lpush(orderKey(account.id), order); await redis.del(cartKey(account.id)); }
  else { memory.orders.set(account.id, [order, ...(memory.orders.get(account.id) ?? [])]); memory.carts.set(account.id, []); }
  return order;
}
export async function subscribeNewsletter(emailInput: unknown) { if (!validEmail(emailInput)) throw new AuthError('INVALID_EMAIL', 'Enter a valid email address.'); const email = emailInput.trim().toLowerCase(); const redis = redisClient(); if (redis) await redis.sadd('zon:v1:newsletter', email); else memory.newsletter.add(email); }

export function adminAuthorized(header: string | null) { if (process.env.NODE_ENV !== 'production') return true; const expected = process.env.ZON_ADMIN_KEY; return Boolean(process.env.ENABLE_CHAOS === 'true' && expected && header && header === expected); }
export async function controlAction(action: string) {
  const redis = redisClient();
  if (action === 'reboot') {
    if (redis) { const ids = await redis.zrange(ACTIVE, 0, -1) as string[]; for (const uid of ids) { const token = await redis.get<string>(userSessionKey(uid)); if (token) await redis.del(sessionKey(token)); await redis.del(userSessionKey(uid)); } await redis.del(ACTIVE); await redis.set(OPS, { crash: null, logs: [] }); }
    else { memory.sessions.clear(); memory.active.clear(); memory.ops = { crash: null, logs: [] }; }
    return;
  }
  if (action === 'simulate-user') {
    if (redis) { const active = await redis.zrange(ACTIVE, 0, -1); while (active.length < 4) { const uid = 'simulated-' + randomBytes(8).toString('hex'); active.push(uid); await redis.zadd(ACTIVE, { score: Math.floor(Date.now() / 1000) + TTL, member: uid }); } }
    else while (memory.active.size < 4) memory.active.add('simulated-' + randomBytes(8).toString('hex'));
    await emitCrash('db'); return;
  }
  if (action === 'gateway' || action === 'dependency') { await emitCrash(action); return; }
  if (action === 'random-check') { if (process.env.ENABLE_CHAOS === 'true' && Math.random() < 0.15 && (await opsState()).crash === null) await emitCrash('gateway'); return; }
  throw new AuthError('UNKNOWN_ACTION', 'That action is not available.');
}
