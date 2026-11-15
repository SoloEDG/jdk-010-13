import type {
  AnalysisQuality,
  BandSamplingReport,
  LabDocument,
  ScreenHit,
  Segment,
  TraceBand,
  TraceResult,
} from "../../../shared/document";
import { GeometryCache } from "./bundle";
import { analysisId, layoutId, spectrumId } from "./analysisId";
import { bandLabel, bandRange, spectrumOf, totalWeight } from "./spectrum";
import { planSource, Sampler, type CreditedSample } from "./sampling";

/** Default ray budget for one analysis. A preview stays well below it. */
export const MAX_RAYS = 24000;

/**
 * Band ids are local to a source ("line-0" in every source). Results expose a
 * source-qualified key so two sources with identically shaped spectra never
 * collapse into one filter option or one mission band.
 */
export function bandKey(sourceId: string, bandId: string) {
  return `${sourceId}::${bandId}`;
}

export function trace(
  doc: LabDocument,
  quality: AnalysisQuality = "stable",
): TraceResult {
  return traceDocument(doc, quality);
}

/**
 * Traces one document.
 *
 * Energy accounting is deliberately one-way: each band first receives a fixed
 * share of its source's power, and samples only subdivide that share. Probe
 * traces carry zero power, and merging dense lines uses an energy-weighted
 * representative, so adding samples, probes or bands can never add watts.
 */
export function traceDocument(
  doc: LabDocument,
  quality: AnalysisQuality,
  options: { budget?: number } = {},
): TraceResult {
  const cache = new GeometryCache(doc, options.budget ?? MAX_RAYS);
  const screenById = new Map(
    doc.items
      .filter((element) => element.kind === "screen")
      .map((element) => [element.id, element]),
  );
  const sources = doc.items.filter((element) => element.kind === "source");

  const segments: Segment[] = [];
  const hits: ScreenHit[] = [];
  const bands: TraceBand[] = [];
  const reports: BandSamplingReport[] = [];
  const creditedRays: {
    source: string;
    bandId: string;
    sample: CreditedSample;
    power: number;
  }[] = [];
  let emittedEnergy = 0;
  let receivedEnergy = 0;
  let truncated = 0;
  let mergedLines = 0;
  let maxGap = 0;
  let probeCount = 0;
  let positionWeighted = 0;
  let positionWeight = 0;
  let budgetLimited = cache.exceeded;

  for (const source of sources) {
    const sampler = new Sampler(cache, source);
    const plan = planSource(source, sampler, quality, (id) => screenById.get(id));
    const spectrum = spectrumOf(source);
    const weight = totalWeight(spectrum.bands);
    budgetLimited = budgetLimited || plan.budgetLimited;
    probeCount += plan.probes;

    for (const bandPlan of plan.bands) {
      const band = bandPlan.band;
      const energy =
        weight > 0 ? (source.power * Math.max(0, band.weight)) / weight : 0;
      emittedEnergy += energy;
      const [from, to] = bandRange(band);
      const key = bandKey(source.id, band.id);
      bands.push({
        source: source.id,
        bandId: key,
        label: bandLabel(band),
        kind: band.kind,
        weight: band.weight,
        energy,
        wavelength: bandPlan.representative,
        from,
        to,
      });
      const unresolvedEnergy = energy * bandPlan.unresolvedShare;
      reports.push({
        source: source.id,
        bandId: key,
        label: bandLabel(band),
        energy,
        samples: bandPlan.credited.length,
        probes: bandPlan.probes,
        mergedLines: bandPlan.mergedLines,
        representative: bandPlan.representative,
        mergedInto: bandPlan.mergedInto,
        maxGap: bandPlan.maxGap,
        positionUncertainty: bandPlan.positionUncertainty,
        energyUncertainty: unresolvedEnergy,
        unresolved: unresolvedEnergy > Math.max(1e-9, energy * 0.02),
      });
      mergedLines += bandPlan.mergedLines;
      maxGap = Math.max(maxGap, bandPlan.maxGap);
      positionWeighted += bandPlan.positionUncertainty * bandPlan.energyShare;
      positionWeight += bandPlan.energyShare;
    }

    // Energy credited to a traced geometry, split across the bands it covers.
    for (const sample of plan.credited) {
      const covers = sample.covers
        .map((id) => plan.bands.find((candidate) => candidate.band.id === id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);
      const coverWeight = covers.reduce(
        (sum, candidate) => sum + Math.max(0, candidate.band.weight),
        0,
      );
      if (!covers.length || coverWeight <= 0 || sample.fraction <= 0) continue;
      for (const candidate of covers) {
        // sample.fraction is already a share of the source's power; split it
        // among the bands that share this traced geometry by their weights.
        const power =
          (source.power * sample.fraction) *
          (Math.max(0, candidate.band.weight) / coverWeight);
        creditedRays.push({
          source: source.id,
          bandId: bandKey(source.id, candidate.band.id),
          sample,
          power,
        });
      }
    }
  }

  for (const credited of creditedRays) {
    const rays = credited.sample.sample.paths;
    if (!rays.length) continue;
    const perRay = credited.power / rays.length;
    if (perRay <= 0) continue;
    const wavelength = credited.sample.sample.wavelength;
    for (const ray of rays) {
      if (ray.truncated) truncated++;
      for (const segment of ray.segments)
        segments.push({
          from: segment.from,
          to: segment.to,
          power: perRay * segment.factor,
          wavelength,
          source: credited.source,
          bandId: credited.bandId,
        });
      if (ray.hit) {
        hits.push({
          screen: ray.hit.screen,
          position: ray.hit.position,
          power: perRay,
          wavelength,
          source: credited.source,
          bandId: credited.bandId,
        });
        receivedEnergy += perRay;
      }
    }
  }

  const creditedWavelengths = new Set(
    creditedRays.map((entry) =>
      `${entry.source}@${entry.sample.sample.wavelength.toFixed(4)}`,
    ),
  );
  const probes = probeCount;

  const samplingKey = JSON.stringify(
    reports.map((report) => [
      report.bandId,
      report.samples,
      report.representative,
    ]),
  );
  return {
    analysisId: analysisId(doc, quality, samplingKey),
    spectrumId: spectrumId(doc),
    layoutId: layoutId(doc),
    quality,
    segments,
    hits,
    bands,
    truncated,
    sampling: {
      quality,
      spectralSamples: creditedWavelengths.size,
      probes,
      rayCount: cache.rayCount,
      mergedLines,
      maxGap,
      energyUncertainty: reports.reduce(
        (sum, report) => sum + report.energyUncertainty,
        0,
      ),
      positionUncertainty: positionWeight
        ? positionWeighted / positionWeight
        : 0,
      budgetLimited,
      bands: reports,
      emittedEnergy,
      receivedEnergy,
    },
  };
}
