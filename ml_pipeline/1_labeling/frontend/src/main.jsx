import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_ANNOTATION_API_BASE_URL || 'http://localhost:8100';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.detail || response.statusText);
  return data;
}

function App() {
  const audioRef = useRef(null);
  const activeSegmentRef = useRef(null);
  const [dbPath, setDbPath] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [campaignForm, setCampaignForm] = useState({ name: '', description: '' });
  const [labelSets, setLabelSets] = useState([]);
  const [labelsBySet, setLabelsBySet] = useState({});
  const [labelSetForm, setLabelSetForm] = useState({ name: '', description: '' });
  const [labelForms, setLabelForms] = useState({});
  const [tracks, setTracks] = useState([]);
  const [trackId, setTrackId] = useState('');
  const [samples, setSamples] = useState([]);
  const [selectedSampleId, setSelectedSampleId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedSample = samples.find((sample) => sample.track_sample_id === Number(selectedSampleId));
  const visibleLabels = useMemo(
    () => labelSets.flatMap((set) => (labelsBySet[set.id] || []).map((label) => ({ ...label, label_set_name: set.name }))),
    [labelSets, labelsBySet],
  );

  async function loadBase() {
    const [config, campaignData, trackData] = await Promise.all([
      request('/config/database'),
      request('/annotation_campaign'),
      request('/tracks?page_size=500'),
    ]);
    setDbPath(config.path);
    setCampaigns(campaignData);
    setTracks(trackData.tracks);
    if (!campaignId && campaignData.length) setCampaignId(String(campaignData[0].id));
  }

  async function loadCampaign(id = campaignId) {
    if (!id) return;
    const [sets, campaignSamples] = await Promise.all([
      request(`/annotation_campaign/${id}/label-sets`),
      request(`/annotation_campaign/${id}/samples`),
    ]);
    setLabelSets(sets);
    setSamples(campaignSamples);
    if (!selectedSampleId && campaignSamples.length) setSelectedSampleId(String(campaignSamples[0].track_sample_id));
    const labelEntries = await Promise.all(sets.map(async (set) => [set.id, await request(`/label-sets/${set.id}/labels`)]));
    setLabelsBySet(Object.fromEntries(labelEntries));
  }

  useEffect(() => {
    loadBase().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadCampaign(campaignId).catch((err) => setError(err.message));
  }, [campaignId]);

  async function run(action, success) {
    setError('');
    setMessage('');
    try {
      const result = await action();
      setMessage(success(result));
      await loadBase();
      await loadCampaign(campaignId);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function saveDb(event) {
    event.preventDefault();
    await run(() => request('/config/database', { method: 'POST', body: JSON.stringify({ path: dbPath }) }), (config) => `Using DB ${config.path}`);
  }

  async function createCampaign(event) {
    event.preventDefault();
    const created = await run(
      () => request('/annotation_campaign', { method: 'POST', body: JSON.stringify(campaignForm) }),
      (campaign) => `Saved annotation_campaign ${campaign.name}`,
    );
    if (created) {
      setCampaignId(String(created.id));
      setCampaignForm({ name: '', description: '' });
    }
  }

  async function createLabelSet(event) {
    event.preventDefault();
    if (!campaignId) return;
    await run(
      () => request(`/annotation_campaign/${campaignId}/label-sets`, { method: 'POST', body: JSON.stringify(labelSetForm) }),
      (set) => `Saved label set ${set.name}`,
    );
    setLabelSetForm({ name: '', description: '' });
  }

  async function createLabel(event, labelSetId) {
    event.preventDefault();
    const form = labelForms[labelSetId] || { name: '', color: '' };
    await run(
      () => request(`/label-sets/${labelSetId}/labels`, { method: 'POST', body: JSON.stringify(form) }),
      (label) => `Saved label ${label.name}`,
    );
    setLabelForms({ ...labelForms, [labelSetId]: { name: '', color: '' } });
  }

  async function addTrackToCampaign() {
    if (!campaignId || !trackId) return;
    await run(
      () => request(`/annotation_campaign/${campaignId}/items`, { method: 'POST', body: JSON.stringify({ track_ids: [Number(trackId)] }) }),
      (items) => `Campaign has ${items.length} segments`,
    );
  }

  async function assignLabel(labelId) {
    if (!campaignId || !selectedSampleId) return;
    await run(
      () => request(`/annotation_campaign/${campaignId}/assignments`, { method: 'POST', body: JSON.stringify({ track_sample_id: Number(selectedSampleId), label_id: labelId }) }),
      () => 'Assigned label',
    );
  }

  async function removeAssignment(assignmentId) {
    await run(() => request(`/assignments/${assignmentId}`, { method: 'DELETE' }), () => 'Removed assignment');
  }

  async function removeCampaignItem(sample) {
    if (!campaignId) return;
    await run(
      () => request(`/annotation_campaign/${campaignId}/items/${sample.id}`, { method: 'DELETE' }),
      () => 'Removed segment from campaign',
    );
    if (selectedSampleId === String(sample.track_sample_id)) {
      setSelectedSampleId('');
      activeSegmentRef.current = null;
      audioRef.current?.pause();
    }
  }

  function playSample(sample) {
    setSelectedSampleId(String(sample.track_sample_id));
    const audio = audioRef.current;
    if (!audio) return;
    const segment = {
      id: Number(sample.track_sample_id),
      start: Number(sample.start_time),
      end: Number(sample.end_time),
      url: `${API_BASE_URL}/tracks/${sample.track_id}/audio`,
    };
    activeSegmentRef.current = segment;
    setError('');

    const seekAndPlay = () => {
      if (activeSegmentRef.current?.id !== segment.id) return;
      audio.currentTime = segment.start;
      audio.play().catch((err) => setError(`Could not play audio: ${err.message}`));
    };

    audio.onloadedmetadata = seekAndPlay;
    audio.onerror = () => setError(`Could not load audio for track ${sample.track_id}`);
    if (audio.getAttribute('src') === segment.url && audio.readyState >= 1) {
      seekAndPlay();
    } else {
      audio.setAttribute('src', segment.url);
      audio.load();
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const stopAtEnd = () => {
      const segment = activeSegmentRef.current;
      if (segment && audio.currentTime >= segment.end) audio.pause();
    };
    audio.addEventListener('timeupdate', stopAtEnd);
    return () => audio.removeEventListener('timeupdate', stopAtEnd);
  }, []);

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Independent Labeling</p>
          <h1>Annotation Campaign Studio</h1>
          <p>Configure a database, build label sets, and assign multiple labels to song segments.</p>
        </div>
        <button onClick={() => loadBase().then(() => loadCampaign())}>Refresh</button>
      </header>

      {(message || error) && <section className={`notice ${error ? 'error' : 'success'}`}>{error || message}</section>}

      <section className="grid two">
        <form className="card form" onSubmit={saveDb}>
          <h2>Database</h2>
          <label>SQLite path<input value={dbPath} onChange={(event) => setDbPath(event.target.value)} /></label>
          <button type="submit">Use Database</button>
        </form>

        <form className="card form" onSubmit={createCampaign}>
          <h2>annotation_campaign</h2>
          <label>Name<input required value={campaignForm.name} onChange={(event) => setCampaignForm({ ...campaignForm, name: event.target.value })} /></label>
          <label>Description<textarea rows="2" value={campaignForm.description} onChange={(event) => setCampaignForm({ ...campaignForm, description: event.target.value })} /></label>
          <button type="submit">Save Campaign</button>
          <label>Active campaign<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">Select campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
        </form>
      </section>

      <section className="grid two">
        <form className="card form" onSubmit={createLabelSet}>
          <h2>Label Sets</h2>
          <label>Name<input required value={labelSetForm.name} onChange={(event) => setLabelSetForm({ ...labelSetForm, name: event.target.value })} /></label>
          <label>Description<input value={labelSetForm.description} onChange={(event) => setLabelSetForm({ ...labelSetForm, description: event.target.value })} /></label>
          <button type="submit" disabled={!campaignId}>Add Label Set</button>
        </form>

        <section className="card">
          <h2>Campaign Tracks</h2>
          <div className="button-row">
            <select value={trackId} onChange={(event) => setTrackId(event.target.value)}>
              <option value="">Select track</option>
              {tracks.map((track) => <option key={track.id} value={track.id}>#{track.id} {track.artist_name || 'Unknown'} - {track.url}</option>)}
            </select>
            <button type="button" onClick={addTrackToCampaign} disabled={!campaignId || !trackId}>Add Track Segments</button>
          </div>
        </section>
      </section>

      <section className="card">
        <h2>Labels</h2>
        <div className="label-grid">
          {labelSets.map((set) => (
            <div className="label-set" key={set.id}>
              <h3>{set.name}</h3>
              <div className="chips">{(labelsBySet[set.id] || []).map((label) => <span className="chip" style={{ borderColor: label.color || '#222' }} key={label.id}>{label.name}</span>)}</div>
              <form className="inline-form" onSubmit={(event) => createLabel(event, set.id)}>
                <input placeholder="Label" value={labelForms[set.id]?.name || ''} onChange={(event) => setLabelForms({ ...labelForms, [set.id]: { ...(labelForms[set.id] || {}), name: event.target.value } })} />
                <input placeholder="#color" value={labelForms[set.id]?.color || ''} onChange={(event) => setLabelForms({ ...labelForms, [set.id]: { ...(labelForms[set.id] || {}), color: event.target.value } })} />
                <button type="submit">Add</button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="grid labeler">
        <section className="card samples">
          <h2>Segments</h2>
          {samples.map((sample) => (
            <article key={sample.track_sample_id} className={sample.track_sample_id === Number(selectedSampleId) ? 'sample active' : 'sample'}>
              <div className="sample-main">
                <strong>{sample.track_title || `Track ${sample.track_id}`}</strong>
                <span>
                  {sample.artist_url ? <a href={sample.artist_url} target="_blank" rel="noreferrer">{sample.artist_name || `Artist #${sample.artist_id}`}</a> : (sample.artist_name || 'Unknown artist')}
                </span>
                <small>track_id {sample.track_id} / sound_segment_id {sample.sound_segment_id}</small>
                <small>{sample.start_time.toFixed(1)}s - {sample.end_time.toFixed(1)}s</small>
                <small>{sample.assignments?.map((item) => item.label_name).join(', ') || 'Unlabeled'}</small>
              </div>
              <div className="sample-actions">
                <button type="button" onClick={() => playSample(sample)}>Play</button>
                <button className="danger" type="button" onClick={() => removeCampaignItem(sample)}>Remove</button>
              </div>
            </article>
          ))}
        </section>

        <section className="card workspace">
          <h2>Assign Labels</h2>
          <audio ref={audioRef} controls />
          {selectedSample && <p className="context">Selected track {selectedSample.track_id}, sound_segment_id {selectedSample.sound_segment_id}, {selectedSample.start_time.toFixed(1)}s - {selectedSample.end_time.toFixed(1)}s</p>}
          <div className="assignments">
            {(selectedSample?.assignments || []).map((assignment) => (
              <button className="assigned" key={assignment.id} onClick={() => removeAssignment(assignment.id)}>{assignment.label_set_name}: {assignment.label_name} x</button>
            ))}
          </div>
          <div className="label-buttons">
            {visibleLabels.map((label) => <button key={label.id} type="button" onClick={() => assignLabel(label.id)}>{label.label_set_name}: {label.name}</button>)}
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
