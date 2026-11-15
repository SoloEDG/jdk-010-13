import type {
  AnalysisQuality,
  ContinuousBand,
  Element,
  LineBand,
  SpectrumBand,
} from "../../../shared/document";
import { spectrumOf, totalWeight } from "./spectrum";
import { spatialRays } from "./emission";
import { GeometryCache, type PathRay, type ScreenCrossing } from "./bundle";

const EPS = 1e-9;

export interface RayOutcome {
  screen: string | null;
  position: number;
}
export interface Sample {
  wavelength: number;
  paths: PathRay[];
  outcome: RayOutcome[];
  crossings: ScreenCrossing[][];
  approximate: boolean;
}

export interface Budget {
  quality: AnalysisQuality;
  initialCells: number;
  maxPasses: number;
  splitsPerPass: number;
  maxDepth: number;
  lineSamples: number;
  quarterProbes: boolean;
  /** Refine resolved continuum cells until their width is at most this, in nm. */
  targetGap: number;
}

/**
 * Two explicitly different sampling budgets.
 *
 * `preview` is what runs while a device is being dragged: one coarse pass, one
 * refinement round, no probes. `stable` runs on release and adds 25/75 % probes
 * and six refinement rounds. Because both sit on the same normalised energy,
 * denser sampling refines the same watts instead of inventing new ones.
 */
export const budgets: Record<AnalysisQuality, Budget> = {
  preview: {
    quality: "preview",
    initialCells: 2,
    maxPasses: 1,
    splitsPerPass: 4,
    maxDepth: 4,
    lineSamples: 8,
    quarterProbes: false,
    targetGap: 80,
  },
  stable: {
    quality: "stable",
    initialCells: 8,
    maxPasses: 6,
    splitsPerPass: 16,
    maxDepth: 9,
    lineSamples: 32,
    quarterProbes: true,
    targetGap: 12,
  },
};

export type ScreenWindow = (screen: string) => { size: number } | undefined;

/** Memoised wavelength → geometry access for one source. */
export class Sampler {
  private memo = new Map<string, Sample>();
  constructor(
    readonly cache: GeometryCache,
    readonly source: Element,
  ) {}
  get rayCost() {
    return Math.max(1, spatialRays(this.source).length);
  }
  get remaining() {
    return this.cache.remaining;
  }
  at(wavelength: number): Sample {
    const key = wavelength.toFixed(4);
    const hit = this.memo.get(key);
    if (hit) return hit;
    const bundle = this.cache.trace(this.source, wavelength);
    const sample: Sample = {
      wavelength,
      paths: bundle.rays,
      outcome: bundle.rays.map((path) =>
        path.hit
          ? { screen: path.hit.screen, position: path.hit.position }
          : { screen: null, position: Number.NaN },
      ),
      crossings: bundle.rays.map((path) => path.crossings),
      approximate: bundle.approximate,
    };
    this.memo.set(key, sample);
    return sample;
  }
}

export interface CreditedSample {
  wavelength: number;
  /** Share of the source's total power; credited shares sum to at most 1. */
  fraction: number;
  sample: Sample;
  /** Band ids whose energy this sample carries. */
  covers: string[];
}

export interface Cell {
  lo: number;
  hi: number;
  weight: number;
  depth: number;
  left: Sample;
  center: Sample;
  right: Sample;
  /** Zero-energy probes used only to bound the error. */
  probes: Sample[];
  resolved: boolean;
  reason: string;
  /** Worst-case position error inside this cell, in mm. */
  positionBound: number;
  /** Best estimate of the cell's energy-weighted centroid, in mm. */
  centroid: number;
  /** Screens this cell's representatives actually reach. */
  screens: string[];
}

export interface BandPlan {
  band: SpectrumBand;
  /** This band's share of source power, before line merging. */
  energyShare: number;
  representative: number;
  mergedLines: number;
  mergedInto?: string;
  credited: CreditedSample[];
  cells: Cell[];
  probes: number;
  maxGap: number;
  /** Share of this band's energy whose screen assignment is not established. */
  unresolvedShare: number;
  /** Energy-weighted position bound, in mm. */
  positionUncertainty: number;
  unresolvedCells: number;
  budgetLimited: boolean;
}

export interface SourcePlan {
  bands: BandPlan[];
  credited: CreditedSample[];
  probes: number;
  maxGap: number;
  unresolvedShare: number;
  positionUncertainty: number;
  budgetLimited: boolean;
}

/**
 * Plans every band of one source. Each line group and continuum band is
 * normalised against the whole spectrum, so more samples or more bands only
 * subdivide a fixed total power.
 */
export function planSource(
  source: Element,
  sampler: Sampler,
  quality: AnalysisQuality,
  screenWindow: ScreenWindow,
): SourcePlan {
  const budget = budgets[quality];
  const bands = spectrumOf(source).bands;
  const total = totalWeight(bands);
  const groups = mergeLines(bands, budget.lineSamples);
  const owners = new Map<number, string>();
  for (const band of bands) {
    if (band.kind !== "line") continue;
    const group = groups.get(band.id)!;
    if (!owners.has(group.group)) owners.set(group.group, band.id);
  }

  const shareOf = (bandId: string) => {
    const band = bands.find((candidate) => candidate.id === bandId);
    return band && total > 0 ? Math.max(0, band.weight) / total : 0;
  };
  const plans = bands.map((band): BandPlan => {
    const share = shareOf(band.id);
    if (band.kind === "line") {
      const group = groups.get(band.id)!;
      const members = bands.filter(
        (candidate): candidate is LineBand =>
          candidate.kind === "line" &&
          groups.get(candidate.id)!.group === group.group,
      );
      const ownerId = owners.get(group.group)!;
      return planLine(
        band,
        share,
        members,
        group,
        ownerId === band.id,
        ownerId,
        sampler,
        screenWindow,
        shareOf,
      );
    }
    return planContinuous(band, share, sampler, budget, screenWindow);
  });

  const credited = plans.flatMap((plan) => plan.credited);
  const creditedKeys = new Set(
    credited.map((entry) => entry.wavelength.toFixed(4)),
  );
  const probeKeys = new Set(
    plans
      .flatMap((plan) => plan.cells)
      .flatMap((cell) => [cell.left, cell.right, ...cell.probes])
      .map((sample) => sample.wavelength.toFixed(4))
      .filter((key) => !creditedKeys.has(key)),
  );
  const shareSum = plans.reduce((sum, plan) => sum + plan.energyShare, 0);
  return {
    bands: plans,
    credited,
    probes: probeKeys.size,
    maxGap: plans.reduce((max, plan) => Math.max(max, plan.maxGap), 0),
    unresolvedShare: plans.reduce(
      (sum, plan) => sum + plan.unresolvedShare * plan.energyShare,
      0,
    ),
    positionUncertainty:
      plans.reduce(
        (sum, plan) => sum + plan.positionUncertainty * plan.energyShare,
        0,
      ) / Math.max(EPS, shareSum),
    budgetLimited:
      plans.some((plan) => plan.budgetLimited) || sampler.cache.exceeded,
  };
}

interface LineGroup {
  group: number;
  representative: number;
  members: string[];
}

/**
 * Dense line spectra are folded into at most `limit` representative
 * wavelengths. A representative is the energy-weighted mean of its group, so
 * total power and the spectral centroid are conserved exactly. Only structure
 * finer than the grouping is lost, which is reported as `mergedLines`.
 */
export function mergeLines(bands: SpectrumBand[], limit: number) {
  const lines = bands
    .filter((band): band is LineBand => band.kind === "line")
    .slice()
    .sort((a, b) => a.wavelength - b.wavelength);
  const groups = new Map<string, LineGroup>();
  if (lines.length <= limit) {
    lines.forEach((line, index) =>
      groups.set(line.id, {
        group: index,
        representative: line.wavelength,
        members: [line.id],
      }),
    );
    return groups;
  }
  const chunk = Math.ceil(lines.length / limit);
  for (let start = 0; start < lines.length; start += chunk) {
    const slice = lines.slice(start, start + chunk);
    const weight = slice.reduce((sum, line) => sum + line.weight, 0);
    const mean =
      weight > 0
        ? slice.reduce((sum, line) => sum + line.wavelength * line.weight, 0) /
          weight
        : slice.reduce((sum, line) => sum + line.wavelength, 0) / slice.length;
    const representative = Math.round(mean * 100) / 100;
    slice.forEach((line) =>
      groups.set(line.id, {
        group: start,
        representative,
        members: slice.map((member) => member.id),
      }),
    );
  }
  return groups;
}

function planLine(
  band: LineBand,
  share: number,
  members: LineBand[],
  group: LineGroup,
  isOwner: boolean,
  ownerId: string,
  sampler: Sampler,
  screenWindow: ScreenWindow,
  shareOf: (bandId: string) => number,
): BandPlan {
  const creditedSample = sampler.at(group.representative);
  // Fractions below are always shares of the source's total power, so merged
  // lines credit the group once instead of once per member.
  const groupShare = members.reduce(
    (sum, member) => sum + shareOf(member.id),
    0,
  );
  const mergedInto = isOwner ? undefined : ownerId;
  if (!isOwner) {
    return {
      band,
      energyShare: share,
      representative: group.representative,
      mergedLines: 0,
      mergedInto,
      credited: [],
      cells: [],
      probes: 0,
      maxGap: 0,
      unresolvedShare: 0,
      positionUncertainty: 0,
      unresolvedCells: 0,
      budgetLimited: creditedSample.approximate,
    };
  }

  // Merging several lines into one representative trace loses their true
  // separations. Trace the two spectral extremes as zero-energy probes so the
  // loss is measured rather than assumed, and can feed the error report.
  const extremes = members.length > 1
    ? [
        sampler.at(Math.min(...members.map((member) => member.wavelength))),
        sampler.at(Math.max(...members.map((member) => member.wavelength))),
      ]
    : [];
  const probes = extremes.filter(
    (sample) => sample.wavelength.toFixed(4) !== creditedSample.wavelength.toFixed(4),
  );
  let unresolved = false;
  let positionBound = 0;
  for (let ray = 0; ray < creditedSample.outcome.length; ray++) {
    const screens = new Set(
      [creditedSample, ...probes].map(
        (sample) => sample.outcome[ray]?.screen ?? null,
      ),
    );
    if (screens.size > 1) {
      unresolved = true;
      break;
    }
    const positions = [creditedSample, ...probes]
      .map((sample) => sample.outcome[ray])
      .filter((outcome) => outcome && outcome.screen)
      .map((outcome) => outcome!.position);
    if (positions.length > 1) {
      const spread = Math.max(...positions) - Math.min(...positions);
      const window = screenWindow(
        creditedSample.outcome[ray].screen as string,
      );
      if (window && Math.max(...positions) + spread > window.size / 2) {
        unresolved = true;
        break;
      }
      positionBound = Math.max(positionBound, spread / 2);
    }
  }
  const mergedCount = members.length - 1;
  // A group's uncertainty is shared by every member in proportion to its own
  // fraction, so the source-level report attributes the loss once, not once
  // per member and not all to the representative.
  const memberFraction = groupShare > 0 ? share / groupShare : 0;
  return {
    band,
    energyShare: share,
    representative: group.representative,
    mergedLines: mergedCount,
    mergedInto,
    credited: [
      {
        wavelength: group.representative,
        fraction: groupShare,
        sample: creditedSample,
        covers: group.members,
      },
    ],
    cells: [],
    probes: probes.length,
    maxGap: 0,
    unresolvedShare: unresolved ? memberFraction : 0,
    positionUncertainty: positionBound,
    unresolvedCells: unresolved ? 1 : 0,
    budgetLimited:
      creditedSample.approximate || probes.some((sample) => sample.approximate),
  };
}

function planContinuous(
  band: ContinuousBand,
  share: number,
  sampler: Sampler,
  budget: Budget,
  screenWindow: ScreenWindow,
): BandPlan {
  const from = Math.min(band.from, band.to);
  const to = Math.max(band.from, band.to);
  const cost = sampler.rayCost;
  const affordable = Math.max(1, Math.floor(sampler.remaining / (cost * 4)));
  let budgetLimited = affordable < budget.initialCells;
  const count = Math.max(1, Math.min(budget.initialCells, affordable));
  let cells = Array.from({ length: count }, (_, index) =>
    buildCell(
      from + ((to - from) * index) / count,
      from + ((to - from) * (index + 1)) / count,
      1 / count,
      0,
      sampler,
      budget,
      screenWindow,
    ),
  );

  for (let pass = 0; pass < budget.maxPasses; pass++) {
    // Refine unresolved cells first; once they are settled, keep splitting
    // wide-but-trusted cells until the spectral grid meets the budget's
    // target gap. Both kinds of refinement subdivide the same energy.
    const pending = cells
      .filter(
        (cell) =>
          (!cell.resolved || cell.hi - cell.lo > budget.targetGap) &&
          cell.depth < budget.maxDepth,
      )
      .sort((a, b) => {
        const needA = (a.resolved ? 0 : 1) + (a.hi - a.lo) / budget.targetGap;
        const needB = (b.resolved ? 0 : 1) + (b.hi - b.lo) / budget.targetGap;
        return needB - needA;
      })
      .slice(0, budget.splitsPerPass);
    if (!pending.length) break;
    if (sampler.remaining < cost * 4) {
      budgetLimited = true;
      break;
    }
    const replacements = new Map<Cell, Cell[]>();
    for (const cell of pending) {
      if (cell.depth >= budget.maxDepth) {
        budgetLimited = true;
        continue;
      }
      if (sampler.remaining < cost * 4) {
        budgetLimited = true;
        break;
      }
      replacements.set(cell, splitCell(cell, sampler, budget, screenWindow));
    }
    if (!replacements.size) break;
    cells = cells.flatMap((cell) => replacements.get(cell) ?? [cell]);
  }

  const unresolved = cells.filter((cell) => !cell.resolved);
  const unresolvedShare = unresolved.reduce((sum, cell) => sum + cell.weight, 0);
  const hitWeight = cells.reduce(
    (sum, cell) => sum + (cell.screens.length ? cell.weight : 0),
    0,
  );
  const positionUncertainty =
    cells.reduce(
      (sum, cell) =>
        sum +
        (cell.screens.length
          ? cell.weight *
            (cell.resolved
              ? cell.positionBound
              : Math.max(...cell.screens.map((id) => screenWindow(id)?.size ?? 0)) / 2)
          : 0),
      0,
    ) / Math.max(EPS, hitWeight);
  // Every cell with real geometry is credited as the best estimate, even when
  // its error bound is wide; unresolved cells are what `unresolvedShare`
  // reports. Cells reusing another wavelength's geometry are excluded because
  // crediting them would double count that geometry's energy.
  const usable = cells.filter((cell) => !cell.center.approximate);
  const usableWeight = usable.reduce((sum, cell) => sum + cell.weight, 0);
  const credited: CreditedSample[] = usable.map((cell) => ({
    wavelength: cell.center.wavelength,
    fraction: usableWeight > 0 ? (cell.weight / usableWeight) * share : 0,
    sample: cell.center,
    covers: [band.id],
  }));
  return {
    band,
    energyShare: share,
    representative: (from + to) / 2,
    mergedLines: 0,
    credited,
    cells,
    probes: countProbes(cells, usable),
    maxGap: maxGap(cells),
    unresolvedShare,
    positionUncertainty,
    unresolvedCells: unresolved.length,
    budgetLimited:
      budgetLimited ||
      cells.some((cell) => cell.center.approximate || cell.reason === "预算不足"),
  };
}

function countProbes(cells: Cell[], credited: Cell[]) {
  const creditedKeys = new Set(
    credited.map((cell) => cell.center.wavelength.toFixed(4)),
  );
  return new Set(
    cells
      .flatMap((cell) => [cell.left, cell.right, ...cell.probes])
      .map((sample) => sample.wavelength.toFixed(4))
      .filter((key) => !creditedKeys.has(key)),
  ).size;
}

function maxGap(cells: Cell[]) {
  return cells.reduce((max, cell) => Math.max(max, cell.hi - cell.lo), 0);
}

function buildCell(
  lo: number,
  hi: number,
  weight: number,
  depth: number,
  sampler: Sampler,
  budget: Budget,
  screenWindow: ScreenWindow,
  known: { left?: Sample; center?: Sample; right?: Sample } = {},
): Cell {
  const left = known.left ?? sampler.at(lo);
  const center = known.center ?? sampler.at((lo + hi) / 2);
  const right = known.right ?? sampler.at(hi);
  const probes = budget.quarterProbes
    ? [sampler.at(lo + (hi - lo) * 0.25), sampler.at(lo + (hi - lo) * 0.75)]
    : [];
  const cell: Cell = {
    lo,
    hi,
    weight,
    depth,
    left,
    center,
    right,
    probes,
    resolved: false,
    reason: "",
    positionBound: 0,
    centroid: Number.NaN,
    screens: [],
  };
  inspect(cell, screenWindow);
  // Unresolved cells still need a screen list, or their position error would
  // silently drop out of the band bound.
  if (!cell.screens.length) cell.screens = screensOf(cell.center);
  return cell;
}

function splitCell(
  cell: Cell,
  sampler: Sampler,
  budget: Budget,
  screenWindow: ScreenWindow,
) {
  const mid = (cell.lo + cell.hi) / 2;
  // A quarter probe measured in the parent is exactly the centre of a child,
  // so each split usually costs two new traces instead of five.
  const leftCenter =
    cell.probes[0] ?? sampler.at(cell.lo + (mid - cell.lo) / 2);
  const rightCenter = cell.probes[1] ?? sampler.at(mid + (cell.hi - mid) / 2);
  return [
    buildCell(
      cell.lo,
      mid,
      cell.weight / 2,
      cell.depth + 1,
      sampler,
      budget,
      screenWindow,
      { left: cell.left, center: leftCenter, right: cell.center },
    ),
    buildCell(
      mid,
      cell.hi,
      cell.weight / 2,
      cell.depth + 1,
      sampler,
      budget,
      screenWindow,
      { left: cell.center, center: rightCenter, right: cell.right },
    ),
  ];
}

function orderedSamples(cell: Cell) {
  const seen = new Set<string>();
  return [cell.left, ...cell.probes, cell.center, cell.right]
    .filter((sample) => {
      const key = sample.wavelength.toFixed(4);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.wavelength - b.wavelength);
}

/**
 * Decides whether a cell can be trusted.
 *
 * For every spatial ray we look at the *unclipped* crossing of every screen
 * plane, not just at where the ray stopped. That is what makes a narrow
 * receiving window detectable: a window can sit between two sampled
 * wavelengths while both samples miss it, yet interpolation shows the crossing
 * sweeping straight across the window. A cell resolves only when each screen's
 * crossing interval stays wholly inside or wholly outside the window, with a
 * margin that covers the observed curvature, and when no sample is a reused
 * fallback geometry.
 */
function inspect(cell: Cell, screenWindow: ScreenWindow) {
  const samples = orderedSamples(cell);
  if (samples.some((sample) => sample.approximate)) {
    cell.reason = "预算不足";
    return;
  }
  if (samples.length < 2) {
    cell.resolved = true;
    cell.reason = "单波长";
    cell.screens = screensOf(cell.center);
    return;
  }
  const rayCount = cell.center.outcome.length;
  let bound = 0;
  let hitWeighted = 0;
  let hitCount = 0;
  const touched = new Set<string>();

  for (let ray = 0; ray < rayCount; ray++) {
    const screenIds = new Set<string>();
    for (const sample of samples)
      for (const crossing of sample.crossings[ray])
        screenIds.add(crossing.screen);
    for (const sample of samples) {
      const outcome = sample.outcome[ray];
      if (outcome.screen) screenIds.add(outcome.screen);
    }
    for (const screenId of screenIds) {
      const points = samples.map((sample) => ({
        wavelength: sample.wavelength,
        crossing: sample.crossings[ray].find(
          (crossing) => crossing.screen === screenId,
        ),
      }));
      if (points.some((point) => !point.crossing)) {
        cell.reason = "部分波长未到达该接收屏";
        return;
      }
      const present = points.every((point) => point.crossing!.inside);
      const positions = points.map((point) => point.crossing!.position);
      const half = points[0].crossing!.half;
      const { chord, curvature } = variation(points);
      const uncertainty = Math.max(chord / 2, curvature);
      const lo = Math.min(...positions) - uncertainty;
      const hi = Math.max(...positions) + uncertainty;
      const inside = lo >= -half && hi <= half;
      const outside = lo > half || hi < -half;
      if (!inside && !outside) {
        cell.reason = present ? "贴近接收屏边缘" : "跨越接收屏边缘";
        return;
      }
      if (inside) {
        touched.add(screenId);
        hitCount++;
        hitWeighted += positions.reduce((sum, value) => sum + value, 0) /
          positions.length;
      }
      bound = Math.max(bound, uncertainty);
    }
  }

  cell.resolved = true;
  cell.positionBound = bound;
  cell.screens = [...touched];
  cell.centroid = hitCount ? hitWeighted / hitCount : Number.NaN;
  cell.reason = touched.size ? "" : "此段未落屏";
}

/** Linear chord and second-difference curvature of sampled positions. */
function variation(points: { wavelength: number; crossing?: ScreenCrossing }[]) {
  let chord = 0;
  let curvature = 0;
  const values = points.map((point) => point.crossing!.position);
  for (let index = 1; index < values.length; index++) {
    chord = Math.max(chord, Math.abs(values[index] - values[index - 1]));
    if (index >= 2)
      curvature = Math.max(
        curvature,
        Math.abs(values[index] - 2 * values[index - 1] + values[index - 2]) / 2,
      );
  }
  return { chord, curvature };
}

function screensOf(sample: Sample) {
  const screens: string[] = [];
  for (const outcome of sample.outcome)
    if (outcome.screen && !screens.includes(outcome.screen))
      screens.push(outcome.screen);
  return screens;
}
