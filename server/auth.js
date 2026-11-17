import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'fake_llm_admin';
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function constantTimeEqual(actual, expected) {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function verifyAdminPassword(username, password, config) {
  return constantTimeEqual(username ?? '', config.adminUsername)
    && constantTimeEqual(password ?? '', config.adminPassword);
}

export function createAdminSession(secret, username, { now = Date.now(), ttlMs = ADMIN_SESSION_TTL_MS } = {}) {
  const payload = {
    sub: username,
    csrf: randomBytes(24).toString('base64url'),
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return { token: `${encoded}.${signature}`, payload };
}

export function verifyAdminSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  let actual;
  try {
    actual = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string' || typeof payload.csrf !== 'string') return null;
    if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(now / 1000)) return null;
    if (!Number.isInteger(payload.iat) || payload.iat > Math.floor(now / 1000) + 60) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashApiToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function matchesApiToken(token, expectedHash) {
  if (typeof token !== 'string' || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(hashApiToken(token), 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return result;
}

export function formatAdminCookie(token, { secure = false, maxAge = ADMIN_SESSION_TTL_MS } = {}) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${Math.floor(maxAge / 1000)}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearAdminCookie({ secure = false } = {}) {
  const parts = [`${ADMIN_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
