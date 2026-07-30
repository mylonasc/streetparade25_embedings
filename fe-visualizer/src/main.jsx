import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const USERNAME_KEY = 'streetparade.visualizer.username';
const MARKS_KEY = 'streetparade.visualizer.marked';

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
  const [stats, setStats] = useState({point_count: 0, base_point_count: 0, user_point_count: 0});

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
            <span><strong>{stats.user_point_count}</strong> user-added songs</span>
          </div>
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
            <div className="song-list">{userTracks.map((track) => <TrackRow key={track.id} track={track} />)}</div>
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
    svg.append('g').selectAll('path').data(points).join('path')
      .attr('class', (point) => `point ${point.kind} ${isMarked(point, marks) ? 'marked' : ''}`)
      .attr('transform', (point) => `translate(${x(point.x)},${y(point.y)})`)
      .attr('d', d3.symbol().type((point) => point.kind === 'user_track' ? d3.symbolStar : d3.symbolCircle).size((point) => point.kind === 'user_track' ? 150 : 58))
      .attr('fill', (point) => point.kind === 'user_track' ? '#ff5c35' : color(point.cluster))
      .attr('stroke-width', (point) => selected?.id === point.id ? 3 : 1.2)
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
      .on('click', (_, point) => setSelected(point));
  }, [points, selected, marks]);

  return <><svg ref={ref} className="plot" /><div ref={tooltipRef} className="tooltip" hidden /></>;
}

function Selection({point, onMark}) {
  const metadata = point.metadata || {};
  const sourceUrl = metadata.url || metadata.source_url;
  const soundcloud = sourceUrl && sourceUrl.includes('soundcloud.com') ? sourceUrl : null;
  const local = point.kind === 'user_track' && metadata.source_type === 'youtube' && metadata.username
    ? `${API_BASE_URL}/users/${encodeURIComponent(metadata.username)}/tracks/${metadata.id}/audio`
    : null;
  return (
    <div>
      <p className="eyebrow">{point.kind}</p>
      <h3>{point.label}</h3>
      <button onClick={onMark}>Toggle preference mark</button>
      {soundcloud && <iframe title="SoundCloud" width="100%" height="166" scrolling="no" frameBorder="no" allow="autoplay" src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(soundcloud)}&auto_play=true&show_artwork=false&visual=false`} />}
      {local && <audio src={local} controls autoPlay />}
      <dl>{Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object').map(([key, value]) => <React.Fragment key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>
    </div>
  );
}

function TrackRow({track}) {
  return <div className="track-row"><strong>{track.title || track.source_url}</strong><span>{track.source_type} · {track.status}</span>{track.last_error && <small>{track.last_error}</small>}</div>;
}

function isMarked(point, marks) {
  return marks.has(`${point.kind}:${point.metadata?.artist_name || point.metadata?.artist || point.label}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char]));
}

createRoot(document.getElementById('root')).render(<App />);
