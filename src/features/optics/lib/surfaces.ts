import type { Element, Point } from "../../../shared/document";
import { endpoints, intersect, prismVertices } from "../../../shared/geometry";

export interface SurfaceHit {
  element: Element;
  t: number;
  point: Point;
  normal: Point;
}

export function nearestSurface(
  items: Element[],
  origin: Point,
  direction: Point,
): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  for (const e of items) {
    if (e.kind === "source") continue;
    const vertices = e.kind === "prism" ? prismVertices(e) : endpoints(e);
    const edges =
      e.kind === "prism"
        ? vertices.map((v, i) => [v, vertices[(i + 1) % 3]])
        : [vertices];
    for (const [a, b] of edges) {
      const hit = intersect(origin, direction, a, b);
      if (hit && (!best || hit.t < best.t)) best = { ...hit, element: e };
    }
  }
  return best;
}

/**
 * Unclipped crossing of a screen's infinite line, expressed in the same
 * parameter the detector uses: position along the screen and whether it landed
 * inside the physical segment. Unclipped coordinates let the sampler see a
 * wavelength interval that straddles a screen edge even when no sample hits.
 */
export function screenCrossing(
  screen: Element,
  origin: Point,
  direction: Point,
) {
  const [a, b] = endpoints(screen);
  const edgeX = b.x - a.x,
    edgeY = b.y - a.y,
    den = direction.x * edgeY - direction.y * edgeX;
  if (Math.abs(den) < 1e-9) return null;
  const vx = a.x - origin.x,
    vy = a.y - origin.y,
    t = (vx * edgeY - vy * edgeX) / den;
  if (t <= 0.001) return null;
  const length = Math.hypot(edgeX, edgeY);
  if (length < 1e-9) return null;
  // Same definition as the detector: projection of the crossing point onto the
  // screen's tangent, measured from the screen centre.
  const tangent = { x: edgeX / length, y: edgeY / length };
  const point = { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
  return {
    t,
    position:
      (point.x - screen.x) * tangent.x + (point.y - screen.y) * tangent.y,
    half: screen.size / 2,
  };
}
