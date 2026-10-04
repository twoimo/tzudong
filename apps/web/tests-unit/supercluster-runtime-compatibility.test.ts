import { describe, expect, test } from 'bun:test';
import type { PointFeature } from 'supercluster';

import {
  createClusterIndex,
  expandCluster,
  getClusterCategories,
  getClusters,
  isCluster,
  type ClusterProperties,
} from '../lib/clustering';

const point = (id: string, lng: number, category: string): PointFeature<ClusterProperties> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, 37.5] },
  properties: { restaurantId: id, category, categories: [category] },
});

describe('Supercluster 9 application adapter compatibility', () => {
  test('loads points, expands clusters and preserves individual point properties', () => {
    const index = createClusterIndex(null, { maxZoom: 12, radius: 40 }, false);
    index.load([point('a', 127, '한식'), point('b', 127.0001, '분식')]);

    const clustered = getClusters(index, [126, 37, 128, 38], 8.9);
    expect(clustered).toHaveLength(1);
    const cluster = clustered[0];
    expect(isCluster(cluster)).toBe(true);
    if (!isCluster(cluster)) throw new Error('Expected a cluster');
    expect(cluster.properties.point_count).toBe(2);
    expect(expandCluster(index, cluster.properties.cluster_id).sort()).toEqual(['a', 'b']);
    expect(getClusterCategories(index, cluster.properties.cluster_id).sort()).toEqual(['분식', '한식']);

    const individual = getClusters(index, [126, 37, 128, 38], 13);
    expect(individual.every((feature) => !isCluster(feature))).toBe(true);
    expect(individual.map((feature) => feature.properties.restaurantId).sort()).toEqual(['a', 'b']);
    expect(getClusters(index, [-10, -10, 10, 10], 13)).toEqual([]);
  });

  test('accepts an empty index without manufacturing a cluster', () => {
    const index = createClusterIndex(null, {}, false).load([]);
    expect(getClusters(index, [-180, -85, 180, 85], 0)).toEqual([]);
  });
});
