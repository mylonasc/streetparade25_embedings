import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import * as d3 from 'd3';
import {isMarked, preferenceKeyForPoint} from '../selection';
import {computeTooltipPosition} from '../tooltipPosition';
import {TooltipContent, type TooltipData, type TooltipHandlers} from '../Tooltip';
import {isFinePointer} from '../responsive';
import type {Point, Prediction, PreferenceValue, SimilarityEdge} from '../types';

type HitPoint = {point: Point; x: number; y: number; radius: number};
type HitEdge = {edge: SimilarityEdge; x1: number; y1: number; x2: number; y2: number};

type VisualizerProps = {
  points: Point[];
  loading: boolean;
  selected: Point | null;
  setSelected: (point: Point) => void;
  marks: ReadonlySet<string>;
  thumbPreferences: Record<string, string>;
  predictedPreferences: Record<string, Prediction>;
  colorByPreference: boolean;
  colorByPredictedPreference: boolean;
  onThumb: (point: Point, value: PreferenceValue) => void;
  edges: SimilarityEdge[];
  linkedPointIds: ReadonlySet<string>;
  hasSearch: boolean;
  searchMatchIds: ReadonlySet<string>;
  selectedCluster: number | null;
  showArtists: boolean;
  showSongs: boolean;
  showTrucks: boolean;
  truckScores: Record<string, number>;
  focusRequest: {pointId: string; nonce: number} | null;
  onCanvasClick: () => void;
  onSelectArtist: (point: Point) => void;
  onSelectTruck: (point: Point) => void;
  onPlayArtistSong: (point: Point) => void;
  onPlaySimilar: () => void;
  onRandomSong: () => void;
};

function pointFill(
  point: Point,
  clusterColor: (cluster: number | null) => string,
  thumbPreferences: Record<string, string>,
  predictedPreferences: Record<string, Prediction>,
  colorByPreference: boolean,
  colorByPredictedPreference: boolean,
  truckScores: Record<string, number>,
): string {
  if (point.kind === 'truck') {
    const score = truckScores?.[point.id] ?? 0;
    if (score >= 0.35) return '#85f5c4';
    return '#ffd166';
  }
  if (colorByPreference) {
    const preference = thumbPreferences?.[preferenceKeyForPoint(point) ?? ''];
    if (preference === 'up') return '#85f5c4';
    if (preference === 'down') return '#ff5c35';
    return point.kind === 'artist' ? 'rgba(133, 245, 196, 0.42)' : 'rgba(154, 168, 189, 0.46)';
  }
  if (colorByPredictedPreference) {
    const preference = thumbPreferences?.[preferenceKeyForPoint(point) ?? ''];
    const prediction = predictedPreferences?.[preferenceKeyForPoint(point) ?? ''];
    if (preference === 'up') return '#85f5c4';
    if (preference === 'down') return '#ff5c35';
    if (prediction?.value === 'up') return '#b7ffd9';
    if (prediction?.value === 'down') return '#ff9a7f';
    return point.kind === 'artist' ? 'rgba(133, 245, 196, 0.42)' : 'rgba(154, 168, 189, 0.38)';
  }
  if (point.kind === 'user_track') return '#ff5c35';
  if (point.kind === 'artist') return '#85f5c4';
  return clusterColor(point.cluster);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawLoadingMap(context: CanvasRenderingContext2D, width: number, height: number, timestamp: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.14;
  const phase = timestamp / 840;
  context.save();
  context.lineWidth = 1.3;
  for (let ring = 0; ring < 3; ring += 1) {
    context.beginPath();
    context.arc(centerX, centerY, radius + ring * 23, 0, Math.PI * 2);
    context.strokeStyle = `rgba(133, 245, 196, ${0.15 - ring * 0.035})`;
    context.stroke();
  }
  for (let idx = 0; idx < 22; idx += 1) {
    const angle = phase + idx * (Math.PI * 2 / 22);
    const orbit = radius + Math.sin(phase * 1.6 + idx * 0.9) * 18;
    const x = centerX + Math.cos(angle) * orbit;
    const y = centerY + Math.sin(angle) * orbit * 0.62;
    const pulse = (Math.sin(phase * 2.2 + idx * 0.65) + 1) / 2;
    context.beginPath();
    context.arc(x, y, 2.4 + pulse * 3.6, 0, Math.PI * 2);
    context.fillStyle = `rgba(133, 245, 196, ${0.24 + pulse * 0.58})`;
    context.fill();
  }
  context.fillStyle = '#eff6ff';
  context.font = '800 16px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('Loading embeddings', centerX, centerY + radius + 68);
  context.fillStyle = 'rgba(239, 246, 255, 0.56)';
  context.font = '700 12px Inter, system-ui, sans-serif';
  context.fillText('Preparing the map', centerX, centerY + radius + 90);
  context.restore();
}

export function Visualizer(props: VisualizerProps) {
  const {
    points, loading, selected, setSelected, marks, thumbPreferences, predictedPreferences,
    colorByPreference, colorByPredictedPreference, onThumb, edges, linkedPointIds, hasSearch,
    searchMatchIds, selectedCluster, showArtists, showSongs, showTrucks, truckScores, focusRequest, onCanvasClick,
    onSelectArtist, onSelectTruck, onPlayArtistSong, onPlaySimilar, onRandomSong,
  } = props;

  const ref = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const handledFocusRef = useRef<number | null>(null);
  const tooltipRevealTimerRef = useRef<number | null>(null);
  const [sizeVersion, setSizeVersion] = useState(0);
  const [tooltip, setTooltip] = useState<{data: TooltipData; x: number; y: number} | null>(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const parent = ref.current.parentElement;
    if (!parent) return undefined;
    const observer = new ResizeObserver(() => setSizeVersion((version) => version + 1));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    const canvasEl = ref.current;
    if (!el || !tooltip || !canvasEl) return;
    const containerRect = el.offsetParent?.getBoundingClientRect() || {left: 0, top: 0, width: window.innerWidth, height: window.innerHeight};
    const anchorRect = canvasEl.getBoundingClientRect();
    const position = computeTooltipPosition({
      anchor: anchorRect,
      container: containerRect,
      tooltipWidth: el.offsetWidth || 280,
      tooltipHeight: el.offsetHeight || 140,
      x: tooltip.x,
      y: tooltip.y,
    });
    el.style.left = `${position.left}px`;
    el.style.top = `${position.top}px`;
  }, [tooltip]);

  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current;
    const rawContext = canvas.getContext('2d');
    if (!rawContext) return;
    const context: CanvasRenderingContext2D = rawContext;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(280, Math.round(bounds.width));
    const height = Math.max(320, Math.round(bounds.height || width * 0.68));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    const finePointer = isFinePointer();

    if (!points.length) {
      let loadingFrame: number | null = null;

      function drawEmpty(timestamp = 0) {
        context.save();
        context.scale(pixelRatio, pixelRatio);
        context.clearRect(0, 0, width, height);
        context.fillStyle = 'rgba(255, 255, 255, 0.035)';
        roundedRect(context, 0, 0, width, height, 24);
        context.fill();
        if (loading) drawLoadingMap(context, width, height, timestamp);
        context.restore();
        if (loading) loadingFrame = requestAnimationFrame(drawEmpty);
      }

      canvas.style.cursor = loading ? 'progress' : 'default';
      drawEmpty();
      return () => {
        if (loadingFrame !== null) cancelAnimationFrame(loadingFrame);
      };
    }

    const xDomain = d3.extent(points, (point) => point.x) as [number, number] | undefined;
    const yDomain = d3.extent(points, (point) => point.y) as [number, number] | undefined;
    const x = d3.scaleLinear().domain(xDomain ?? [0, 1]).nice().range([36, width - 36]);
    const y = d3.scaleLinear().domain(yDomain ?? [0, 1]).nice().range([height - 36, 36]);
    const color = d3.scaleOrdinal<string, string>(d3.schemeTableau10.concat(d3.schemeSet3));
    const clusterColor = (cluster: number | null) => color(String(cluster));
    const byId = new Map(points.map((point) => [point.id, point]));
    const isVisible = (point: Point | null | undefined) => Boolean(
      point && (point.kind === 'artist' ? showArtists : point.kind === 'truck' ? showTrucks : showSongs),
    );
    const markerScale = (scale: number) => Math.max(0.65, 1 / Math.sqrt(Math.max(1, scale)));
    const symbol = d3.symbol().context(context);
    const screenPoint = (point: Point): [number, number] => [transformRef.current.applyX(x(point.x)), transformRef.current.applyY(y(point.y))];
    let hitPoints: HitPoint[] = [];
    let hitEdges: HitEdge[] = [];
    let quadtree: d3.Quadtree<HitPoint> | null = null;
    let frame: number | null = null;

    function pointState(point: Point) {
      const isSelected = selected?.id === point.id;
      const isTruck = point.kind === 'truck';
      const truckScore = isTruck ? (truckScores?.[point.id] ?? 0) : 0;
      const hasThumbPreference = Boolean(thumbPreferences?.[preferenceKeyForPoint(point) ?? '']);
      const hasPredictedPreference = Boolean(predictedPreferences?.[preferenceKeyForPoint(point) ?? '']);
      let alpha = 1;
      if (hasSearch && !searchMatchIds?.has(point.id)) alpha = Math.min(alpha, 0.22);
      if (selectedCluster !== null && point.cluster !== selectedCluster) alpha = Math.min(alpha, 0.18);
      if (selected?.id && !isSelected && !(colorByPreference && hasThumbPreference) && !(colorByPredictedPreference && (hasThumbPreference || hasPredictedPreference))) alpha = Math.min(alpha, 0.24);
      if (colorByPreference && !hasThumbPreference) alpha = isTruck ? (truckScore < 0.35 ? Math.min(alpha, 0.4) : alpha) : Math.min(alpha, 0.36);
      if (colorByPredictedPreference && !hasThumbPreference && !hasPredictedPreference) alpha = isTruck ? (truckScore < 0.35 ? Math.min(alpha, 0.4) : alpha) : Math.min(alpha, 0.32);
      return {
        isSelected,
        isMarked: isMarked(point, marks),
        isLinked: linkedPointIds?.has(point.id),
        isSearchMatch: hasSearch && searchMatchIds?.has(point.id),
        isClusterMatch: selectedCluster !== null && point.cluster === selectedCluster,
        alpha: isSelected ? 1 : alpha,
      };
    }

    function drawSymbol(point: Point, state: ReturnType<typeof pointState>): HitPoint {
      const [sx, sy] = screenPoint(point);
      const scale = markerScale(transformRef.current.k);
      const size = point.kind === 'user_track'
        ? state.isSelected ? 360 : 230
        : point.kind === 'artist'
          ? state.isSelected ? 250 : 165
          : point.kind === 'truck'
            ? state.isSelected ? 280 : 190
            : state.isSelected ? 165 : 92;
      context.save();
      context.translate(sx * pixelRatio, sy * pixelRatio);
      context.scale(scale * pixelRatio, scale * pixelRatio);
      context.beginPath();
      symbol.type(point.kind === 'user_track' ? d3.symbolStar : point.kind === 'artist' ? d3.symbolDiamond : point.kind === 'truck' ? d3.symbolStar : d3.symbolCircle).size(size)();
      context.globalAlpha = state.alpha;
      context.fillStyle = pointFill(point, clusterColor, thumbPreferences, predictedPreferences, colorByPreference, colorByPredictedPreference, truckScores);
      context.fill();
      context.lineWidth = state.isSelected ? 4 : state.isLinked || state.isSearchMatch || state.isClusterMatch ? 3 : 1.2;
      context.strokeStyle = state.isSelected ? '#fff' : state.isSearchMatch || state.isClusterMatch ? '#ffd166' : state.isLinked || state.isMarked ? '#85f5c4' : 'rgba(255,255,255,0.85)';
      context.stroke();
      context.restore();
      return {point, x: sx, y: sy, radius: Math.max(11, Math.sqrt(size) * scale)};
    }

    function draw() {
      context.save();
      context.scale(pixelRatio, pixelRatio);
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(255, 255, 255, 0.035)';
      roundedRect(context, 0, 0, width, height, 24);
      context.fill();
      context.restore();

      hitEdges = [];
      for (const edge of edges || []) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!isVisible(source) || !isVisible(target)) continue;
        if (!source || !target) continue;
        const [x1, y1] = screenPoint(source);
        const [x2, y2] = screenPoint(target);
        context.save();
        context.scale(pixelRatio, pixelRatio);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.strokeStyle = '#85f5c4';
        context.globalAlpha = edge.similarity === null || edge.similarity === undefined ? 0.72 : Math.max(0.28, Math.min(0.9, edge.similarity));
        context.lineWidth = 2.4;
        context.lineCap = 'round';
        context.stroke();
        context.restore();
        hitEdges.push({edge, x1, y1, x2, y2});
      }

      hitPoints = points.filter(isVisible).map((point) => drawSymbol(point, pointState(point)));
      quadtree = d3.quadtree<HitPoint>(hitPoints, (item) => item.x, (item) => item.y);
    }

    function scheduleDraw() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        draw();
        frame = null;
      });
    }

    function pointerPosition(event: MouseEvent): [number, number] {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    function nearestPoint(event: MouseEvent): Point | null {
      if (!quadtree) return null;
      const [px, py] = pointerPosition(event);
      const candidate = quadtree.find(px, py, 24);
      if (!candidate) return null;
      return Math.hypot(candidate.x - px, candidate.y - py) <= candidate.radius + 6 ? candidate.point : null;
    }

    function nearestEdge(event: MouseEvent): SimilarityEdge | null {
      const [px, py] = pointerPosition(event);
      return hitEdges.find((item) => distanceToSegment(px, py, item.x1, item.y1, item.x2, item.y2) <= 8)?.edge || null;
    }

    function showPointTooltip(point: Point) {
      if (!finePointer) return;
      const [sx, sy] = screenPoint(point);
      setTooltip({data: {
        type: 'point',
        point,
        thumbValue: thumbPreferences?.[preferenceKeyForPoint(point) ?? ''] as PreferenceValue | undefined,
        truckScore: point.kind === 'truck' ? (truckScores?.[point.id] ?? 0) : undefined,
      }, x: sx, y: sy});
    }

    function showEdgeTooltip(edge: SimilarityEdge) {
      if (!finePointer) return;
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return;
      const [x1, y1] = screenPoint(source);
      const [x2, y2] = screenPoint(target);
      setTooltip({data: {type: 'edge', edge, byId}, x: (x1 + x2) / 2, y: (y1 + y2) / 2});
    }

    function hideTooltipUntilPanStops() {
      if (tooltipRevealTimerRef.current) window.clearTimeout(tooltipRevealTimerRef.current);
      setTooltip(null);
      if (!finePointer || !selected || !isVisible(selected)) return;
      tooltipRevealTimerRef.current = window.setTimeout(() => {
        showPointTooltip(selected);
        tooltipRevealTimerRef.current = null;
      }, 500);
    }

    function ensurePointVisible(point: Point, zoomSelection: d3.Selection<HTMLCanvasElement, unknown, null, undefined>, zoomBehavior: d3.ZoomBehavior<HTMLCanvasElement, unknown>): boolean {
      const [sx, sy] = screenPoint(point);
      const mobile = width < 760;
      const left = mobile ? 28 : 24;
      const right = width - (mobile ? 42 : 24);
      const top = mobile ? 118 : 24;
      const bottom = height - (mobile ? 96 : 24);
      const dx = sx < left ? left - sx : sx > right ? right - sx : 0;
      const dy = sy < top ? top - sy : sy > bottom ? bottom - sy : 0;
      if (!dx && !dy) return false;
      const current = transformRef.current;
      const nextTransform = d3.zoomIdentity.translate(current.x + dx, current.y + dy).scale(current.k);
      transformRef.current = nextTransform;
      zoomSelection.call(zoomBehavior.transform, nextTransform);
      return true;
    }

    function handlePointerMove(event: MouseEvent) {
      if (!finePointer) return;
      const point = nearestPoint(event);
      if (point) {
        canvas.style.cursor = 'pointer';
        showPointTooltip(point);
        return;
      }
      const edge = nearestEdge(event);
      if (edge) {
        canvas.style.cursor = 'pointer';
        showEdgeTooltip(edge);
        return;
      }
      canvas.style.cursor = 'grab';
      setTooltip(null);
    }

    function handleClick(event: MouseEvent) {
      onCanvasClick?.();
      const point = nearestPoint(event);
      if (point) setSelected(point);
    }

    function handleMouseLeave(event: MouseEvent) {
      if (tooltipRef.current?.contains(event.relatedTarget as Node | null)) return;
      if (selected && isVisible(selected)) {
        showPointTooltip(selected);
        return;
      }
      setTooltip(null);
    }

    function handleTooltipLeave() {
      if (selected && isVisible(selected)) {
        showPointTooltip(selected);
        return;
      }
      setTooltip(null);
    }

    const zoom: d3.ZoomBehavior<HTMLCanvasElement, unknown> = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.55, 10])
      .on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = event.transform;
        scheduleDraw();
        hideTooltipUntilPanStops();
      });
    const selection = d3.select(canvas);
    selection.call(zoom).on('dblclick.zoom', null);
    selection.on('dblclick', () => {
      transformRef.current = d3.zoomIdentity;
      selection.transition().duration(220).call(zoom.transform, d3.zoomIdentity);
    });
    selection.call(zoom.transform, transformRef.current);
    canvas.addEventListener('mousemove', handlePointerMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    tooltipRef.current?.addEventListener('mouseleave', handleTooltipLeave);
    draw();
    if (focusRequest?.pointId && handledFocusRef.current !== focusRequest.nonce) {
      handledFocusRef.current = focusRequest.nonce;
      const focusPoint = byId.get(focusRequest.pointId);
      if (focusPoint && isVisible(focusPoint)) {
        const scale = transformRef.current.k || 1;
        const nextTransform = d3.zoomIdentity
          .translate(width / 2 - scale * x(focusPoint.x), height / 2 - scale * y(focusPoint.y))
          .scale(scale);
        transformRef.current = nextTransform;
        setTooltip(null);
        selection
          .transition()
          .duration(520)
          .ease(d3.easeCubicOut)
          .call(zoom.transform, nextTransform)
          .on('end', () => {
            draw();
            showPointTooltip(focusPoint);
          });
      }
    } else if (selected && isVisible(selected)) {
      ensurePointVisible(selected, selection, zoom);
      requestAnimationFrame(() => {
        draw();
        showPointTooltip(selected);
      });
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (tooltipRevealTimerRef.current) window.clearTimeout(tooltipRevealTimerRef.current);
      canvas.removeEventListener('mousemove', handlePointerMove);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      tooltipRef.current?.removeEventListener('mouseleave', handleTooltipLeave);
      selection.on('.zoom', null);
    };
  }, [points, loading, selected, marks, thumbPreferences, predictedPreferences, colorByPreference, colorByPredictedPreference, onThumb, edges, linkedPointIds, hasSearch, searchMatchIds, selectedCluster, showArtists, showSongs, focusRequest, onCanvasClick, onSelectArtist, onSelectTruck, onPlayArtistSong, onPlaySimilar, onRandomSong, sizeVersion]);

  const handlers: TooltipHandlers = {
    onThumb,
    onSelectArtist,
    onSelectTruck,
    onPlayArtistSong,
    onPlaySimilar,
    onRandomSong,
  };

  return (
    <>
      <canvas ref={ref} className="plot" />
      <div ref={tooltipRef} className="tooltip" hidden={!tooltip}>
        {tooltip && <TooltipContent data={tooltip.data} handlers={handlers} />}
      </div>
    </>
  );
}
