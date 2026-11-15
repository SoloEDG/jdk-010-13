import type { LabDocument, TraceResult } from "../../../shared/document";
import type { Mission } from "../model/presets";

export interface BandVerdict {
  bandId: string;
  label: string;
  /** Share of this band's emitted energy received by a screen. */
  share: number;
  /** Received energy, in W. */
  energy: number;
  /** Energy-weighted centroid on its brightest screen, in mm. */
  centroid: number;
  screen: string | null;
  /** Emitted energy whose screen assignment is uncertain, in W. */
  uncertainty: number;
  passed: boolean;
  reason: string;
  /** Longest unsampled spectral gap inside this band, in nm. */
  maxGap: number;
}

export interface Evaluation {
  complete: boolean;
  /** Total received / total emitted across all bands. */
  ratio: number;
  rms: number;
  progress: number;
  bands: BandVerdict[];
  /** Why the mission is not complete, in the user's terms. */
  blockers: string[];
  /** Analysis this verdict belongs to. */
  analysisId: string;
  /** True while the underlying result is a coarse drag preview. */
  provisional: boolean;
}

/**
 * Judges a mission from the *same* trace result the chart displays. Every
 * verdict carries the analysis id, so a completed mission can be traced back
 * to the exact spectrum, layout and sampling quality that produced it.
 */
export function evaluateMission(
  mission: Mission,
  doc: LabDocument,
  result: TraceResult,
): Evaluation {
  const emitted = result.sampling.emittedEnergy;
  const received = result.hits.reduce((sum, hit) => sum + hit.power, 0);
  const ratio = emitted ? received / emitted : 0;
  const center = received
    ? result.hits.reduce((sum, hit) => sum + hit.position * hit.power, 0) /
      received
    : 0;
  const rms = received
    ? Math.sqrt(
        result.hits.reduce(
          (sum, hit) => sum + (hit.position - center) ** 2 * hit.power,
          0,
        ) / received,
      )
    : Infinity;

  const bands = result.sampling.bands;
  const labelsByBand = new Map(
    result.bands.map((band) => [band.bandId, band.label]),
  );
  const blockers: string[] = [];

  const verdicts: BandVerdict[] = mission.requirements.map((requirement) => {
    const report = bands[requirement.bandIndex];
    if (!report) {
      blockers.push("光源缺少任务要求的波段");
      return {
        bandId: "",
        label: "",
        share: 0,
        energy: 0,
        centroid: 0,
        screen: null,
        uncertainty: 0,
        passed: false,
        reason: "缺少该波段",
        maxGap: 0,
      };
    }
    const hits = result.hits.filter((hit) => hit.bandId === report.bandId);
    const energy = hits.reduce((sum, hit) => sum + hit.power, 0);
    const share = report.energy ? energy / report.energy : 0;
    const byScreen = new Map<string, number>();
    for (const hit of hits)
      byScreen.set(hit.screen, (byScreen.get(hit.screen) ?? 0) + hit.power);
    const brightest = [...byScreen.entries()].sort((a, b) => b[1] - a[1])[0];
    const screenId = requirement.screen ?? brightest?.[0] ?? null;
    const onScreen = hits.filter((hit) => hit.screen === screenId);
    const screenEnergy = onScreen.reduce((sum, hit) => sum + hit.power, 0);
    const centroid = screenEnergy
      ? onScreen.reduce((sum, hit) => sum + hit.position * hit.power, 0) /
        screenEnergy
      : 0;
    const label = labelsByBand.get(report.bandId) ?? report.label;
    let passed = true;
    let reason = "达标";
    if (share < requirement.minShare) {
      passed = false;
      reason = `接收 ${(share * 100).toFixed(0)}% < ${(requirement.minShare * 100).toFixed(0)}%`;
      blockers.push(`${label}：${reason}`);
    } else if (
      requirement.region &&
      (centroid < requirement.region.from || centroid > requirement.region.to)
    ) {
      passed = false;
      reason = `光斑中心 ${centroid.toFixed(1)} mm 不在 ${requirement.region.from}–${requirement.region.to} mm`;
      blockers.push(`${label}：${reason}`);
    } else if (requirement.maxGap && report.maxGap > requirement.maxGap) {
      passed = false;
      reason = `采样间隔 ${report.maxGap.toFixed(0)} nm > ${requirement.maxGap} nm`;
      blockers.push(`${label}：${reason}`);
    }
    return {
      bandId: report.bandId,
      label,
      share,
      energy,
      centroid,
      screen: screenId,
      uncertainty: report.energyUncertainty,
      passed,
      reason,
      maxGap: report.maxGap,
    };
  });

  // Two bands on one screen must actually be separated, not just each inside a
  // broad region: this check is what distinguishes real dispersion from a blur.
  const minimumSeparation = mission.minSeparation ?? 8;
  if (mission.requirements.length > 1) {
    const onSameScreen = verdicts.filter(
      (verdict) => verdict.energy > 0 && verdict.screen,
    );
    for (let i = 0; i < onSameScreen.length; i++)
      for (let j = i + 1; j < onSameScreen.length; j++) {
        const a = onSameScreen[i];
        const b = onSameScreen[j];
        if (a.screen !== b.screen) continue;
        const gap = Math.abs(a.centroid - b.centroid);
        if (gap < minimumSeparation) {
          a.passed = false;
          b.passed = false;
          blockers.push(
            `两波段中心仅相距 ${gap.toFixed(1)} mm，需 ≥ ${minimumSeparation} mm`,
          );
        }
      }
  }

  // Legacy scene-level criteria still apply: a focused spot must actually be
  // small, and a prism mission must actually use a prism.
  let sceneComplete = true;
  if (mission.maxRms !== undefined && rms > mission.maxRms) {
    sceneComplete = false;
    blockers.push(
      `光斑 RMS 半径 ${Number.isFinite(rms) ? rms.toFixed(1) : "—"} mm 需 ≤ ${mission.maxRms} mm`,
    );
  }
  if (mission.requirePrism && !doc.items.some((element) => element.kind === "prism")) {
    sceneComplete = false;
    blockers.push("需要让光穿过三棱镜");
  }

  const complete = sceneComplete && verdicts.every((verdict) => verdict.passed);
  const bandProgress =
    verdicts.length === 0
      ? 0
      : verdicts.reduce((sum, verdict) => {
          const share = Math.min(
            1,
            verdict.share /
              Math.max(
                1e-9,
                Math.max(...mission.requirements.map((r) => r.minShare)),
              ),
          );
          return sum + (verdict.passed ? 1 : share);
        }, 0) / verdicts.length;
  const rmsProgress =
    mission.maxRms === undefined
      ? 1
      : Math.min(1, mission.maxRms / Math.max(mission.maxRms, rms));
  const progress = Math.min(bandProgress, Number.isFinite(rms) ? rmsProgress : 0);

  return {
    complete,
    ratio,
    rms,
    progress: Math.max(0, progress),
    bands: verdicts,
    blockers,
    analysisId: result.analysisId,
    provisional: result.quality !== "stable",
  };
}
