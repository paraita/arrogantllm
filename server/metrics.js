export function createMetrics({ now = () => new Date().toISOString() } = {}) {
  let totalRequests = 0;
  let lastRequestAt = null;
  const requestsByEndpoint = new Map();

  return {
    record(endpoint) {
      if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) return;
      totalRequests += 1;
      lastRequestAt = now();
      requestsByEndpoint.set(endpoint, (requestsByEndpoint.get(endpoint) || 0) + 1);
    },
    summary() {
      return {
        totalRequests,
        lastRequestAt,
        requestsByEndpoint: Object.fromEntries(requestsByEndpoint),
      };
    },
  };
}
