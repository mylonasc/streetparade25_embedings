import type {ReactNode} from 'react';
import type {Edge, Point, PreferenceValue} from './types';

export type TooltipHandlers = {
  onThumb: (point: Point, value: PreferenceValue) => void;
  onSelectArtist?: (point: Point) => void;
  onPlayArtistSong?: (point: Point) => void;
  onPlaySimilar?: () => void;
  onRandomSong?: () => void;
};

export type TooltipData =
  | {type: 'point'; point: Point; thumbValue: PreferenceValue | null | undefined}
  | {type: 'edge'; edge: Edge; byId: Map<string, Point>};

function ThumbButtons({value, onThumb}: {value: PreferenceValue | null | undefined; onThumb: (value: PreferenceValue) => void}) {
  return (
    <>
      <button
        type="button"
        className={`thumb-button thumb-up ${value === 'up' ? 'active' : ''}`}
        aria-pressed={value === 'up'}
        aria-label="Thumbs up"
        onClick={() => onThumb('up')}
      >
        👍
      </button>
      <button
        type="button"
        className={`thumb-button thumb-down ${value === 'down' ? 'active' : ''}`}
        aria-pressed={value === 'down'}
        aria-label="Thumbs down"
        onClick={() => onThumb('down')}
      >
        👎
      </button>
    </>
  );
}

function PointTooltipContent({point, thumbValue, handlers}: {point: Point; thumbValue: PreferenceValue | null | undefined; handlers: TooltipHandlers}) {
  const metadata = point.metadata || {};
  if (point.kind === 'track' || point.kind === 'user_track') {
    const rows: Array<[string, string | number | null]> = [
      ['Artist', metadata.artist_name || metadata.artist || 'Unknown'],
      ['Song', metadata.title || point.label],
      ['Cluster', point.cluster],
    ];
    return (
      <>
        <strong>{metadata.title || point.label}</strong>
        {rows.map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}
        <div className="tooltip-actions">
          <ThumbButtons value={thumbValue} onThumb={(value) => handlers.onThumb(point, value)} />
          {handlers.onSelectArtist && <button type="button" aria-label="Select artist" onClick={() => handlers.onSelectArtist?.(point)}>Artist</button>}
          {handlers.onPlaySimilar && <button type="button" aria-label="Play connected song" onClick={handlers.onPlaySimilar}>▶</button>}
          {handlers.onRandomSong && <button type="button" aria-label="Random song" onClick={handlers.onRandomSong}>⏭</button>}
        </div>
      </>
    );
  }
  if (point.kind === 'artist') {
    const rows: Array<[string, string | number | null]> = [
      ['Artist', metadata.artist_name || point.label],
      ['Tracks', metadata.track_count || (metadata.tracks || []).length || 0],
      ['Cluster', point.cluster],
    ];
    return (
      <>
        <strong>{point.label}</strong>
        {rows.map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}
        <div className="tooltip-actions">
          <ThumbButtons value={thumbValue} onThumb={(value) => handlers.onThumb(point, value)} />
          {handlers.onPlayArtistSong && <button type="button" aria-label="Select artist song" onClick={() => handlers.onPlayArtistSong?.(point)}>▶ song</button>}
          {handlers.onRandomSong && <button type="button" aria-label="Random song" onClick={handlers.onRandomSong}>⏭</button>}
        </div>
      </>
    );
  }
  const rows: Array<[string, string | number | null]> = [];
  if (metadata.artist_name || metadata.artist) rows.push(['Artist', metadata.artist_name || metadata.artist || '']);
  if (metadata.title) rows.push(['Title', metadata.title]);
  if (metadata.track_count) rows.push(['Tracks', metadata.track_count]);
  if (metadata.source_type) rows.push(['Source', metadata.source_type]);
  if (metadata.cluster !== undefined || point.cluster !== undefined) rows.push(['Cluster', point.cluster]);
  if (metadata.url || metadata.source_url) rows.push(['URL', metadata.url || metadata.source_url || '']);
  return (
    <>
      <strong>{point.label}</strong>
      <span>{point.kind}</span>
      {rows.map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}
    </>
  );
}

function EdgeTooltipContent({edge, byId}: {edge: Edge; byId: Map<string, Point>}) {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  const rows: Array<[string, string | number]> = [
    ['From', source?.label || edge.source],
    ['To', target?.label || edge.target],
  ];
  if (edge.metric) rows.push(['Metric', edge.metric]);
  if (edge.similarity !== null && edge.similarity !== undefined) rows.push(['Similarity', Number(edge.similarity).toFixed(4)]);
  if (edge.distance !== null && edge.distance !== undefined) rows.push(['Distance', Number(edge.distance).toFixed(4)]);
  return (
    <>
      <strong>Similarity edge</strong>
      {rows.map(([key, value]) => <span key={key}>{key}: {value}</span>)}
    </>
  );
}

export function TooltipContent({data, handlers}: {data: TooltipData; handlers: TooltipHandlers}): ReactNode {
  if (data.type === 'edge') return <EdgeTooltipContent edge={data.edge} byId={data.byId} />;
  return <PointTooltipContent point={data.point} thumbValue={data.thumbValue} handlers={handlers} />;
}
