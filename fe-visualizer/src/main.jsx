import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import './styles.css';

const API_BASE_URL = resolveApiBaseUrl();
const USERNAME_KEY = 'streetparade.visualizer.username';
const MARKS_KEY = 'streetparade.visualizer.marked';

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  const browserHost = window.location.hostname;
  if (configured && !(isLoopbackUrl(configured) && !isLoopbackHost(browserHost))) {
    return configured.replace(/\/$/, '');
  }
  return `${window.location.protocol}//${browserHost}:8000`;
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

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.detail || response.statusText);
  return data;
}

function readMarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MARKS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function App() {
  const [username, setUsername] = useState(localStorage.getItem(USERNAME_KEY) || '');
  const [draftUsername, setDraftUsername] = useState(username);
  const [points, setPoints] = useState([]);
  const [userTracks, setUserTracks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState(readMarks);
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState([]);
  const [layoutJob, setLayoutJob] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [stats, setStats] = useState({point_count: 0, base_point_count: 0, artist_point_count: 0, user_point_count: 0});

  async function loadAll(activeUsername = username) {
    if (!activeUsername) return;
    const [viz, tracks] = await Promise.all([
      request(`/visualization?username=${encodeURIComponent(activeUsername)}`),
      request(`/users/${encodeURIComponent(activeUsername)}/tracks`),
    ]);
    setPoints(viz.points || []);
    setStats({
      point_count: viz.point_count || 0,
      base_point_count: viz.base_point_count || 0,
      artist_point_count: viz.artist_point_count || 0,
      user_point_count: viz.user_point_count || 0,
    });
    setUserTracks(tracks || []);
  }

  async function saveUsername(event) {
    event.preventDefault();
    setError('');
    try {
      const user = await request('/users', {method: 'POST', body: JSON.stringify({username: draftUsername})});
      localStorage.setItem(USERNAME_KEY, user.username);
      setUsername(user.username);
      await loadAll(user.username);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitTrack(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await request(`/users/${encodeURIComponent(username)}/tracks`, {method: 'POST', body: JSON.stringify({url})});
      setJobs((existing) => [result.job, ...existing]);
      setUrl('');
      setMessage(`Queued ${result.track.source_type} analysis`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function recomputeLayout() {
    setError('');
    try {
      const job = await request('/layouts/recompute', {method: 'POST', body: JSON.stringify({username})});
      setLayoutJob(job);
      setMessage(`Queued layout job ${job.id.slice(0, 8)}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createShare() {
    setError('');
    try {
      const share = await request('/shares', {
        method: 'POST',
        body: JSON.stringify({username, marked: Array.from(marks)}),
      });
      setShareUrl(`${window.location.origin}${window.location.pathname}?share=${share.token}`);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleMark(point) {
    const key = `${point.kind}:${point.metadata?.artist_name || point.metadata?.artist || point.label}`;
    const next = new Set(marks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    localStorage.setItem(MARKS_KEY, JSON.stringify(Array.from(next)));
    setMarks(next);
  }

  function selectUserTrack(track) {
    const pointId = `user-track-${track.id}`;
    const point = points.find((candidate) => candidate.id === pointId) || {
      id: pointId,
      kind: 'user_track',
      label: track.title || track.source_url,
      x: track.x || 0,
      y: track.y || 0,
      cluster: -1,
      metadata: track,
    };
    setSelected(point);
  }

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token) return;
    request(`/shares/${token}`).then((share) => {
      const payload = share.payload || {};
      if (payload.username) {
        localStorage.setItem(USERNAME_KEY, payload.username);
        setUsername(payload.username);
        setDraftUsername(payload.username);
      }
      if (Array.isArray(payload.marked)) {
        const next = new Set(payload.marked);
        localStorage.setItem(MARKS_KEY, JSON.stringify(Array.from(next)));
        setMarks(next);
      }
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (username) loadAll().catch((err) => setError(err.message));
  }, [username]);

  useEffect(() => {
    if (!username) return;
    const timer = setInterval(async () => {
      try {
        const refreshedJobs = await Promise.all(jobs.filter((job) => ['queued', 'running'].includes(job.status)).map((job) => request(`/user-track-jobs/${job.id}`)));
        if (refreshedJobs.length) setJobs((old) => old.map((job) => refreshedJobs.find((item) => item.id === job.id) || job));
        if (refreshedJobs.some((job) => ['completed', 'failed'].includes(job.status))) await loadAll();
        if (layoutJob && ['queued', 'running'].includes(layoutJob.status)) {
          const next = await request(`/layout-jobs/${layoutJob.id}`);
          setLayoutJob(next);
          if (next.status === 'completed') await loadAll();
        }
      } catch {
        // Polling should not disrupt interaction.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [username, jobs, layoutJob]);

  if (!username) {
    return <UsernameGate draftUsername={draftUsername} setDraftUsername={setDraftUsername} saveUsername={saveUsername} error={error} />;
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Street Parade</p>
          <h1>Personal Embedding Map</h1>
          <p>Signed in publicly as <strong>{username}</strong>. Add SoundCloud or YouTube tracks and see where they land.</p>
        </div>
        <button onClick={() => { localStorage.removeItem(USERNAME_KEY); setUsername(''); }}>Switch user</button>
      </header>

      {(message || error) && <section className={`notice ${error ? 'error' : 'success'}`}>{error || message}</section>}

      <section className="workspace">
        <section className="map-card">
          <div className="map-status">
            <strong>{stats.base_point_count}</strong> Street Parade songs
            <span><strong>{stats.artist_point_count}</strong> artists</span>
            <span><strong>{stats.user_point_count}</strong> user-added songs</span>
          </div>
          <div className="zoom-hint">Scroll to zoom · drag to pan · double-click to reset</div>
          {stats.base_point_count === 0 && (
            <div className="empty-warning">
              No Street Parade vectors loaded. Check that the API can access the Chroma vector store, especially `./chroma` when using Docker.
            </div>
          )}
          <Visualizer points={points} selected={selected} setSelected={setSelected} marks={marks} />
        </section>
        <aside className="side">
          <form className="panel" onSubmit={submitTrack}>
            <h2>Add a track</h2>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="SoundCloud or YouTube URL" required />
            <button type="submit">Analyze Track</button>
          </form>

          <section className="panel">
            <h2>Selection</h2>
            {selected ? <Selection point={selected} onMark={() => toggleMark(selected)} /> : <p className="muted">Click a point on the map.</p>}
          </section>

          <section className="panel">
            <h2>My songs</h2>
            <div className="song-list">
              {userTracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  active={selected?.id === `user-track-${track.id}`}
                  onSelect={() => selectUserTrack(track)}
                />
              ))}
            </div>
            {!userTracks.length && <p className="muted">No submitted songs yet.</p>}
          </section>

          <section className="panel actions">
            <button onClick={recomputeLayout}>Recompute t-SNE map</button>
            {layoutJob && <p className="muted">Layout job: {layoutJob.status}</p>}
            <button className="secondary" onClick={createShare}>Create share link</button>
            {shareUrl && <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} />}
          </section>
        </aside>
      </section>
    </main>
  );
}

function UsernameGate({draftUsername, setDraftUsername, saveUsername, error}) {
  return (
    <main className="gate">
      <form onSubmit={saveUsername} className="gate-card">
        <p className="eyebrow">Public username</p>
        <h1>Choose a username</h1>
        <p>This is public for now. Anyone using the same username can see that username’s submitted songs.</p>
        <input value={draftUsername} onChange={(event) => setDraftUsername(event.target.value)} placeholder="e.g. nina-zurich" required />
        <button type="submit">Enter visualizer</button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </main>
  );
}

function Visualizer({points, selected, setSelected, marks}) {
  const ref = useRef(null);
  const tooltipRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    const bounds = ref.current.parentElement.getBoundingClientRect();
    const width = Math.max(320, bounds.width);
    const height = Math.max(520, Math.round(width * 0.62));
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();
    svg.append('rect').attr('class', 'plot-bg').attr('width', width).attr('height', height).attr('rx', 24);
    if (!points.length) return;
    const x = d3.scaleLinear().domain(d3.extent(points, (point) => point.x)).nice().range([36, width - 36]);
    const y = d3.scaleLinear().domain(d3.extent(points, (point) => point.y)).nice().range([height - 36, 36]);
    const color = d3.scaleOrdinal(d3.schemeTableau10.concat(d3.schemeSet3));
    const viewport = svg.append('g').attr('class', 'zoom-layer').attr('transform', transformRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.45, 18])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        viewport.attr('transform', event.transform);
      });
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('dblclick', () => {
      transformRef.current = d3.zoomIdentity;
      svg.transition().duration(220).call(zoom.transform, d3.zoomIdentity);
    });
    svg.call(zoom.transform, transformRef.current);

    viewport.selectAll('path').data(points).join('path')
      .attr('class', (point) => `point ${point.kind} ${selected?.id === point.id ? 'selected' : ''} ${isMarked(point, marks) ? 'marked' : ''}`)
      .attr('transform', (point) => `translate(${x(point.x)},${y(point.y)})`)
      .attr('d', d3.symbol().type((point) => {
        if (point.kind === 'user_track') return d3.symbolStar;
        if (point.kind === 'artist') return d3.symbolDiamond;
        return d3.symbolCircle;
      }).size((point) => {
        if (point.kind === 'user_track') return selected?.id === point.id ? 280 : 180;
        if (point.kind === 'artist') return selected?.id === point.id ? 180 : 120;
        return selected?.id === point.id ? 105 : 58;
      }))
      .attr('fill', (point) => {
        if (point.kind === 'user_track') return '#ff5c35';
        if (point.kind === 'artist') return '#85f5c4';
        return color(point.cluster);
      })
      .attr('stroke-width', (point) => selected?.id === point.id ? 4 : 1.2)
      .on('mouseenter', (event, point) => {
        const tooltip = tooltipRef.current;
        tooltip.hidden = false;
        tooltip.innerHTML = `<strong>${escapeHtml(point.label)}</strong><span>${escapeHtml(point.kind)}</span>`;
        tooltip.style.left = `${event.pageX + 14}px`;
        tooltip.style.top = `${event.pageY + 14}px`;
      })
      .on('mousemove', (event) => {
        tooltipRef.current.style.left = `${event.pageX + 14}px`;
        tooltipRef.current.style.top = `${event.pageY + 14}px`;
      })
      .on('mouseleave', () => { tooltipRef.current.hidden = true; })
      .on('click', (event, point) => {
        event.stopPropagation();
        setSelected(point);
      });
  }, [points, selected, marks]);

  return <><svg ref={ref} className="plot" /><div ref={tooltipRef} className="tooltip" hidden /></>;
}

function Selection({point, onMark}) {
  const metadata = point.metadata || {};
  const playlist = playlistForPoint(point);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTrack = playlist[activeIndex] || null;

  useEffect(() => {
    setActiveIndex(0);
  }, [point.id]);

  return (
    <div>
      <p className="eyebrow">{point.kind}</p>
      <h3>{point.label}</h3>
      <button onClick={onMark}>Toggle preference mark</button>
      {activeTrack?.soundcloudUrl && <SoundCloudPlayer key={activeTrack.soundcloudUrl} url={activeTrack.soundcloudUrl} />}
      {activeTrack?.localUrl && <audio key={activeTrack.localUrl} src={activeTrack.localUrl} controls autoPlay />}
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
      <dl>{Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object').map(([key, value]) => <React.Fragment key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>
    </div>
  );
}

function SoundCloudPlayer({url}) {
  const iframeRef = useRef(null);
  const widgetRef = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    setNeedsTap(false);
    widgetRef.current = null;
    const iframe = iframeRef.current;
    if (!iframe || !window.SC?.Widget) {
      setNeedsTap(true);
      return;
    }
    const widget = window.SC.Widget(iframe);
    widgetRef.current = widget;
    widget.bind(window.SC.Widget.Events.READY, () => {
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

function playlistForPoint(point) {
  const metadata = point.metadata || {};
  if (point.kind === 'artist') {
    return (metadata.tracks || [])
      .map((track) => playlistTrack(track.title || track.label || `Track ${track.track_id || ''}`, track.url, null))
      .filter(Boolean);
  }
  const sourceUrl = metadata.url || metadata.source_url;
  const localUrl = point.kind === 'user_track' && metadata.source_type === 'youtube' && metadata.username
    ? `${API_BASE_URL}/users/${encodeURIComponent(metadata.username)}/tracks/${metadata.id}/audio`
    : null;
  return [playlistTrack(metadata.title || point.label, sourceUrl, localUrl)].filter(Boolean);
}

function playlistTrack(title, sourceUrl, localUrl) {
  const soundcloudUrl = sourceUrl && sourceUrl.includes('soundcloud.com') ? sourceUrl : null;
  if (!soundcloudUrl && !localUrl) return null;
  return {title: title || 'Untitled track', soundcloudUrl, localUrl};
}

function TrackRow({track, active, onSelect}) {
  return (
    <button type="button" className={`track-row ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="track-star">★</span>
      <strong>{track.title || track.source_url}</strong>
      <span>{track.source_type} · {track.status}</span>
      {track.last_error && <small>{track.last_error}</small>}
    </button>
  );
}

function isMarked(point, marks) {
  return marks.has(`${point.kind}:${point.metadata?.artist_name || point.metadata?.artist || point.label}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char]));
}

createRoot(document.getElementById('root')).render(<App />);
