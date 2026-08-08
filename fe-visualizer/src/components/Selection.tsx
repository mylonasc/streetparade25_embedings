import React, {useEffect, useRef, useState} from 'react';
import {Truck} from 'lucide-react';
import {modelSummary, playlistForPoint, visibleMetadataEntries} from '../selection';
import type {PlaylistTrack} from '../selection';
import {artistSetRange, parseTimeRange, truckNumber} from '../loveMobile';
import type {ArtistSummary, Point} from '../types';

type SelectionProps = {
  point: Point;
  playing: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSelectArtist?: () => void;
  onSelectTruck?: () => void;
  onPlaySimilar?: () => void;
  onRandomSong?: () => void;
  truckLikeScore?: number;
  truckArtists?: ArtistSummary[];
  onSelectTruckArtist?: (name: string) => void;
};

function TruckDetail({metadata, likeScore, artists, onSelectArtist}: {
  metadata: Record<string, unknown>;
  likeScore: number | undefined;
  artists: ArtistSummary[];
  onSelectArtist?: (name: string) => void;
}) {
  const range = parseTimeRange(typeof metadata.time === 'string' ? metadata.time : '');
  const truckUuid = typeof metadata.uuid === 'string' ? metadata.uuid : null;
  const facts: Array<[string, string | number | null]> = [];
  if (range) facts.push(['Time', `${range.start} – ${range.end}`]);
  if (metadata.genres) facts.push(['Genres', String(metadata.genres)]);
  if (metadata.motto) facts.push(['Motto', String(metadata.motto)]);
  if (metadata.source) facts.push(['Source', String(metadata.source)]);
  const artistSetTime = (artist: ArtistSummary): string | null => {
    const loveMobile = artist.loveMobiles.find((entry) => entry.uuid && entry.uuid === truckUuid);
    const range = artistSetRange(loveMobile || {});
    return range ? `${range.start}–${range.end}` : null;
  };
  return (
    <div className="truck-view">
      <div className="truck-score-row">
        <span>Like score</span>
        <b>{likeScore !== undefined && likeScore !== null ? likeScore.toFixed(2) : 'n/a'}</b>
      </div>
      {facts.length > 0 && (
        <dl className="truck-facts">
          {facts.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <div className="playlist">
        <div className="playlist-header">Acts on this truck · {artists.length}</div>
        {artists.map((artist) => (
          <button
            type="button"
            className="truck-artist-row"
            key={artist.key}
            onClick={() => onSelectArtist?.(artist.name)}
          >
            <span className="truck-artist-score">{artist.likeScore.toFixed(2)}</span>
            <strong>{artist.name}</strong>
            <span className="truck-artist-songs">{artist.trackCount} songs</span>
            {artistSetTime(artist) && <span className="time-shield">{artistSetTime(artist)}</span>}
          </button>
        ))}
        {!artists.length && <p className="muted">No acts from this truck are on the map.</p>}
      </div>
    </div>
  );
}

function ArtistSetShields({metadata}: {metadata: Record<string, unknown>}) {
  const loveMobiles = Array.isArray(metadata.love_mobiles) ? metadata.love_mobiles : [];
  const shields: Array<{key: string; label: string}> = [];
  for (const loveMobile of loveMobiles) {
    const range = artistSetRange(loveMobile as {set_start?: string; set_end?: string});
    if (!range) continue;
    const number = truckNumber(loveMobile as {number?: number | string; source_index?: number});
    shields.push({key: loveMobile.uuid ?? `${number}-${loveMobile.name ?? ''}`, label: `#${number} · ${range.start}–${range.end}`});
  }
  if (!shields.length) return null;
  return (
    <div className="artist-set-shields" aria-label="Set times">
      {shields.map((shield) => (
        <span className="time-shield" key={shield.key}>{shield.label}</span>
      ))}
    </div>
  );
}

export function Selection({
  point, playing, onUndo, onRedo, canUndo, canRedo,
  onSelectArtist, onSelectTruck, onPlaySimilar, onRandomSong,
  truckLikeScore, truckArtists, onSelectTruckArtist,
}: SelectionProps) {
  const metadata = point.metadata || {};
  const model = modelSummary(metadata);
  const playlist = playlistForPoint(point);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTrack: PlaylistTrack | null = playlist[activeIndex] || null;

  useEffect(() => {
    setActiveIndex(0);
  }, [point.id]);

  const isTruck = point.kind === 'truck';
  const showArtistButton = !isTruck && point.kind !== 'artist' && Boolean(onSelectArtist);
  const showTruckButton = point.kind === 'artist' && Boolean(onSelectTruck);

  return (
    <div>
      <p className="eyebrow">
        {isTruck ? (
          <>
            <Truck size={14} aria-hidden="true" /> Love Mobile #{truckNumber(metadata)}
          </>
        ) : point.kind}
      </p>
      <h3>{point.label}</h3>
      <div className="selection-history">
        <button type="button" className="secondary" onClick={onUndo} disabled={!canUndo}>Undo selection</button>
        <button type="button" className="secondary" onClick={onRedo} disabled={!canRedo}>Redo selection</button>
      </div>
      <p className="shortcut-hint">Shortcuts: Ctrl+Z undo, Ctrl+R redo.</p>
      <div className="selection-actions">
        {showArtistButton && <button type="button" className="secondary" onClick={onSelectArtist}>Artist</button>}
        {showTruckButton && <button type="button" className="secondary" onClick={onSelectTruck}>Truck</button>}
        {onPlaySimilar && <button type="button" className="secondary" onClick={onPlaySimilar}>Play similar</button>}
        {onRandomSong && <button type="button" className="secondary" onClick={onRandomSong}>Random song</button>}
      </div>
      {activeTrack?.soundcloudUrl && <SoundCloudPlayer key={activeTrack.soundcloudUrl} url={activeTrack.soundcloudUrl} playing={playing} />}
      {activeTrack?.localUrl && <LocalAudio key={activeTrack.localUrl} src={activeTrack.localUrl} playing={playing} />}
      {isTruck ? (
        <TruckDetail metadata={metadata} likeScore={truckLikeScore} artists={truckArtists || []} onSelectArtist={onSelectTruckArtist} />
      ) : point.kind === 'artist' ? (
        <>
          <ArtistSetShields metadata={metadata} />
          <div className="playlist">
            <div className="playlist-header">Artist playlist · {playlist.length} songs</div>
            {playlist.map((track, index) => (
              <button
                type="button"
                className={`playlist-track ${index === activeIndex ? 'active' : ''}`}
                key={`${track.title}-${track.soundcloudUrl || track.localUrl || index}`}
                onClick={() => setActiveIndex(index)}
              >
                <span>{index + 1}</span>
                <strong>{track.title}</strong>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <dl>{visibleMetadataEntries(metadata).map(([key, value]) => <React.Fragment key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>
      {model && <p className="model-note">Embedding model: {model}</p>}
    </div>
  );
}

function SoundCloudPlayer({url, playing}: {url: string; playing: boolean}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const widgetRef = useRef<SoundCloudWidgetApi | null>(null);
  const playingRef = useRef(playing);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

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
      if (playingRef.current) widget.play(() => setNeedsTap(false));
      window.setTimeout(() => {
        widget.isPaused((paused) => setNeedsTap(Boolean(paused)));
      }, 700);
    });
  }, [url]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return;
    if (playing) widget.play(() => setNeedsTap(false));
    else widget.pause();
  }, [playing]);

  function playInPage() {
    const widget = widgetRef.current;
    if (!widget) return;
    widget.play(() => setNeedsTap(false));
  }

  return (
    <div className="soundcloud-player">
      <iframe
        ref={iframeRef}
        title="SoundCloud"
        width="100%"
        height="166"
        scrolling="no"
        frameBorder="no"
        allow="autoplay"
        src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&show_artwork=false&visual=false&buying=false&sharing=false&download=false&show_comments=false`}
      />
      {needsTap && (
        <button type="button" className="inline-play" onClick={playInPage}>
          Tap to play embedded track
        </button>
      )}
    </div>
  );
}

function LocalAudio({src, playing}: {src: string; playing: boolean}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    if (playing) element.play().catch(() => {});
    else element.pause();
  }, [playing, src]);

  return <audio key={src} ref={audioRef} src={src} controls />;
}
