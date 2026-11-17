let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

async function request(path, { method = 'GET', body, csrf = false, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (csrf && csrfToken) headers.set('x-csrf-token', csrfToken);

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Request failed (${response.status})`);
  return data;
}

const admin = '/api/admin';

export const api = Object.freeze({
  session: () => request(`${admin}/session`),
  login: async (credentials) => {
    const result = await request(`${admin}/login`, { method: 'POST', body: credentials });
    setCsrfToken(result.csrfToken);
    return result;
  },
  logout: () => request(`${admin}/logout`, { method: 'POST', csrf: true }),
  models: async () => (await request(`${admin}/models`)).data,
  createModel: (model) => request(`${admin}/models`, { method: 'POST', body: model, csrf: true }),
  updateModel: (id, patch) => request(`${admin}/models/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, csrf: true }),
  deleteModel: (id) => request(`${admin}/models/${encodeURIComponent(id)}`, { method: 'DELETE', csrf: true }),
  tokens: async () => (await request(`${admin}/tokens`)).data,
  createToken: (name) => request(`${admin}/tokens`, { method: 'POST', body: { name }, csrf: true }),
  deleteToken: (id) => request(`${admin}/tokens/${encodeURIComponent(id)}`, { method: 'DELETE', csrf: true }),
  settings: () => request(`${admin}/settings`),
  saveSettings: (settings) => request(`${admin}/settings`, { method: 'PUT', body: settings, csrf: true }),
  summary: () => request(`${admin}/summary`),
  searchModels: async (query, limit = 10) => (await request(`${admin}/marketplaces/huggingface/search?q=${encodeURIComponent(query)}&limit=${limit}`)).data,
  importModel: (repoId) => request(`${admin}/marketplaces/huggingface/import`, { method: 'POST', body: { repoId }, csrf: true }),
});
