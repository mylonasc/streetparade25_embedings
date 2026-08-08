import {MapPinned, Truck} from 'lucide-react';
import {useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {parseTimeRange} from '../loveMobile';
import {eventRangeFromTrucks, rangeInMinutes, truckOverlapsWindow} from '../truckTime';
import type {ClockRange, MinuteRange} from '../truckTime';
import {TimeRangeSlider, TruckTimeWidget, slotLabel} from './TruckTimeWidget';
import type {SharedPayload, SharedTruck} from '../types';

type TruckSort = 'score' | 'order';

type ActiveTrack = {
  label: string;
  url: string;
};

export function SharedFavoritesPage({payload, onEnter}: {payload: SharedPayload; onEnter: () => void}) {
  const trucks = Array.isArray(payload.likedTrucks) ? payload.likedTrucks : [];
  const artists = Array.isArray(payload.likedArtists) ? payload.likedArtists : [];
  const eventRange = useMemo<ClockRange | null>(() => {
    if (payload.eventStart && payload.eventEnd) return {start: payload.eventStart, end: payload.eventEnd};
    return eventRangeFromTrucks(trucks);
  }, [payload.eventStart, payload.eventEnd, trucks]);
  const eventMinutes = eventRange ? rangeInMinutes(eventRange) : null;
  const [sort, setSort] = useState<TruckSort>('score');
  const [minScore, setMinScore] = useState(0);
  const [timeWindow, setTimeWindow] = useState<MinuteRange | null>(eventMinutes);
  useEffect(() => {
    setTimeWindow(eventMinutes);
  }, [eventMinutes]);
  const [activeTrack, setActiveTrack] = useState<ActiveTrack | null>(null);
  const timeFilteredTrucks = timeWindow ? trucks.filter((truck) => truckOverlapsWindow(truck.time, timeWindow)) : trucks;
  const filteredTrucks = timeFilteredTrucks.filter((truck) => truck.score >= minScore);
  const sortedTrucks = [...filteredTrucks].sort(sort === 'score' ? byScore : byOrder);
  return (
    <main className="share-page">
      <section className="share-page-card">
        <p className="eyebrow"><Truck size={16} aria-hidden="true" /> Shared favorites</p>
        <h1>{payload.username || 'Someone'}&rsquo;s favorites</h1>
        <p className="muted">Street Parade 2026 acts this user liked or is likely to like, and the love mobiles where you can catch them.</p>

        {activeTrack && <SoundCloudPlayer url={activeTrack.url} label={activeTrack.label} onClose={() => setActiveTrack(null)} />}

        <h2>Love mobiles</h2>
        {trucks.length ? (
          <>
            <div className="share-sort" aria-label="Sort love mobiles">
              <button type="button" className={sort === 'score' ? '' : 'secondary'} aria-pressed={sort === 'score'} onClick={() => setSort('score')}>Sort by score</button>
              <button type="button" className={sort === 'order' ? '' : 'secondary'} aria-pressed={sort === 'order'} onClick={() => setSort('order')}>Sort by order</button>
            </div>
            <label className="share-score-filter">
              <span>Minimum score <b>{formatScore(minScore)}</b></span>
              <input type="range" min="0" max="1" step="0.05" value={minScore} aria-label="Minimum truck score" onChange={(event) => setMinScore(Number(event.target.value))} />
            </label>
            {eventMinutes && (
              <div className="time-range-wrap">
                <TimeRangeSlider
                  min={eventMinutes.start}
                  max={eventMinutes.end}
                  from={timeWindow?.start ?? eventMinutes.start}
                  until={timeWindow?.end ?? eventMinutes.end}
                  onChange={(from, until) => setTimeWindow({start: from, end: until})}
                />
              </div>
            )}
            {sortedTrucks.length ? (
              <ul className="liked-trucks-list">
                {sortedTrucks.map((truck, index) => {
                  const range = parseTimeRange(truck.time);
                  const soundcloudUrl = truck.soundcloudUrl || '';
                  return (
                    <li
                      key={`${truck.number}-${index}`}
                      className={soundcloudUrl ? 'liked-truck-box' : ''}
                      role={soundcloudUrl ? 'button' : undefined}
                      tabIndex={soundcloudUrl ? 0 : undefined}
                      aria-pressed={soundcloudUrl ? activeTrack?.url === soundcloudUrl : undefined}
                      aria-label={soundcloudUrl ? `Play ${truck.name || truck.number} on SoundCloud` : undefined}
                      onClick={soundcloudUrl ? () => setActiveTrack({label: truck.name || `Truck ${truck.number}`, url: soundcloudUrl}) : undefined}
                      onKeyDown={soundcloudUrl ? (event) => handleBoxKeyDown(event, () => setActiveTrack({label: truck.name || `Truck ${truck.number}`, url: soundcloudUrl})) : undefined}
                    >
                      <span className="liked-truck-number">#{truck.number}</span>
                      <span className="liked-truck-detail">
                        <strong>{truck.name}</strong>
                        {range && <span className="liked-truck-time">{range.start}–{range.end}</span>}
                        <TruckTimeWidget eventRange={eventRange} truckTime={truck.time} likedSlots={truck.artistSlots} />
                        {truck.genres && <span className="muted">{truck.genres}</span>}
                        <span className="liked-truck-score">Score {formatScore(truck.score)}</span>
                        {truck.artists.length > 0 && <span className="muted">Acts: {truck.artists.join(', ')}</span>}
                        {Array.isArray(truck.artistSlots) && truck.artistSlots.length > 0 && (
                          <span className="liked-truck-slots" aria-label="Liked acts with set times">
                            {truck.artistSlots.map((slot, slotIndex) => (
                              <span className="truck-act-slot" key={`${slot.name ?? slotIndex}-${slotIndex}`}>{slotLabel(slot)}</span>
                            ))}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">No love mobiles at or above {formatScore(minScore)}.</p>
            )}
          </>
        ) : (
          <p className="muted">No love mobiles in this share.</p>
        )}

        <h2>Acts</h2>
        {artists.length ? (
          <div className="shared-artists" aria-label="Liked acts">
            {artists.map((entry) => {
              const name = typeof entry === 'string' ? entry : entry.name;
              const score = typeof entry === 'string' ? null : entry.score;
              const soundcloudUrl = typeof entry === 'string' ? '' : entry.soundcloudUrl || '';
              return (
                <span
                  className={`shared-artist-chip${soundcloudUrl ? ' clickable' : ''}`}
                  key={name}
                  role={soundcloudUrl ? 'button' : undefined}
                  tabIndex={soundcloudUrl ? 0 : undefined}
                  aria-pressed={soundcloudUrl ? activeTrack?.url === soundcloudUrl : undefined}
                  aria-label={soundcloudUrl ? `Play ${name} on SoundCloud` : undefined}
                  onClick={soundcloudUrl ? () => setActiveTrack({label: name, url: soundcloudUrl}) : undefined}
                  onKeyDown={soundcloudUrl ? (event) => handleBoxKeyDown(event, () => setActiveTrack({label: name, url: soundcloudUrl})) : undefined}
                >
                  {name}
                  {score !== null && score !== undefined && Number.isFinite(score) && <span className="shared-artist-score">Like {formatScore(score)}</span>}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="muted">No liked acts in this share.</p>
        )}

        <button type="button" onClick={onEnter}><MapPinned size={18} aria-hidden="true" /> Explore the map</button>
      </section>
    </main>
  );
}

function SoundCloudPlayer({url, label, onClose}: {url: string; label: string; onClose: () => void}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const widgetRef = useRef<SoundCloudWidgetApi | null>(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    setNeedsTap(false);
    widgetRef.current = null;
    const iframe = iframeRef.current;
    const sc = window.SC;
    if (!iframe || !sc?.Widget) {
      setNeedsTap(true);
      return;
    }
    const widget = sc.Widget(iframe);
    widgetRef.current = widget;
    widget.bind(sc.Widget.Events.READY, () => {
      widget.play(() => setNeedsTap(false));
      window.setTimeout(() => {
        widget.isPaused((paused) => setNeedsTap(Boolean(paused)));
      }, 700);
    });
  }, [url]);

  function playInPage() {
    const widget = widgetRef.current;
    if (!widget) return;
    widget.play(() => setNeedsTap(false));
  }

  return (
    <div className="share-player">
      <div className="share-player-header">
        <span className="share-player-label">Now playing: <strong>{label}</strong></span>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
      <div className="soundcloud-player">
        <iframe
          ref={iframeRef}
          title="SoundCloud"
          width="100%"
          height="166"
          scrolling="no"
          frameBorder="no"
          allow="autoplay"
          src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&show_artwork=false&visual=false&buying=false&sharing=false&download=false&show_comments=false`}
        />
        {needsTap && (
          <button type="button" className="inline-play" onClick={playInPage}>
            Tap to play embedded track
          </button>
        )}
      </div>
    </div>
  );
}

function byScore(a: SharedTruck, b: SharedTruck): number {
  return b.score - a.score || numericTruckNumber(a) - numericTruckNumber(b);
}

function handleBoxKeyDown(event: KeyboardEvent<HTMLElement>, activate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activate();
  }
}

function byOrder(a: SharedTruck, b: SharedTruck): number {
  return numericTruckNumber(a) - numericTruckNumber(b) || b.score - a.score;
}

function numericTruckNumber(truck: SharedTruck): number {
  const parsed = Number(truck.number);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'n/a';
  return Number(score).toFixed(2);
}
