import {MapPinned, Truck} from 'lucide-react';
import {parseTimeRange} from '../loveMobile';
import type {SharedPayload} from '../types';

export function SharedFavoritesPage({payload, onEnter}: {payload: SharedPayload; onEnter: () => void}) {
  const trucks = Array.isArray(payload.likedTrucks) ? payload.likedTrucks : [];
  const artists = Array.isArray(payload.likedArtists) ? payload.likedArtists : [];
  return (
    <main className="share-page">
      <section className="share-page-card">
        <p className="eyebrow"><Truck size={16} aria-hidden="true" /> Shared favorites</p>
        <h1>{payload.username || 'Someone'}&rsquo;s favorites</h1>
        <p className="muted">Street Parade 2026 acts this user liked or is likely to like, and the love mobiles where you can catch them.</p>

        <h2>Love mobiles</h2>
        {trucks.length ? (
          <ul className="liked-trucks-list">
            {trucks.map((truck, index) => {
              const range = parseTimeRange(truck.time);
              return (
                <li key={`${truck.number}-${index}`}>
                  <span className="liked-truck-number">#{truck.number}</span>
                  <span className="liked-truck-detail">
                    <strong>{truck.name}</strong>
                    {range && <span className="liked-truck-time">{range.start}–{range.end}</span>}
                    {truck.genres && <span className="muted">{truck.genres}</span>}
                    <span className="liked-truck-score">Score {formatScore(truck.score)}</span>
                    {truck.artists.length > 0 && <span className="muted">Acts: {truck.artists.join(', ')}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No love mobiles in this share.</p>
        )}

        <h2>Acts</h2>
        {artists.length ? (
          <div className="shared-artists" aria-label="Liked acts">
            {artists.map((name) => <span className="shared-artist-chip" key={name}>{name}</span>)}
          </div>
        ) : (
          <p className="muted">No liked acts in this share.</p>
        )}

        <button type="button" onClick={onEnter}><MapPinned size={18} aria-hidden="true" /> Explore the map</button>
      </section>
    </main>
  );
}

function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'n/a';
  return Number(score).toFixed(2);
}
