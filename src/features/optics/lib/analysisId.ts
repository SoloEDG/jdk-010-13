import type { LabDocument, Spectrum } from "../../../shared/document";
import { spectrumOf } from "./spectrum";

const round = (value: number) => {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
};

function spectrumShape(sourceId: string, spectrum: Spectrum) {
  return {
    source: sourceId,
    mode: spectrum.mode,
    bands: spectrum.bands.map((band) =>
      band.kind === "line"
        ? {
            kind: band.kind,
            id: band.id,
            wavelength: round(band.wavelength),
            width: round(band.width),
            weight: round(band.weight),
          }
        : {
            kind: band.kind,
            id: band.id,
            from: round(Math.min(band.from, band.to)),
            to: round(Math.max(band.from, band.to)),
            weight: round(band.weight),
          },
    ),
  };
}

/** Hash of every source's spectrum, independent of where devices sit. */
export function spectrumId(doc: LabDocument) {
  return hash(
    JSON.stringify(
      doc.items
        .filter((element) => element.kind === "source")
        .map((element) => spectrumShape(element.id, spectrumOf(element))),
    ),
  );
}

/** Hash of device geometry and non-spectral parameters only. */
export function layoutId(doc: LabDocument) {
  return hash(
    JSON.stringify(
      doc.items.map((element) => ({
        id: element.id,
        kind: element.kind,
        x: round(element.x),
        y: round(element.y),
        angle: round(element.angle),
        size: round(element.size),
        power: round(element.power),
        rays: element.rays,
        spread: round(element.spread),
        focal: round(element.focal),
        index: round(element.index),
      })),
    ),
  );
}

/** One id ties a curve, a mission judgement and a saved document together. */
export function analysisId(
  doc: LabDocument,
  quality: string,
  samplingKey: string,
) {
  return `${quality}:${hash(
    JSON.stringify([
      spectrumId(doc),
      layoutId(doc),
      quality,
      samplingKey,
    ]),
  )}`;
}

function hash(text: string) {
  let a = 0x811c9dc5;
  let b = 0x9e3779b1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
