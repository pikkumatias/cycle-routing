declare module '@mapbox/polyline' {
  const polyline: {
    decode(
      encoded: string,
      precision?: number,
    ): Array<[number, number]>
    encode(
      coordinates: Array<[number, number]>,
      precision?: number,
    ): string
  }
  export default polyline
}
