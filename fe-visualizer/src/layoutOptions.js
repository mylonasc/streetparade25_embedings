export const DEFAULT_LAYOUT_OPTIONS = {
  pcaEnabled: false,
  pcaComponents: '10',
  tsneInput: 'raw',
  clusterCount: '',
  clusterInput: 'raw',
  tsnePerplexity: '',
  tsneLearningRate: 'auto',
  tsneMetric: 'cosine',
  randomState: '42',
  linkedTrackCount: '5',
  similarityThreshold: '0.3',
  similarityMetric: 'cosine',
};

export function layoutPayload(username, options) {
  const pcaEnabled = Boolean(options.pcaEnabled);
  return {
    username,
    pca_enabled: pcaEnabled,
    pca_components: optionalNumber(options.pcaComponents) || 10,
    tsne_input: pcaEnabled ? options.tsneInput : 'raw',
    cluster_count: optionalNumber(options.clusterCount),
    cluster_input: pcaEnabled ? options.clusterInput : 'raw',
    tsne_perplexity: optionalNumber(options.tsnePerplexity),
    tsne_learning_rate: optionalLearningRate(options.tsneLearningRate),
    tsne_metric: options.tsneMetric,
    random_state: Number(options.randomState) || 42,
  };
}

export function optionalNumber(value) {
  if (String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function optionalLearningRate(value) {
  const cleaned = String(value).trim();
  if (!cleaned || cleaned.toLowerCase() === 'auto') return 'auto';
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 'auto';
}
