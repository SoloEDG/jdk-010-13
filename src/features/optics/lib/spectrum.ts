import type {
  ContinuousBand,
  Element,
  LabDocument,
  LineBand,
  Spectrum,
  SpectrumBand,
  SpectrumMode,
} from "../../../shared/document";

export const VISIBLE_MIN = 380;
export const VISIBLE_MAX = 750;
/**
 * Bands are capped for sanity, not for performance: sampling density is
 * bounded separately by the analysis budget, and dense line spectra are
 * merged at trace time.
 */
export const MAX_BANDS = 64;

export function lineBand(wavelength: number, weight = 1, width = 2): LineBand {
  return { id: "", kind: "line", wavelength, width, weight };
}

export function continuousBand(
  from: number,
  to: number,
  weight = 1,
): ContinuousBand {
  return { id: "", kind: "continuous", from, to, weight };
}

const clamp = (value: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, value));

function sanitize(band: SpectrumBand): SpectrumBand | null {
  if (!Number.isFinite(band.weight) || band.weight <= 0) return null;
  if (band.kind === "line") {
    if (!Number.isFinite(band.wavelength)) return null;
    return {
      ...band,
      wavelength: clamp(band.wavelength, VISIBLE_MIN, VISIBLE_MAX),
      width: Number.isFinite(band.width) ? clamp(band.width, 0, 200) : 2,
    };
  }
  if (!Number.isFinite(band.from) || !Number.isFinite(band.to)) return null;
  let from = clamp(Math.min(band.from, band.to), VISIBLE_MIN, VISIBLE_MAX);
  let to = clamp(Math.max(band.from, band.to), VISIBLE_MIN, VISIBLE_MAX);
  if (to - from < 1) {
    const mid = (from + to) / 2;
    from = clamp(mid - 0.5, VISIBLE_MIN, VISIBLE_MAX);
    to = clamp(mid + 0.5, VISIBLE_MIN, VISIBLE_MAX);
  }
  return { ...band, from, to };
}

/** Stable order-based ids keep document diffs and analysis hashes readable. */
export function withBandIds(bands: SpectrumBand[]): SpectrumBand[] {
  return bands.map((band, index) => ({ ...band, id: `${band.kind}-${index}` }));
}

export function makeSpectrum(
  mode: SpectrumMode,
  bands: SpectrumBand[],
): Spectrum {
  const wanted = mode === "continuous" ? "continuous" : "line";
  const clean = bands
    .filter((band) => band.kind === wanted)
    .map(sanitize)
    .filter((band): band is SpectrumBand => band !== null)
    .slice(0, MAX_BANDS);
  if (!clean.length)
    clean.push(
      mode === "continuous" ? continuousBand(430, 650, 1) : lineBand(550, 1),
    );
  if (mode === "mono") clean.splice(1);
  return { mode, bands: withBandIds(clean) };
}

/**
 * Switches editor mode without changing total power. Every old band keeps its
 * weight; only its shape is approximated, which keeps "energy in = energy out".
 */
export function convertSpectrum(
  spectrum: Spectrum,
  mode: SpectrumMode,
): Spectrum {
  const bands = spectrum.bands.length
    ? spectrum.bands
    : [lineBand(550), continuousBand(430, 650)];
  if (mode === "continuous") {
    return makeSpectrum(
      mode,
      bands.map((band) =>
        band.kind === "continuous"
          ? { ...band, from: Math.min(band.from, band.to), to: Math.max(band.from, band.to) }
          : continuousBand(
              clamp(band.wavelength - Math.max(4, band.width) / 2, VISIBLE_MIN, VISIBLE_MAX),
              clamp(band.wavelength + Math.max(4, band.width) / 2, VISIBLE_MIN, VISIBLE_MAX),
              band.weight,
            ),
      ),
    );
  }
  const lines = bands.map((band) =>
    band.kind === "line"
      ? band
      : lineBand(
          clamp((band.from + band.to) / 2, VISIBLE_MIN, VISIBLE_MAX),
          band.weight,
          clamp(Math.abs(band.to - band.from), 1, 40),
        ),
  );
  if (mode === "mono") {
    const strongest = lines.reduce((best, band) =>
      band.weight > best.weight ? band : best,
    );
    return makeSpectrum("mono", [{ ...strongest, weight: 1 }]);
  }
  return makeSpectrum("lines", lines);
}

/** The spectrum a source actually emits. Legacy sources become one line. */
export function spectrumOf(source: Element): Spectrum {
  const stored = source.spectrum;
  if (stored && Array.isArray(stored.bands) && stored.bands.length) {
    const mode: SpectrumMode =
      stored.mode === "continuous" || stored.mode === "lines"
        ? stored.mode
        : "mono";
    const wanted = mode === "continuous" ? "continuous" : "line";
    const bands = stored.bands
      .filter((band) => band.kind === wanted)
      .map(sanitize)
      .filter((band): band is SpectrumBand => band !== null);
    if (bands.length)
      return makeSpectrum(mode, mode === "mono" ? bands.slice(0, 1) : bands);
  }
  return makeSpectrum("mono", [lineBand(source.wavelength)]);
}

export function isSpectrumValid(value: unknown): value is Spectrum {
  if (!value || typeof value !== "object") return false;
  const spectrum = value as Spectrum;
  if (!["mono", "lines", "continuous"].includes(spectrum.mode)) return false;
  if (
    !Array.isArray(spectrum.bands) ||
    !spectrum.bands.length ||
    spectrum.bands.length > MAX_BANDS
  )
    return false;
  const wanted = spectrum.mode === "continuous" ? "continuous" : "line";
  if (spectrum.mode === "mono" && spectrum.bands.length !== 1) return false;
  return spectrum.bands.every(
    (band) =>
      band.kind === wanted &&
      sanitize(band) !== null &&
      band.id === `${band.kind}-${spectrum.bands.indexOf(band)}`,
  );
}

/**
 * Mirrors a single-line spectrum into the legacy `wavelength` field so old
 * code, saved version-1 readers and the "主波长" slider all agree. Multi-band
 * sources leave it alone, since no single wavelength describes them.
 */
export function syncLegacyWavelength(source: Element): Element {
  const spectrum = spectrumOf(source);
  if (spectrum.mode !== "mono") return source;
  const first = spectrum.bands[0];
  if (first.kind !== "line" || first.wavelength === source.wavelength)
    return source;
  return { ...source, wavelength: first.wavelength };
}

export function totalWeight(bands: SpectrumBand[]) {
  return bands.reduce((sum, band) => sum + Math.max(0, band.weight), 0);
}

export function bandRange(band: SpectrumBand): [number, number] {
  return band.kind === "line"
    ? [band.wavelength, band.wavelength]
    : [Math.min(band.from, band.to), Math.max(band.from, band.to)];
}

export function bandLabel(band: SpectrumBand) {
  if (band.kind === "line") return `${Math.round(band.wavelength)} nm 谱线`;
  return `${Math.round(Math.min(band.from, band.to))}–${Math.round(Math.max(band.from, band.to))} nm`;
}

/**
 * Band energy is always a share of the source's power. Adding bands or
 * samples only subdivides that fixed total; it can never add watts.
 */
export function bandEnergy(
  source: Element,
  band: SpectrumBand,
  bands: SpectrumBand[] = spectrumOf(source).bands,
) {
  const total = totalWeight(bands);
  return total > 0 ? (source.power * Math.max(0, band.weight)) / total : 0;
}

export function spectrumSummary(source: Element) {
  const spectrum = spectrumOf(source);
  if (spectrum.mode === "mono") {
    const first = spectrum.bands[0];
    return `${Math.round(bandRange(first)[0])} nm 单色`;
  }
  const count = spectrum.bands.length;
  return `${spectrum.mode === "lines" ? "离散谱线" : "连续光谱"} · ${count} 段`;
}

/**
 * Version-1 documents have one wavelength per source. Upgrading gives each
 * source exactly one spectral line with the same wavelength and the original
 * power, so old experiments reproduce identically.
 */
export function normalizeDocument(doc: LabDocument): LabDocument {
  return {
    version: 2,
    items: doc.items.map((element) => {
      if (element.kind !== "source") {
        const { spectrum: _unused, ...rest } = element;
        return rest;
      }
      const spectrum = spectrumOf(element);
      return {
        ...element,
        wavelength: spectrum.bands[0].kind === "line"
          ? spectrum.bands[0].wavelength
          : element.wavelength,
        spectrum,
      };
    }),
  };
}
