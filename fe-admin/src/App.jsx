import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const emptyArtist = {
  name: '',
  links: '',
  images: '',
  soundcloud_url: '',
  instagram: '',
  youtube: '',
  web: '',
};

function splitLines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.detail || response.statusText);
  }
  return data;
}

function StatusPill({ value }) {
  return <span className={`pill ${value || 'unknown'}`}>{value || 'unknown'}</span>;
}

export default function App() {
  const [artists, setArtists] = useState([]);
  const [selectedArtistId, setSelectedArtistId] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [downloadJobs, setDownloadJobs] = useState([]);
  const [artistEmbedding, setArtistEmbedding] = useState(null);
  const [artistForm, setArtistForm] = useState(emptyArtist);
  const [downloadForm, setDownloadForm] = useState({ max_tracks: 5, discovery_method: 'yt-dlp', track_urls: '' });
  const [computeForm, setComputeForm] = useState({ only_missing: true, device: 'auto', max_tracks: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedArtist = artists.find((artist) => artist.id === Number(selectedArtistId));

  function artistName(artistId) {
    return artists.find((artist) => artist.id === Number(artistId))?.name || `Artist #${artistId}`;
  }

  async function loadArtists() {
    const data = await request('/artists');
    setArtists(data);
    if (!selectedArtistId && data.length > 0) {
      setSelectedArtistId(data[0].id);
    }
  }

  async function loadTracks(artistId = selectedArtistId) {
    if (!artistId) return;
    setTracks(await request(`/artists/${artistId}/tracks`));
  }

  async function loadJobs() {
    setJobs(await request('/embedding-jobs'));
  }

  async function loadDownloadJobs() {
    setDownloadJobs(await request('/download-jobs'));
  }

  async function loadArtistEmbedding(artistId = selectedArtistId) {
    if (!artistId) return;
    setArtistEmbedding(await request(`/artists/${artistId}/embeddings?include_tracks=false`));
  }

  async function refreshAll() {
    try {
      await Promise.all([loadArtists(), loadJobs(), loadDownloadJobs()]);
      if (selectedArtistId) {
        await Promise.all([loadTracks(), loadArtistEmbedding()]);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (!selectedArtistId) return;
    loadTracks(selectedArtistId).catch((err) => setError(err.message));
    loadArtistEmbedding(selectedArtistId).catch(() => setArtistEmbedding(null));
  }, [selectedArtistId]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadJobs().catch(() => {});
      loadDownloadJobs().catch(() => {});
      if (selectedArtistId) {
        loadTracks(selectedArtistId).catch(() => {});
        loadArtistEmbedding(selectedArtistId).catch(() => {});
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedArtistId]);

  async function runAction(action, success) {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      setMessage(success(result));
      await refreshAll();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function submitArtist(event) {
    event.preventDefault();
    const payload = {
      name: artistForm.name.trim(),
      links: splitLines(artistForm.links),
      images: splitLines(artistForm.images),
      soundcloud_url: artistForm.soundcloud_url.trim() || null,
      instagram: artistForm.instagram.trim() || null,
      youtube: artistForm.youtube.trim() || null,
      web: artistForm.web.trim() || null,
    };
    const created = await runAction(
      () => request('/artists', { method: 'POST', body: JSON.stringify(payload) }),
      (artist) => `Saved artist: ${artist.name}`,
    );
    if (created) {
      setSelectedArtistId(created.id);
      setArtistForm(emptyArtist);
    }
  }

  async function downloadTracks(event) {
    event.preventDefault();
    if (!selectedArtistId) return;
    const urls = splitLines(downloadForm.track_urls);
    const payload = {
      max_tracks: Number(downloadForm.max_tracks),
      discovery_method: downloadForm.discovery_method,
      track_urls: urls.length ? urls : null,
    };
    await runAction(
      () => request(`/artists/${selectedArtistId}/download`, { method: 'POST', body: JSON.stringify(payload) }),
      (job) => `Queued download job ${job.id}`,
    );
  }

  async function computeEmbeddings(event) {
    event.preventDefault();
    if (!selectedArtistId) return;
    const payload = {
      only_missing: computeForm.only_missing,
      device: computeForm.device,
      max_tracks: computeForm.max_tracks ? Number(computeForm.max_tracks) : null,
    };
    await runAction(
      () => request(`/artists/${selectedArtistId}/embeddings/compute`, { method: 'POST', body: JSON.stringify(payload) }),
      (job) => `Queued embedding job ${job.id}`,
    );
  }

  async function computeAll() {
    const payload = {
      only_missing: computeForm.only_missing,
      device: computeForm.device,
      max_tracks: computeForm.max_tracks ? Number(computeForm.max_tracks) : null,
    };
    await runAction(
      () => request('/embeddings/compute', { method: 'POST', body: JSON.stringify(payload) }),
      (job) => `Queued global embedding job ${job.id}`,
    );
  }

  async function cancelJob(jobId) {
    await runAction(
      () => request(`/embedding-jobs/${jobId}/cancel`, { method: 'POST' }),
      (job) => `Job ${job.id} is ${job.status}`,
    );
  }

  async function cancelDownloadJob(jobId) {
    await runAction(
      () => request(`/download-jobs/${jobId}/cancel`, { method: 'POST' }),
      (job) => `Download job ${job.id} is ${job.status}`,
    );
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Street Parade Embeddings</p>
          <h1>Artist Audio Admin</h1>
          <p>Add artists, collect tracks, queue CLAP embeddings, and inspect artist-level vectors.</p>
        </div>
        <button onClick={refreshAll} disabled={loading}>Refresh</button>
      </header>

      {(message || error) && (
        <section className={`notice ${error ? 'error' : 'success'}`}>{error || message}</section>
      )}

      <section className="grid two">
        <form className="card form" onSubmit={submitArtist}>
          <h2>Add Or Update Artist</h2>
          <label>Name<input required value={artistForm.name} onChange={(e) => setArtistForm({ ...artistForm, name: e.target.value })} /></label>
          <label>SoundCloud URL<input value={artistForm.soundcloud_url} onChange={(e) => setArtistForm({ ...artistForm, soundcloud_url: e.target.value })} /></label>
          <label>Instagram<input value={artistForm.instagram} onChange={(e) => setArtistForm({ ...artistForm, instagram: e.target.value })} /></label>
          <label>YouTube<input value={artistForm.youtube} onChange={(e) => setArtistForm({ ...artistForm, youtube: e.target.value })} /></label>
          <label>Website<input value={artistForm.web} onChange={(e) => setArtistForm({ ...artistForm, web: e.target.value })} /></label>
          <label>Links, one per line<textarea rows="3" value={artistForm.links} onChange={(e) => setArtistForm({ ...artistForm, links: e.target.value })} /></label>
          <label>Images, one per line<textarea rows="2" value={artistForm.images} onChange={(e) => setArtistForm({ ...artistForm, images: e.target.value })} /></label>
          <button type="submit" disabled={loading}>Save Artist</button>
        </form>

        <section className="card">
          <h2>Available Artists</h2>
          <div className="artist-list">
            {artists.map((artist) => (
              <button
                className={artist.id === Number(selectedArtistId) ? 'artist active' : 'artist'}
                key={artist.id}
                onClick={() => setSelectedArtistId(artist.id)}
              >
                <strong>{artist.name}</strong>
                <span>{artist.soundcloud_url || artist.web || 'No primary link'}</span>
              </button>
            ))}
            {!artists.length && <p className="muted">No artists yet.</p>}
          </div>
        </section>
      </section>

      <section className="grid two">
        <form className="card form" onSubmit={downloadTracks}>
          <h2>Download Tracks</h2>
          <p className="context">Selected: <strong>{selectedArtist?.name || 'None'}</strong></p>
          <label>Max tracks<input type="number" min="1" value={downloadForm.max_tracks} onChange={(e) => setDownloadForm({ ...downloadForm, max_tracks: e.target.value })} /></label>
          <label>Discovery method<select value={downloadForm.discovery_method} onChange={(e) => setDownloadForm({ ...downloadForm, discovery_method: e.target.value })}><option value="yt-dlp">yt-dlp recommended</option><option value="requests-html">requests-html with yt-dlp fallback</option></select></label>
          <label>Optional track URLs, one per line<textarea rows="5" value={downloadForm.track_urls} onChange={(e) => setDownloadForm({ ...downloadForm, track_urls: e.target.value })} placeholder="Leave empty to discover from artist SoundCloud" /></label>
          <button type="submit" disabled={loading || !selectedArtistId}>Download For Artist</button>
        </form>

        <form className="card form" onSubmit={computeEmbeddings}>
          <h2>Compute Embeddings</h2>
          <label>Device<select value={computeForm.device} onChange={(e) => setComputeForm({ ...computeForm, device: e.target.value })}><option value="auto">auto</option><option value="cpu">cpu</option><option value="cuda">cuda</option></select></label>
          <label>Max tracks for this job<input type="number" min="1" value={computeForm.max_tracks} onChange={(e) => setComputeForm({ ...computeForm, max_tracks: e.target.value })} placeholder="No limit" /></label>
          <label className="check"><input type="checkbox" checked={computeForm.only_missing} onChange={(e) => setComputeForm({ ...computeForm, only_missing: e.target.checked })} /> Only missing embeddings</label>
          <div className="button-row">
            <button type="submit" disabled={loading || !selectedArtistId}>Queue Artist Job</button>
            <button type="button" className="secondary" onClick={computeAll} disabled={loading}>Queue All Artists</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Tracks For {selectedArtist?.name || 'Selected Artist'}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Status</th><th>Downloaded</th><th>Samples</th><th>Embedding</th><th>Path</th><th>Error</th></tr></thead>
            <tbody>
              {tracks.map((track) => (
                <tr key={track.id}>
                  <td>{track.id}</td>
                  <td><StatusPill value={track.download_status} /></td>
                  <td>{track.downloaded ? 'yes' : 'no'}</td>
                  <td>{track.sample_count}</td>
                  <td>{track.has_embedding ? `yes (${track.embedding_dim})` : 'no'}</td>
                  <td className="mono">{track.path}</td>
                  <td className="error-text">{track.last_error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <section className="card">
          <h2>Download Jobs</h2>
          <div className="jobs">
            {downloadJobs.map((job) => (
              <div className="job" key={job.id}>
                <div><strong className="mono">{job.id.slice(0, 10)}</strong> <StatusPill value={job.status} /></div>
                <button className="job-artist" type="button" onClick={() => setSelectedArtistId(job.artist_id)}>
                  {artistName(job.artist_id)}
                </button>
                <div className="muted">{job.processed_count}/{job.total ?? '?'} tracks, phase {job.phase || 'idle'}</div>
                {['queued', 'running', 'cancelling'].includes(job.status) && <button className="danger" onClick={() => cancelDownloadJob(job.id)}>Cancel</button>}
              </div>
            ))}
            {!downloadJobs.length && <p className="muted">No download jobs yet.</p>}
          </div>
        </section>

        <section className="card">
          <h2>Embedding Jobs</h2>
          <div className="jobs">
            {jobs.map((job) => (
              <div className="job" key={job.id}>
                <div><strong className="mono">{job.id.slice(0, 10)}</strong> <StatusPill value={job.status} /></div>
                <div className="muted">{job.processed_count}/{job.total ?? '?'} tracks, device {job.request.device}</div>
                {['queued', 'running', 'cancelling'].includes(job.status) && <button className="danger" onClick={() => cancelJob(job.id)}>Cancel</button>}
              </div>
            ))}
            {!jobs.length && <p className="muted">No embedding jobs yet.</p>}
          </div>
        </section>

        <section className="card wide-card">
          <h2>Artist Embedding</h2>
          <p>Embedded tracks: <strong>{artistEmbedding?.track_count ?? 0}</strong></p>
          {artistEmbedding?.average_embedding ? (
            <pre>{JSON.stringify(artistEmbedding.average_embedding.slice(0, 16), null, 2)}\n...</pre>
          ) : (
            <p className="muted">No average embedding available yet.</p>
          )}
        </section>
      </section>
    </main>
  );
}
