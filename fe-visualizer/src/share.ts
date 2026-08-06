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

export function serializeLikedTrucks(trucks: {truck: {number?: number | string; source_index?: number; name?: string; title?: string; genres?: string; time?: string}; artists: string[]; score?: number}[]): {
  number: string;
  name: string;
  genres: string;
  time: string;
  artists: string[];
  score: number;
}[] {
  return trucks.map(({truck, artists, score = 0}) => ({
    number: truckNumber(truck),
    name: truck.name || truck.title || '',
    genres: truck.genres || '',
    time: truck.time || '',
    artists,
    score,
  }));
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
