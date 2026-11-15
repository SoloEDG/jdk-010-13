import type { Element, ScreenHit } from "../../../shared/document";

export interface BandMeasurement {
  bandId: string;
  label: string;
  source: string;
  /** Emitted energy of this band, in W. */
  emitted: number;
  /** Energy of this band that reached this screen, in W. */
  received: number;
  centroid: number;
  spread: number;
  bins: number[];
}

export interface Measurement {
  /** Per-bin received energy across every selected band, in W. */
  bins: number[];
  /** Per-band breakdown so a chart can be split or filtered. */
  bands: BandMeasurement[];
  energy: number;
  centroid: number;
  spread: number;
  count: number;
  peak: number;
  screen: string;
  /** Longest spectral gap among the bands that reached this screen, in nm. */
  maxGap: number;
  /** Received energy whose screen/position is not established, in W. */
  uncertainty: number;
  /** Centroid uncertainty from the sampler's position bound, in mm. */
  centroidUncertainty: number;
}

const positionBin = (position: number, size: number, resolution: number) =>
  Math.max(
    0,
    Math.min(resolution - 1, Math.floor((position / size + 0.5) * resolution)),
  );

/**
 * Measures one screen. `bandIds` optionally restricts the analysis; with no
 * filter the result is exactly the all-bands sum, so the monochromatic
 * experiment keeps its old numbers.
 */
export function measure(
  screen: Element | undefined,
  hits: ScreenHit[],
  resolution: number,
  bandIds?: string[],
  labels: Map<string, { label: string; energy: number; maxGap: number; positionUncertainty: number; energyUncertainty: number }> = new Map(),
): Measurement {
  const allowed = bandIds && bandIds.length ? new Set(bandIds) : null;
  const valid = screen
    ? hits.filter(
        (hit) =>
          hit.screen === screen.id && (!allowed || allowed.has(hit.bandId)),
      )
    : [];
  const bins = Array<number>(resolution).fill(0);
  const perBand = new Map<string, BandMeasurement>();
  let energy = 0;
  let centroid = 0;
  let centroidUncertainty = 0;
  // Unresolved energy is reported for every selected band, even when nothing
  // from that band reached this screen: "no signal" is exactly the case where
  // a coarse sample could have missed a narrow window.
  let uncertainty = 0;
  for (const [id, known] of labels)
    if (!allowed || allowed.has(id)) uncertainty += known.energyUncertainty;

  for (const hit of valid) {
    const index = screen
      ? positionBin(hit.position, screen.size, resolution)
      : 0;
    bins[index] += hit.power;
    energy += hit.power;
    centroid += hit.position * hit.power;
    const known = labels.get(hit.bandId);
    if (known) centroidUncertainty += known.positionUncertainty * hit.power;
    let entry = perBand.get(hit.bandId);
    if (!entry) {
      entry = {
        bandId: hit.bandId,
        label: known?.label ?? hit.bandId,
        source: hit.source,
        emitted: known?.energy ?? 0,
        received: 0,
        centroid: 0,
        spread: 0,
        bins: Array<number>(resolution).fill(0),
      };
      perBand.set(hit.bandId, entry);
    }
    entry.received += hit.power;
    entry.bins[index] += hit.power;
    entry.centroid += hit.position * hit.power;
  }

  centroid = energy ? centroid / energy : 0;
  const spread = energy
    ? Math.sqrt(
        valid.reduce(
          (sum, hit) => sum + (hit.position - centroid) ** 2 * hit.power,
          0,
        ) / energy,
      )
    : 0;
  for (const entry of perBand.values()) {
    entry.centroid = entry.received ? entry.centroid / entry.received : 0;
    entry.spread = entry.received
      ? Math.sqrt(
          valid
            .filter(
              (hit) =>
                hit.bandId === entry.bandId &&
                (!screen || hit.screen === screen.id),
            )
            .reduce(
              (sum, hit) => sum + (hit.position - entry.centroid) ** 2 * hit.power,
              0,
            ) / entry.received,
        )
      : 0;
    entry.bins = entry.received
      ? entry.bins.map((value) => value)
      : Array<number>(resolution).fill(0);
  }

  return {
    bins,
    bands: [...perBand.values()],
    energy,
    centroid,
    spread,
    count: valid.length,
    peak: Math.max(0, ...bins),
    screen: screen?.id ?? "",
    // Report the gap for the selected bands even if none of them hit: "nothing
    // arrived" is precisely the case a coarse grid may have missed.
    maxGap: Math.max(
      0,
      ...[...labels.entries()]
        .filter(([id]) => !allowed || allowed.has(id))
        .map(([, known]) => known.maxGap),
    ),
    uncertainty,
    centroidUncertainty: energy ? centroidUncertainty / energy : 0,
  };
}
