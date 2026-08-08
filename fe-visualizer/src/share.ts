export const SHARE_TEXT = 'Street Parade 2026 — explore the embedding visualizer map.';

export function buildShareLink(): string {
  return window.location.href;
}

export function telegramShareUrl(link: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

export function whatsAppShareUrl(link: string, text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`;
}

export function serializeLikedTrucks(trucks: {truck: {number?: number | string; source_index?: number; name?: string; title?: string; genres?: string; time?: string; links?: Array<Record<string, unknown>>; artist_links?: Array<Record<string, unknown>>}; artists: string[]; artistSlots?: Array<{name?: string; set_order?: number | null; set_start?: string | null; set_end?: string | null}>; score?: number}[]): {
  number: string;
  name: string;
  genres: string;
  time: string;
  artists: string[];
  artistSlots?: Array<{name?: string; set_order?: number | null; set_start?: string | null; set_end?: string | null}>;
  score: number;
  soundcloudUrl: string;
}[] {
  return trucks.map(({truck, artists, artistSlots = [], score = 0}) => ({
    number: truckNumber(truck),
    name: truck.name || truck.title || '',
    genres: truck.genres || '',
    time: truck.time || '',
    artists,
    artistSlots: artistSlots.length ? artistSlots : undefined,
    score,
    soundcloudUrl: soundcloudUrlFromLinks(truck.links, truck.artist_links),
  }));
}

export function soundcloudUrlFromLinks(...linkLists: Array<Array<Record<string, unknown>> | null | undefined>): string {
  for (const links of linkLists) {
    if (!Array.isArray(links)) continue;
    for (const link of links) {
      const url = typeof link?.url === 'string' ? link.url : '';
      const type = typeof link?.type === 'string' ? link.type : '';
      if (type === 'soundcloud' || url.includes('soundcloud.com')) return url;
    }
  }
  return '';
}

export function soundcloudUrlFromTracks(tracks: Array<{url?: string; source_url?: string}> | null | undefined): string {
  if (!Array.isArray(tracks)) return '';
  for (const track of tracks) {
    const url = typeof track?.url === 'string' ? track.url : (typeof track?.source_url === 'string' ? track.source_url : '');
    if (url && url.includes('soundcloud.com')) return url;
  }
  return '';
}

export function shareBlurb(username: string, truckCount: number, artistCount: number): string {
  if (truckCount > 0) return `${username}'s Street Parade 2026 favorites: ${truckCount} love mobile${truckCount === 1 ? '' : 's'} and ${artistCount} act${artistCount === 1 ? '' : 's'}.`;
  return `${username}'s Street Parade 2026 favorites.`;
}

function truckNumber(truck: {number?: number | string; source_index?: number}): string {
  const number = truck.number ?? truck.source_index;
  return number !== undefined && number !== null ? String(number) : '';
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const element = document.createElement('textarea');
    element.value = text;
    element.setAttribute('readonly', '');
    element.style.position = 'fixed';
    element.style.opacity = '0';
    document.body.appendChild(element);
    element.select();
    const ok = document.execCommand('copy');
    element.remove();
    return ok;
  } catch {
    return false;
  }
}
