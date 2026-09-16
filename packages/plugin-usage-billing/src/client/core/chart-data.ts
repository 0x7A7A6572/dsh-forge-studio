/**
 * Data geometry for the hand-drawn charts (pure functions; no chart library).
 *
 * Tolerance contract (load-bearing): any non-finite input (`NaN` / `Infinity` /
 * `-Infinity`) is treated as `0` at the entrance. We coerce rather than filter, so the
 * point keeps its position in the sequence: filtering would slide the polyline x-axis
 * against its date labels and desynchronise bar count from label count. A non-finite
 * value is not "huge" or "minus infinity" -- it means "this number is not available".
 *
 * Both exports are therefore total: for any input, every emitted coordinate is finite
 * and inside the `[0,width] x [0,height]` canvas (bar height is never negative and the
 * bar bottom never crosses the canvas edge).
 */

/** Non-finite -> 0; finite values pass through. */
function finite(v: number): number {
  return Number.isFinite(v) ? v : 0
}

export function sparklinePoints(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return ''
  if (values.length === 1) return `0,${height / 2}`
  const xs = values.map(finite)
  const max = Math.max(...xs)
  const min = Math.min(...xs)
  const span = max - min
  const stepX = width / (values.length - 1)
  return xs
    .map((v, i) => {
      // All-equal values (including a span flattened to 0 by non-finite input) take the
      // mid-line; `(v - min) / span` would be 0/0 here.
      const ratio = span === 0 ? 0.5 : (v - min) / span
      const y = height - ratio * height
      return `${Number((i * stepX).toFixed(4))},${Number(y.toFixed(4))}`
    })
    .join(' ')
}

export interface Bar { x: number; y: number; w: number; h: number }

export function barGeometry(values: readonly number[], width: number, height: number): Bar[] {
  if (values.length === 0) return []
  const xs = values.map(finite)
  // reduce instead of Math.max(...xs, 0): spreading a huge array would blow the stack,
  // and what we want is exactly "the maximum including 0".
  const max = xs.reduce((acc, v) => (v > acc ? v : acc), 0)
  const w = width / values.length
  return xs.map((v, i) => {
    // Negative values (and the negative baseline left after non-finite values become 0)
    // are flattened to 0: a negative bar height paints the rect outside the canvas.
    const raw = max === 0 ? 0 : (v / max) * height
    const h = Math.min(Math.max(raw, 0), height)
    return {
      x: Number((i * w).toFixed(4)),
      w: Number(w.toFixed(4)),
      h: Number(h.toFixed(4)),
      y: Number((height - h).toFixed(4)),
    }
  })
}
