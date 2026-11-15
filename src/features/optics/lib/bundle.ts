import type { Element, LabDocument, Point } from "../../../shared/document";
import { add, mul, dot, sub, direction, norm } from "../../../shared/geometry";
import { spatialRays } from "./emission";
import { nearestSurface, screenCrossing } from "./surfaces";
import { reflect, refract, materialIndex } from "./refraction";

export interface PathSegment {
  from: Point;
  to: Point;
  /** Fraction of the ray's energy still travelling on this segment. */
  factor: number;
}
export interface PathHit {
  screen: string;
  position: number;
}
export interface ScreenCrossing {
  screen: string;
  /** Unclipped position on the screen's infinite line, in the detector's sign. */
  position: number;
  /** Half width of the receiving window, in mm. */
  half: number;
  /** True when the crossing landed inside the physical screen. */
  inside: boolean;
}
export interface PathRay {
  segments: PathSegment[];
  hit: PathHit | null;
  /**
   * Unclipped crossings of every screen plane reached by this path. They carry
   * no energy; they exist so the sampler can tell whether an unsampled
   * wavelength between two samples might slip into a narrow window.
   */
  crossings: ScreenCrossing[];
  truncated: boolean;
}
export interface Bundle {
  rays: PathRay[];
  /** True when this call actually traced new geometry. */
  traced: boolean;
  /** True when the budget forced reuse of a nearby wavelength's geometry. */
  approximate: boolean;
  key: string;
}

/** Deterministic wavelength key; finer than any editable line spacing. */
export function wavelengthKey(wavelength: number) {
  return wavelength.toFixed(4);
}

/**
 * Traces one source's spatial ray bundle at a single wavelength and caches it.
 * The bundle carries no energy; energy is attached later so the same geometry
 * can serve as an exact sample, a zero-power probe, or both without ever
 * counting an extra watt.
 */
export class GeometryCache {
  private bySource = new Map<string, Map<string, PathRay[]>>();
  rayCount = 0;
  exceeded = false;
  constructor(
    private doc: LabDocument,
    readonly budget: number,
  ) {}

  get remaining() {
    return this.budget - this.rayCount;
  }

  private nearest(sourceId: string, wavelength: number): PathRay[] | undefined {
    const map = this.bySource.get(sourceId);
    if (!map) return undefined;
    let best: PathRay[] | undefined;
    let bestDelta = Infinity;
    for (const [key, rays] of map) {
      const delta = Math.abs(Number(key) - wavelength);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = rays;
      }
    }
    return best;
  }

  trace(
    source: Element,
    wavelength: number,
    options: { force?: boolean } = {},
  ): Bundle {
    const key = wavelengthKey(wavelength);
    const cached = this.bySource.get(source.id)?.get(key);
    if (cached)
      return { rays: cached, traced: false, approximate: false, key };

    const rays = spatialRays(source);
    const cost = rays.length;
    if (!options.force && this.rayCount + cost > this.budget) {
      const near = this.nearest(source.id, wavelength);
      this.exceeded = true;
      if (near)
        return { rays: near, traced: false, approximate: true, key };
    }
    const paths = rays.map((ray) =>
      tracePath(this.doc, ray.origin, ray.direction, wavelength),
    );
    let map = this.bySource.get(source.id);
    if (!map) {
      map = new Map();
      this.bySource.set(source.id, map);
    }
    map.set(key, paths);
    this.rayCount += paths.length;
    if (this.rayCount > this.budget) this.exceeded = true;
    return { rays: paths, traced: true, approximate: false, key };
  }
}

function tracePath(
  doc: LabDocument,
  origin: Point,
  initial: Point,
  wavelength: number,
): PathRay {
  let o = origin,
    d = initial,
    inside: string | null = null,
    factor = 1;
  const segments: PathSegment[] = [];
  const crossings: ScreenCrossing[] = [];
  const screens = doc.items.filter((element) => element.kind === "screen");
  let hit: PathHit | null = null;
  let truncated = false;
  for (let bounce = 0; bounce < 32; bounce++) {
    const nearest = nearestSurface(doc.items, o, d);
    const dest = nearest?.point ?? add(o, mul(d, 1800));
    const limit = nearest?.t ?? Infinity;
    for (const screen of screens) {
      if (crossings.some((crossing) => crossing.screen === screen.id)) continue;
      const crossing = screenCrossing(screen, o, d);
      if (!crossing || crossing.t > limit + 1e-6) continue;
      crossings.push({
        screen: screen.id,
        position: crossing.position,
        half: crossing.half,
        inside: Math.abs(crossing.position) <= crossing.half,
      });
    }
    segments.push({ from: o, to: dest, factor });
    if (!nearest) break;
    const element = nearest.element;
    if (element.kind === "screen") {
      hit = {
        screen: element.id,
        position: dot(sub(nearest.point, element), direction(element.angle)),
      };
      break;
    }
    if (element.kind === "mirror") d = reflect(d, nearest.normal);
    if (element.kind === "lens") {
      const axis = direction(element.angle - 90),
        tangent = direction(element.angle),
        forward = dot(d, axis) >= 0 ? 1 : -1,
        u = dot(sub(nearest.point, element), tangent),
        axial = Math.max(0.0001, Math.abs(dot(d, axis))),
        slope = dot(d, tangent) / axial - u / element.focal;
      d = norm(add(mul(axis, forward), mul(tangent, slope)));
    }
    if (element.kind === "prism") {
      const n = materialIndex(element.index, wavelength),
        exiting: boolean = inside === element.id,
        transmitted = refract(
          d,
          nearest.normal,
          exiting ? n : 1,
          exiting ? 1 : n,
        );
      if (transmitted) {
        d = transmitted;
        inside = exiting ? null : element.id;
        factor *= 0.96;
      } else d = reflect(d, nearest.normal);
    }
    o = add(nearest.point, mul(d, 0.01));
    if (bounce === 31) truncated = true;
  }
  return { segments, hit, crossings, truncated };
}
