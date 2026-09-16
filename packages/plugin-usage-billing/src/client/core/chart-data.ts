/** 自绘图表的数据几何（纯函数；不引图表库）。 */

export function sparklinePoints(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return ''
  if (values.length === 1) return `0,${height / 2}`
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min
  const stepX = width / (values.length - 1)
  return values
    .map((v, i) => {
      const ratio = span === 0 ? 0.5 : (v - min) / span
      const y = height - ratio * height
      return `${Number((i * stepX).toFixed(4))},${Number(y.toFixed(4))}`
    })
    .join(' ')
}

export interface Bar { x: number; y: number; w: number; h: number }

export function barGeometry(values: readonly number[], width: number, height: number): Bar[] {
  if (values.length === 0) return []
  const max = Math.max(...values, 0)
  const w = width / values.length
  return values.map((v, i) => {
    const h = max === 0 ? 0 : (v / max) * height
    return {
      x: Number((i * w).toFixed(4)),
      w: Number(w.toFixed(4)),
      h: Number(h.toFixed(4)),
      y: Number((height - h).toFixed(4)),
    }
  })
}
