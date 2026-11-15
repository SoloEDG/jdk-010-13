export type Kind = "source" | "mirror" | "lens" | "prism" | "screen";
export interface Point {
  x: number;
  y: number;
}
/** A named, editable stretch of a source spectrum. */
export interface LineBand {
  id: string;
  kind: "line";
  /** Centre wavelength in nm. A line is unresolved, so width is cosmetic. */
  wavelength: number;
  width: number;
  /** Relative energy of this band. Bands are normalised to the source power. */
  weight: number;
}
export interface ContinuousBand {
  id: string;
  kind: "continuous";
  from: number;
  to: number;
  /** Relative energy of this band. Bands are normalised to the source power. */
  weight: number;
}
export type SpectrumBand = LineBand | ContinuousBand;
export type SpectrumMode = "mono" | "lines" | "continuous";
export interface Spectrum {
  mode: SpectrumMode;
  bands: SpectrumBand[];
}
export interface Element extends Point {
  id: string;
  kind: Kind;
  angle: number;
  size: number;
  power: number;
  rays: number;
  spread: number;
  /**
   * Legacy monochromatic wavelength. Kept on every element so documents made
   * before spectra existed still load. For sources the spectrum (when present)
   * is authoritative.
   */
  wavelength: number;
  focal: number;
  index: number;
  /** Optional so version-1 documents remain loadable. */
  spectrum?: Spectrum;
}
export type DocumentVersion = 1 | 2;
export interface LabDocument {
  version: DocumentVersion;
  items: Element[];
}
export interface Segment {
  from: Point;
  to: Point;
  power: number;
  wavelength: number;
  source: string;
  bandId: string;
}
export interface ScreenHit {
  screen: string;
  position: number;
  power: number;
  wavelength: number;
  source: string;
  bandId: string;
}
export type AnalysisQuality = "preview" | "stable";

/** A band as traced. Line groups share one representative wavelength. */
export interface TraceBand {
  source: string;
  bandId: string;
  label: string;
  kind: "line" | "continuous";
  weight: number;
  /** This band's own share of the source power, in W. */
  energy: number;
  /** Representative wavelength for a line, band midpoint for a continuum. */
  wavelength: number;
  from: number;
  to: number;
}
export interface BandSamplingReport {
  source: string;
  bandId: string;
  label: string;
  /** This band's own emitted energy, in W. */
  energy: number;
  /** Credited spectral samples carrying this band's energy. */
  samples: number;
  /** Zero-energy verification traces used to bound the error. */
  probes: number;
  /** Lines folded into a representative wavelength that was not their own. */
  mergedLines: number;
  /** The wavelength actually traced as this band's representative. */
  representative: number;
  /** For merged lines, the band whose representative carried their energy. */
  mergedInto?: string;
  /** Longest unsampled wavelength gap in nm (0 for lines). */
  maxGap: number;
  /** Energy-weighted position uncertainty of the band's spot, in mm. */
  positionUncertainty: number;
  /** Energy whose screen assignment or position is not established, in W. */
  energyUncertainty: number;
  /** True when energyUncertainty exceeds 2% of the band. */
  unresolved: boolean;
}
export interface SamplingReport {
  quality: AnalysisQuality;
  /** Distinct wavelengths that actually carry credited energy. */
  spectralSamples: number;
  /** Extra verification traces; they carry zero energy. */
  probes: number;
  /** Total traced rays, probes included. */
  rayCount: number;
  mergedLines: number;
  /** Longest unsampled wavelength gap left in a continuum, in nm. */
  maxGap: number;
  /** Energy whose screen or position is not established, in W. */
  energyUncertainty: number;
  /** Energy-weighted centroid uncertainty, in mm. */
  positionUncertainty: number;
  /** True when the ray or depth budget forced a coarser treatment. */
  budgetLimited: boolean;
  bands: BandSamplingReport[];
  /** Total emitted energy; independent of how many samples were taken. */
  emittedEnergy: number;
  /** Energy that reached a screen in this pass. */
  receivedEnergy: number;
}
export interface TraceResult {
  /** Deterministic id of the spectrum + layout + quality that produced this result. */
  analysisId: string;
  /** Hash of only the spectra, independent of layout. */
  spectrumId: string;
  /** Hash of only the device layout, independent of spectra. */
  layoutId: string;
  quality: AnalysisQuality;
  segments: Segment[];
  hits: ScreenHit[];
  bands: TraceBand[];
  truncated: number;
  sampling: SamplingReport;
}
export const labels: Record<Kind, string> = {
  source: "光源",
  mirror: "平面镜",
  lens: "凸透镜",
  prism: "三棱镜",
  screen: "接收屏",
};
