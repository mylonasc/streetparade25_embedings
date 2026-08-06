import React, {useEffect, useRef, useState} from 'react';
import {modelSummary, playlistForPoint, visibleMetadataEntries} from '../selection';
import type {PlaylistTrack} from '../selection';
import type {Point} from '../types';

type SelectionProps = {
  point: Point;
  playing: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSelectArtist?: () => void;
  onPlaySimilar?: () => void;
  onRandomSong?: () => void;
};

export function Selection({
  point, playing, onUndo, onRedo, canUndo, canRedo,
  onSelectArtist, onPlaySimilar, onRandomSong,
}: SelectionProps) {
  const metadata = point.metadata || {};
  const model = modelSummary(metadata);
  const playlist = playlistForPoint(point);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTrack: PlaylistTrack | null = playlist[activeIndex] || null;

  useEffect(() => {
    setActiveIndex(0);
  }, [point.id]);

  return (
    <div>
      <p className="eyebrow">{point.kind}</p>
      <h3>{point.label}</h3>
      <div className="selection-history">
        <button type="button" className="secondary" onClick={onUndo} disabled={!canUndo}>Undo selection</button>
        <button type="button" className="secondary" onClick={onRedo} disabled={!canRedo}>Redo selection</button>
      </div>
      <p className="shortcut-hint">Shortcuts: Ctrl+Z undo, Ctrl+R redo.</p>
      <div className="selection-actions">
        {point.kind !== 'artist' && onSelectArtist && <button type="button" className="secondary" onClick={onSelectArtist}>Artist</button>}
        {onPlaySimilar && <button type="button" className="secondary" onClick={onPlaySimilar}>Play similar</button>}
        {onRandomSong && <button type="button" className="secondary" onClick={onRandomSong}>Random song</button>}
      </div>
      {activeTrack?.soundcloudUrl && <SoundCloudPlayer key={activeTrack.soundcloudUrl} url={activeTrack.soundcloudUrl} playing={playing} />}
      {activeTrack?.localUrl && <LocalAudio key={activeTrack.localUrl} src={activeTrack.localUrl} playing={playing} />}
      {point.kind === 'artist' && (
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
      )}
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
