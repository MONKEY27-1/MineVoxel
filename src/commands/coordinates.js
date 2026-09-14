// Coordinate syntax (phase 4): absolute (`100 64 -200`), relative
// (`~ ~5 ~`, offsets from the executor's own position), and local
// (`^ ^ ^5`, relative to the executor's facing direction — the third
// value is forward). Mixed absolute/relative is legal (`~10 64 ~-3`);
// mixing local with either is not (matches the reasoning: a local
// coordinate only makes sense as a full rotated triplet, an absolute/
// relative axis has no "forward" to combine it with).

function parseAxis(reader) {
  const start = reader.cursor;
  if (reader.peekMatches((c) => c === '~')) {
    reader.skip();
    if (reader.peekMatches((c) => c !== ' ' && c !== '')) {
      const value = reader.readFloat();
      return { kind: 'relative', value };
    }
    return { kind: 'relative', value: 0 };
  }
  if (reader.peekMatches((c) => c === '^')) {
    reader.skip();
    if (reader.peekMatches((c) => c !== ' ' && c !== '')) {
      const value = reader.readFloat();
      return { kind: 'local', value };
    }
    return { kind: 'local', value: 0 };
  }
  try {
    const value = reader.readFloat();
    return { kind: 'absolute', value };
  } catch {
    reader.cursor = start;
    reader.error('Expected a coordinate (a number, ~offset, or ^offset)');
  }
}

/** Parses 3 whitespace-separated axes into {x,y,z} parts, each {kind,value}. Does not resolve against an executor yet — that's resolvePosition's job, so suggestion/validation code can inspect the parsed form first. */
export function parseCoordinateTriplet(reader) {
  const x = parseAxis(reader);
  reader.skipWhitespace();
  const y = parseAxis(reader);
  reader.skipWhitespace();
  const z = parseAxis(reader);
  const kinds = new Set([x.kind, y.kind, z.kind]);
  if (kinds.has('local') && kinds.size > 1) {
    reader.error('Cannot mix local (^) coordinates with absolute or relative ones — use ^ ^ ^ for all three');
  }
  return { x, y, z, isLocal: kinds.has('local') };
}

function localBasis(yaw, pitch) {
  const forward = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const rx = -forward.z;
  const rz = forward.x;
  const rLen = Math.hypot(rx, rz) || 1; // straight up/down: forward's horizontal component vanishes — fall back to yaw=0's right vector rather than dividing by zero
  const right = { x: rx / rLen, y: 0, z: rz / rLen };
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  return { forward, right, up };
}

/**
 * Resolves a parsed triplet (from parseCoordinateTriplet) into a real
 * world {x,y,z}, given the executing entity's own position/yaw/pitch as
 * `origin`. `floor` (block-position arguments) floors the final result
 * to the containing block; entity/vector positions keep decimals.
 */
export function resolvePosition(parsed, origin, { floor = false } = {}) {
  let result;
  if (parsed.isLocal) {
    const { right, up, forward } = localBasis(origin.yaw ?? 0, origin.pitch ?? 0);
    result = {
      x: origin.x + right.x * parsed.x.value + up.x * parsed.y.value + forward.x * parsed.z.value,
      y: origin.y + right.y * parsed.x.value + up.y * parsed.y.value + forward.y * parsed.z.value,
      z: origin.z + right.z * parsed.x.value + up.z * parsed.y.value + forward.z * parsed.z.value,
    };
  } else {
    const axis = (part, o) => (part.kind === 'relative' ? o + part.value : part.value);
    result = { x: axis(parsed.x, origin.x), y: axis(parsed.y, origin.y), z: axis(parsed.z, origin.z) };
  }
  if (floor) {
    result.x = Math.floor(result.x);
    result.y = Math.floor(result.y);
    result.z = Math.floor(result.z);
  }
  return result;
}

/** True if every axis is absolute — used by suggestion code to decide whether to offer the player's live position as a starting suggestion (relative/local coordinates don't need it, they already default to "here"). */
export function isFullyAbsolute(parsed) {
  return parsed.x.kind === 'absolute' && parsed.y.kind === 'absolute' && parsed.z.kind === 'absolute';
}

export function formatAxis(part) {
  if (part.kind === 'absolute') return `${part.value}`;
  const prefix = part.kind === 'relative' ? '~' : '^';
  return part.value === 0 ? prefix : `${prefix}${part.value}`;
}
