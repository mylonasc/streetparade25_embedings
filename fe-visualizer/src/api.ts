import type {PreferenceTarget} from './types';

export const API_BASE_URL = resolveApiBaseUrl();

type ApiBaseUrlInput = {
  configured?: string;
  location?: Pick<Location, 'hostname' | 'pathname' | 'protocol'>;
  moduleUrl?: string;
};

export function resolveApiBaseUrl(): string {
  return resolveApiBaseUrlFor({
    configured: import.meta.env.VITE_API_BASE_URL as string | undefined,
    location: typeof window === 'undefined' ? undefined : window.location,
    moduleUrl: import.meta.url,
  });
}

export function resolveApiBaseUrlFor({configured, location, moduleUrl}: ApiBaseUrlInput): string {
  if (!location) return (configured || 'http://localhost:8000').replace(/\/$/, '');
  const browserHost = location.hostname;
  if (isLoopbackHost(browserHost)) {
    if (configured) return configured.replace(/\/$/, '');
    return `${location.protocol}//${browserHost}:8000`;
  }
  if (configured && !isLoopbackUrl(configured)) {
    return configured.replace(/\/$/, '');
  }
  const pathname = resolveDeployedBasePath(moduleUrl, location.pathname);
  return `${pathname}/api`;
}

function resolveDeployedBasePath(moduleUrl: string | undefined, pathname: string): string {
  if (moduleUrl) {
    try {
      const modulePath = new URL(moduleUrl).pathname;
      const assetsIndex = modulePath.indexOf('/assets/');
      if (assetsIndex >= 0) return modulePath.slice(0, assetsIndex).replace(/\/+$/, '');
    } catch {
      // Fall through to the current path when the module URL is not absolute.
    }
  }
  return pathname.replace(/\/+$/, '');
}

function isLoopbackUrl(value: string): boolean {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    ...options,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) throw new Error((data as {detail?: string})?.detail || response.statusText);
  return data as T;
}

export async function getUserPreferences(username: string): Promise<Record<string, string>> {
  const data = await request<{preferences?: Record<string, string>}>(`/users/${encodeURIComponent(username)}/preferences`);
  return data.preferences || {};
}

export async function setUserPreference(username: string, target: PreferenceTarget, value: string): Promise<Record<string, string>> {
  const data = await request<{preferences?: Record<string, string>}>(`/users/${encodeURIComponent(username)}/preferences`, {
    method: 'POST',
    body: JSON.stringify({...target, value}),
  });
  return data.preferences || {};
}
