export const API_BASE_URL = resolveApiBaseUrl();
export const ANNOTATION_API_BASE_URL = resolveAnnotationApiBaseUrl();

export function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof window === 'undefined') return (configured || 'http://localhost:8000').replace(/\/$/, '');
  const browserHost = window.location.hostname;
  if (configured && !(isLoopbackUrl(configured) && !isLoopbackHost(browserHost))) {
    return configured.replace(/\/$/, '');
  }
  return `${window.location.protocol}//${browserHost}:8000`;
}

export function resolveAnnotationApiBaseUrl() {
  const configured = import.meta.env.VITE_ANNOTATION_API_BASE_URL;
  if (typeof window === 'undefined') return (configured || 'http://localhost:8100').replace(/\/$/, '');
  const browserHost = window.location.hostname;
  if (configured && !(isLoopbackUrl(configured) && !isLoopbackHost(browserHost))) {
    return configured.replace(/\/$/, '');
  }
  return `${window.location.protocol}//${browserHost}:8100`;
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

export async function annotationRequest(path, options = {}) {
  const response = await fetch(`${ANNOTATION_API_BASE_URL}${path}`, {
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

export async function getAllEmbeddedTracks({pageSize = 500} = {}) {
  const tracks = [];
  let page = 1;
  while (true) {
    const data = await request(`/tracks?page=${page}&page_size=${pageSize}&include_embedding=true`);
    tracks.push(...(data.tracks || []).filter((track) => Array.isArray(track.embedding) && track.embedding.length));
    if (!data.has_next) break;
    page += 1;
  }
  return tracks;
}

export async function getAnnotationCampaigns() {
  return await annotationRequest('/annotation_campaign');
}

export async function getCampaignLabelSets(campaignId) {
  return await annotationRequest(`/annotation_campaign/${campaignId}/label-sets`);
}

export async function getLabelSetLabels(labelSetId) {
  return await annotationRequest(`/label-sets/${labelSetId}/labels`);
}

export async function getCampaignSamples(campaignId) {
  return await annotationRequest(`/annotation_campaign/${campaignId}/samples`);
}
