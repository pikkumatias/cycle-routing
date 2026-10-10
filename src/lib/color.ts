let ctx: CanvasRenderingContext2D | null | undefined

/**
 * Any CSS colour (oklch, hsl, named, …) as `rgba(r, g, b, a)`, for consumers
 * that only parse sRGB notations: MapLibre styles and `<meta name="theme-color">`.
 * The browser does the conversion by painting one pixel. Without a canvas
 * (tests) the input is returned unchanged.
 */
export function toRgba(color: string): string {
  if (ctx === undefined) {
    ctx =
      typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)
        ? null
        : document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  }
  if (!ctx || !color) return color
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`
}
