// Limits are per process. The gateway must also limit traffic before it reaches Node.
export function securityHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  });
  next();
}

function reject(res, status, message, type = 'invalid_request_error') {
  return res.status(status).json({ error: { message, type } });
}

export function requireSameOrigin(config) {
  return (req, res, next) => {
    // Applied to reads too: external sessions must not be bootstrapped cross-site.
    const site = req.get('sec-fetch-site');
    const origin = req.get('origin');
    // Production cookies already require HTTPS, including TLS terminated at the gateway.
    // Use the original Host, never attacker-supplied X-Forwarded-* headers.
    const protocol = config.isProduction ? 'https' : req.protocol;
    const expected = config.publicBaseUrl || `${protocol}://${req.get('host')}`;
    if (site === 'cross-site' || (origin && origin !== expected)) {
      return reject(res, 403, 'Cross-origin admin request rejected', 'csrf_error');
    }
    return next();
  };
}

export function loginRateLimiter({ limit = 10, now = Date.now, windowMs = 60000 } = {}) {
  let resetAt = 0;
  let attempts = 0;
  return (_req, res, next) => {
    const time = now();
    if (time >= resetAt) { attempts = 0; resetAt = time + windowMs; }
    if (attempts >= limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - time) / 1000))));
      return reject(res, 429, 'Too many login attempts; try again later', 'rate_limit_error');
    }
    attempts += 1;
    return next();
  };
}

export function concurrencyLimit(max = 64) {
  let active = 0;
  return (req, res, next) => {
    if (active >= max) {
      if (!req.complete) res.set('Connection', 'close');
      res.set('Retry-After', '1');
      return reject(res, 429, 'Too many concurrent requests', 'rate_limit_error');
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
      res.off('close', release);
      res.off('finish', release);
    };
    res.once('close', release);
    res.once('finish', release);
    return next();
  };
}

export function limitJsonDepth(req, res, next) {
  const stack = [[req.body, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (depth > 32) return reject(res, 400, 'JSON nesting exceeds 32 levels');
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
  return next();
}
