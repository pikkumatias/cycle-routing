import polyline from '@mapbox/polyline'
import { GridIndex } from './geo.js'
import type { LatLng } from './types.js'

export type RoadClass = 'trunk' | 'primary' | 'secondary' | 'tertiary'

/** A major road (trunk–tertiary, including links) as stored in the layer file. */
export type RoadRecord = {
  cls: RoadClass
  name?: string
  maxspeed?: number
  lanes?: number
  /** Painted bike lane on the carriageway (`cycleway*=lane`). */
  bikeLane?: boolean
  /** Tram rails in the carriageway. */
  tram?: boolean
  /** Grade-separated: crossing it is not an at-grade crossing. */
  grade?: 'bridge' | 'tunnel'
  /** Encoded polyline, precision 6. */
  geom: string
  /** Indices into `signals` of signal nodes that are part of this road. */
  signals?: number[]
}

/** Prebuilt OSM data, produced by `npm run data:osm` (scripts/build-osm-layers.ts). */
export type OsmLayersFile = {
  version: 1
  generatedAt: string
  /** OSM data timestamp reported by Overpass. */
  osmTimestamp: string
  /** [south, west, north, east] covered by the file. */
  bbox: [number, number, number, number]
  /** Signal nodes that stop cyclists (both tagging styles), [lat, lon]. */
  signals: LatLng[]
  roads: RoadRecord[]
  /** Thinned nodes of car-free paths away from major roads, for snapping via points. */
  calmNodes: LatLng[]
  /**
   * Bridges and tunnels that are not major roads (cycle/foot bridges, underpasses, minor
   * road bridges), encoded polylines precision 6. A route on one cannot cross or stop at
   * anything at ground level.
   */
  gradeSeparated: string[]
}

export type Road = Omit<RoadRecord, 'geom' | 'signals'> & {
  geom: LatLng[]
  signals: LatLng[]
}

export type RoadSegment = { road: Road; a: LatLng; b: LatLng }

export type GradeSegment = { a: LatLng; b: LatLng }

/** Spatially indexed layers used by the engine at request time. */
export type Layers = {
  signals: GridIndex<LatLng>
  roadSegments: GridIndex<RoadSegment>
  calmNodes: GridIndex<LatLng>
  gradeSeparated: GridIndex<GradeSegment>
  /** Identifies the data the plan was computed from. */
  dataVersion: string
}

const CELL_M = 100

export function buildLayers(file: OsmLayersFile): Layers {
  const signals = new GridIndex<LatLng>(CELL_M)
  for (const s of file.signals) signals.insert(s, [s])

  const roadSegments = new GridIndex<RoadSegment>(CELL_M)
  for (const record of file.roads) {
    const road: Road = {
      ...record,
      geom: polyline.decode(record.geom, 6),
      signals: (record.signals ?? []).map((i) => file.signals[i]),
    }
    for (let i = 0; i < road.geom.length - 1; i++) {
      const seg = { road, a: road.geom[i], b: road.geom[i + 1] }
      roadSegments.insert(seg, [seg.a, seg.b])
    }
  }

  const calmNodes = new GridIndex<LatLng>(CELL_M * 2)
  for (const n of file.calmNodes) calmNodes.insert(n, [n])

  const gradeSeparated = new GridIndex<GradeSegment>(CELL_M)
  for (const encoded of file.gradeSeparated) {
    const geom = polyline.decode(encoded, 6)
    for (let i = 0; i < geom.length - 1; i++) {
      const seg = { a: geom[i], b: geom[i + 1] }
      gradeSeparated.insert(seg, [seg.a, seg.b])
    }
  }

  return { signals, roadSegments, calmNodes, gradeSeparated, dataVersion: file.osmTimestamp }
}
