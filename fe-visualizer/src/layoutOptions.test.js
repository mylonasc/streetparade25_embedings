import {describe, expect, it} from 'vitest';
import {DEFAULT_LAYOUT_OPTIONS, layoutPayload, optionalLearningRate, optionalNumber} from './layoutOptions.js';

describe('layout options', () => {
  it('builds the backend payload with raw inputs when PCA is disabled', () => {
    expect(layoutPayload('alex', {...DEFAULT_LAYOUT_OPTIONS, tsneInput: 'pca', clusterInput: 'pca'})).toMatchObject({
      username: 'alex',
      pca_enabled: false,
      pca_components: 10,
      tsne_input: 'raw',
      cluster_input: 'raw',
      cluster_count: null,
      tsne_perplexity: null,
      tsne_learning_rate: 'auto',
      random_state: 42,
    });
  });

  it('allows PCA output to feed t-SNE and clustering', () => {
    expect(layoutPayload('alex', {
      ...DEFAULT_LAYOUT_OPTIONS,
      pcaEnabled: true,
      pcaComponents: '24',
      tsneInput: 'pca',
      clusterInput: 'pca',
      clusterCount: '8',
      tsnePerplexity: '30',
      tsneLearningRate: '150',
      randomState: '7',
    })).toMatchObject({
      pca_enabled: true,
      pca_components: 24,
      tsne_input: 'pca',
      cluster_input: 'pca',
      cluster_count: 8,
      tsne_perplexity: 30,
      tsne_learning_rate: 150,
      random_state: 7,
    });
  });

  it('normalizes optional numeric fields', () => {
    expect(optionalNumber('')).toBeNull();
    expect(optionalNumber('  ')).toBeNull();
    expect(optionalNumber('12.5')).toBe(12.5);
    expect(optionalNumber('not-a-number')).toBeNull();
  });

  it('normalizes learning rate', () => {
    expect(optionalLearningRate('')).toBe('auto');
    expect(optionalLearningRate('AUTO')).toBe('auto');
    expect(optionalLearningRate('200')).toBe(200);
    expect(optionalLearningRate('fast')).toBe('auto');
  });
});
