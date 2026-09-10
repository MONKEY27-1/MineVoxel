// Owns the map of dimensionId -> Dimension and which one is active.
// This is the only place that is allowed to know how many dimensions
// exist; everything else asks World for "the active dimension".

export class World {
  constructor() {
    this.dimensions = new Map();
    this.activeDimensionId = null;
  }

  register(dimension) {
    this.dimensions.set(dimension.id, dimension);
    if (this.activeDimensionId === null) this.activeDimensionId = dimension.id;
    return dimension;
  }

  get(id) {
    return this.dimensions.get(id) ?? null;
  }

  getActive() {
    return this.dimensions.get(this.activeDimensionId) ?? null;
  }

  setActive(id) {
    if (!this.dimensions.has(id)) {
      throw new Error(`World.setActive: unknown dimension "${id}"`);
    }
    this.activeDimensionId = id;
  }
}
