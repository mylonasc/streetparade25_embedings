export const API_BASE_URL = resolveApiBaseUrl();

export function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof window === 'undefined') return (configured || 'http://localhost:8000').replace(/\/$/, '');
  const browserHost = window.location.hostname;
  if (isLoopbackHost(browserHost)) {
    if (configured) return configured.replace(/\/$/, '');
    return `${window.location.protocol}//${browserHost}:8000`;
  }
  if (configured && !isLoopbackUrl(configured)) {
    return configured.replace(/\/$/, '');
  }
  const pathname = window.location.pathname.replace(/\/+$/, '');
  return `${pathname}/api`;
}

function isLoopbackUrl(value) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

export async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.detail || response.statusText);
  return data;
}

export async function getUserPreferences(username) {
  const data = await request(`/users/${encodeURIComponent(username)}/preferences`);
  return data.preferences || {};
}

export async function setUserPreference(username, target, value) {
  const data = await request(`/users/${encodeURIComponent(username)}/preferences`, {
    method: 'POST',
    body: JSON.stringify({...target, value}),
  });
  return data.preferences || {};
}
