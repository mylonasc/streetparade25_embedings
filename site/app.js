const svg = d3.select('#plot');
const tooltip = d3.select('#tooltip');
const details = d3.select('#details');
const search = document.querySelector('#search');
const tracksToggle = document.querySelector('#tracks-toggle');
const artistsToggle = document.querySelector('#artists-toggle');
const markedToggle = document.querySelector('#marked-toggle');
const colors = d3.scaleOrdinal(d3.schemeTableau10.concat(d3.schemeSet3));
const MARKED_ARTISTS_KEY = 'streetparade.embeddingMap.markedArtistIds';
const PLAYBACK_MODE = 'soundcloud';
const PLAYBACK_START_SECONDS = null;
const PLAYBACK_START_FRACTION = 0.5;

let allPoints = [];
let selectedPoint = null;
let markedArtistIds = readMarkedArtists();
let playlist = [];
let playlistIndex = 0;
const player = new Audio();
player.controls = true;
player.preload = 'metadata';
player.addEventListener('ended', playNextInPlaylist);

function pointTitle(point) {
  if (point.kind === 'artist') return point.metadata.artist_name || point.label;
  return point.metadata.title || point.label;
}

function pointSubtitle(point) {
  if (point.kind === 'artist') return `${point.metadata.track_embedding_count || 0} track embeddings`;
  return point.metadata.artist_name || 'Unknown artist';
}

function filteredPoints() {
  const query = search.value.trim().toLowerCase();
  return allPoints.filter((point) => {
    if (point.kind === 'track' && !tracksToggle.checked) return false;
    if (point.kind === 'artist' && !artistsToggle.checked) return false;
    if (markedToggle.checked && !isPointMarked(point)) return false;
    if (!query) return true;
    const haystack = `${point.label} ${point.metadata.artist_name || ''} ${point.metadata.title || ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function render() {
  const container = svg.node().parentElement;
  const width = container.clientWidth;
  const height = Math.max(460, Math.min(760, Math.round(width * 0.62)));
  svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);

  const points = filteredPoints();
  const margin = 34;
  const x = d3.scaleLinear().domain(d3.extent(allPoints, (d) => d.x)).nice().range([margin, width - margin]);
  const y = d3.scaleLinear().domain(d3.extent(allPoints, (d) => d.y)).nice().range([height - margin, margin]);

  svg.selectAll('*').remove();
  svg.append('rect').attr('class', 'plot-bg').attr('width', width).attr('height', height).attr('rx', 22);

  const g = svg.append('g');
  g.selectAll('path.point')
    .data(points, (d) => d.id)
    .join('path')
    .attr('class', (d) => `point ${d.kind}${isPointMarked(d) ? ' marked' : ''}`)
    .attr('transform', (d) => `translate(${x(d.x)},${y(d.y)})`)
    .attr('d', d3.symbol().type((d) => d.kind === 'artist' ? d3.symbolDiamond : d3.symbolCircle).size((d) => d.kind === 'artist' ? 135 : 58))
    .attr('fill', (d) => colors(d.cluster))
    .attr('stroke-width', (d) => selectedPoint && selectedPoint.id === d.id ? 3 : 1.25)
    .on('mouseenter', showTooltip)
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip)
    .on('click', (_, d) => {
      selectedPoint = d;
      renderDetails(d);
      playPoint(d);
      render();
    });

  const legend = svg.append('g').attr('class', 'legend').attr('transform', `translate(${margin},${margin})`);
  const clusters = Array.from(new Set(allPoints.map((d) => d.cluster))).sort((a, b) => a - b);
  legend.selectAll('g').data(clusters).join('g')
    .attr('transform', (_, i) => `translate(${Math.floor(i / 2) * 118},${(i % 2) * 24})`)
    .each(function(cluster) {
      const row = d3.select(this);
      row.append('circle').attr('r', 6).attr('fill', colors(cluster));
      row.append('text').attr('x', 12).attr('y', 4).text(`Cluster ${cluster}`);
    });
}

function showTooltip(event, point) {
  tooltip.hidden = false;
  tooltip.html(`<strong>${escapeHtml(pointTitle(point))}</strong><span>${escapeHtml(pointSubtitle(point))}</span><span>Cluster ${point.cluster} · ${point.kind}</span>`);
  moveTooltip(event);
}

function moveTooltip(event) {
  tooltip.style('left', `${event.pageX + 14}px`).style('top', `${event.pageY + 14}px`);
}

function hideTooltip() {
  tooltip.hidden = true;
}

function renderDetails(point) {
  const metadata = point.metadata || {};
  const primaryUrl = metadata.url || metadata.soundcloud_url || metadata.web;
  const artistId = metadata.artist_id;
  const isMarked = artistId !== undefined && markedArtistIds.has(String(artistId));
  const playableTracks = playableTracksForPoint(point);
  const soundCloudTracks = soundCloudTracksForPoint(point);
  const rows = Object.entries(metadata)
    .filter(([key, value]) => !['tracks', 'audio_url'].includes(key) && value !== null && value !== undefined && value !== '' && !Array.isArray(value))
    .map(([key, value]) => `<dt>${escapeHtml(key.replaceAll('_', ' '))}</dt><dd>${formatValue(value)}</dd>`)
    .join('');
  details.html(`
    <p class="eyebrow">${escapeHtml(point.kind)} · Cluster ${point.cluster}</p>
    <h2>${escapeHtml(pointTitle(point))}</h2>
    <p>${escapeHtml(pointSubtitle(point))}</p>
    ${artistId !== undefined ? `<button class="mark-button ${isMarked ? 'active' : ''}" type="button" data-action="toggle-mark">${isMarked ? 'Unmark artist' : 'Mark artist'}</button>` : ''}
    ${primaryUrl ? `<a class="action" href="${escapeAttr(primaryUrl)}" target="_blank" rel="noreferrer">Open source link</a>` : ''}
    <section class="player-panel">
      <p class="eyebrow">Audio</p>
      ${PLAYBACK_MODE === 'local' ? localPlayerMarkup(playableTracks) : soundCloudPlayerMarkup(soundCloudTracks)}
    </section>
    <dl>${rows}</dl>
  `);
  details.select('#player-slot').node()?.appendChild(player);
  details.select('[data-action="toggle-mark"]').on('click', () => toggleArtistMark(artistId));
  details.selectAll('[data-play-index]').on('click', function() {
    const index = Number(this.getAttribute('data-play-index'));
    if (PLAYBACK_MODE === 'local') playTracks(playableTracks, index);
    else playSoundCloudTracks(soundCloudTracks, index);
  });
}

function localPlayerMarkup(playableTracks) {
  return `
    <div id="player-slot"></div>
    <p>${playableTracks.length ? `${playableTracks.length} cached song${playableTracks.length === 1 ? '' : 's'} available.` : 'No cached song path is available for this selection.'}</p>
    ${playableTracks.length > 1 ? `<ol class="track-list">${playableTracks.map((track, index) => `<li><button type="button" data-play-index="${index}">${escapeHtml(track.title || `Track ${index + 1}`)}</button></li>`).join('')}</ol>` : ''}
  `;
}

function soundCloudPlayerMarkup(soundCloudTracks) {
  return `
    <div id="soundcloud-slot" class="soundcloud-slot"></div>
    <p>${soundCloudTracks.length ? `${soundCloudTracks.length} SoundCloud track${soundCloudTracks.length === 1 ? '' : 's'} available.` : 'No SoundCloud track URL is available for this selection.'}</p>
    ${soundCloudTracks.length > 1 ? `<ol class="track-list">${soundCloudTracks.map((track, index) => `<li><button type="button" data-play-index="${index}">${escapeHtml(track.title || `Track ${index + 1}`)}</button></li>`).join('')}</ol>` : ''}
  `;
}

function playableTracksForPoint(point) {
  const metadata = point.metadata || {};
  if (point.kind === 'track') {
    return metadata.audio_url ? [{title: metadata.title || point.label, audio_url: metadata.audio_url}] : [];
  }
  return (metadata.tracks || [])
    .filter((track) => track.audio_url)
    .map((track) => ({title: track.title || `Track ${track.track_id}`, audio_url: track.audio_url}));
}

function soundCloudTracksForPoint(point) {
  const metadata = point.metadata || {};
  if (point.kind === 'track') {
    return isSoundCloudUrl(metadata.url)
      ? [{title: metadata.title || point.label, url: metadata.url, embed_url: metadata.soundcloud_embed_url || soundCloudEmbedUrl(metadata.url)}]
      : [];
  }
  const tracks = (metadata.tracks || [])
    .filter((track) => isSoundCloudUrl(track.url))
    .map((track) => ({
      title: track.title || `Track ${track.track_id}`,
      url: track.url,
      embed_url: track.soundcloud_embed_url || soundCloudEmbedUrl(track.url),
    }));
  if (tracks.length) return tracks;
  return isSoundCloudUrl(metadata.soundcloud_url)
    ? [{
        title: metadata.artist_name || point.label,
        url: metadata.soundcloud_url,
        embed_url: metadata.soundcloud_embed_url || soundCloudEmbedUrl(metadata.soundcloud_url),
      }]
    : [];
}

function isSoundCloudUrl(url) {
  return typeof url === 'string' && /^https?:\/\/(www\.)?soundcloud\.com\//i.test(url);
}

function soundCloudEmbedUrl(url) {
  return isSoundCloudUrl(url)
    ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&show_artwork=false&visual=false`
    : null;
}

function renderSoundCloudPlayer(track) {
  if (!track) return;
  player.pause();
  playlist = [];
  const slot = details.select('#soundcloud-slot');
  const embedUrl = track.embed_url || soundCloudEmbedUrl(track.url);
  if (!embedUrl) {
    slot.html('<p>No SoundCloud embed URL is available for this track.</p>');
    return;
  }
  slot.html(`
    <iframe
      title="SoundCloud player"
      width="100%"
      height="166"
      scrolling="no"
      frameborder="no"
      allow="autoplay"
      src="${escapeAttr(embedUrl)}">
    </iframe>
  `);
  const iframe = slot.select('iframe').node();
  if (!iframe || !window.SC?.Widget) return;
  const widget = window.SC.Widget(iframe);
  widget.bind(window.SC.Widget.Events.READY, () => {
    widget.getDuration((durationMs) => {
      const startMs = Math.round(playbackStartSeconds(durationMs / 1000) * 1000);
      if (startMs > 0) widget.seekTo(startMs);
      widget.play();
    });
  });
}

function playPoint(point) {
  if (PLAYBACK_MODE === 'soundcloud') {
    playSoundCloudTracks(soundCloudTracksForPoint(point), 0);
    return;
  }
  const tracks = playableTracksForPoint(point);
  if (tracks.length) playTracks(tracks, 0);
}

function playSoundCloudTracks(tracks, startIndex) {
  const track = tracks[startIndex];
  if (track) renderSoundCloudPlayer(track);
}

function playTracks(tracks, startIndex) {
  playlist = tracks;
  playlistIndex = startIndex;
  const track = playlist[playlistIndex];
  if (!track) return;
  player.src = track.audio_url;
  seekAndPlayLocal();
}

function playNextInPlaylist() {
  if (!playlist.length || playlistIndex >= playlist.length - 1) return;
  playlistIndex += 1;
  const track = playlist[playlistIndex];
  player.src = track.audio_url;
  seekAndPlayLocal();
}

function seekAndPlayLocal() {
  const play = () => player.play().catch((error) => console.warn('Audio playback failed:', error));
  const seek = () => {
    const start = playbackStartSeconds(player.duration);
    if (start > 0) player.currentTime = start;
    play();
  };
  if (Number.isFinite(player.duration) && player.duration > 0) {
    seek();
    return;
  }
  player.addEventListener('loadedmetadata', seek, {once: true});
  player.load();
}

function playbackStartSeconds(durationSeconds) {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
  const requested = PLAYBACK_START_SECONDS !== null ? PLAYBACK_START_SECONDS : (duration ? duration * PLAYBACK_START_FRACTION : 0);
  if (!duration) return Math.max(0, requested);
  return Math.max(0, Math.min(requested, Math.max(0, duration - 1)));
}

function artistIdForPoint(point) {
  return point.metadata?.artist_id === undefined ? null : String(point.metadata.artist_id);
}

function isPointMarked(point) {
  const artistId = artistIdForPoint(point);
  return artistId !== null && markedArtistIds.has(artistId);
}

function toggleArtistMark(artistId) {
  const key = String(artistId);
  if (markedArtistIds.has(key)) markedArtistIds.delete(key);
  else markedArtistIds.add(key);
  localStorage.setItem(MARKED_ARTISTS_KEY, JSON.stringify(Array.from(markedArtistIds)));
  if (selectedPoint) renderDetails(selectedPoint);
  render();
}

function readMarkedArtists() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MARKED_ARTISTS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  const text = String(value);
  if (/^https?:\/\//.test(text)) return `<a href="${escapeAttr(text)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`;
  return escapeHtml(text);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

Promise.all([d3.json('data.json')]).then(([data]) => {
  allPoints = data.points;
  document.title = `Street Parade Embedding Map (${data.point_count})`;
  render();
  window.addEventListener('resize', render);
  [search, tracksToggle, artistsToggle, markedToggle].forEach((element) => element.addEventListener('input', render));
});
