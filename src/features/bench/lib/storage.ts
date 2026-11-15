import type { LabDocument } from "../../../shared/document";
import { isSpectrumValid, normalizeDocument } from "../../optics/lib/spectrum";

const KEY = "lumen-document";
const KIND = ["source", "mirror", "lens", "prism", "screen"];
const NUMBERS = [
  "x",
  "y",
  "angle",
  "size",
  "power",
  "rays",
  "spread",
  "wavelength",
  "focal",
  "index",
];

export function saveDocument(doc: LabDocument) {
  localStorage.setItem(KEY, JSON.stringify(normalizeDocument(doc)));
  localStorage.setItem(
    "lumen-document-meta",
    JSON.stringify({ savedAt: Date.now(), version: doc.version }),
  );
}

/**
 * Loads either a legacy version-1 document (one wavelength per source) or a
 * version-2 document with spectra. Legacy sources are upgraded to a single
 * spectral line with the same wavelength and power, so an old experiment is
 * restored bit-for-bit in energy terms.
 */
export function loadDocument(): LabDocument | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || !Array.isArray(raw.items) || raw.items.length > 80) return null;
    if (raw.version !== 1 && raw.version !== 2) return null;
    for (const element of raw.items) {
      if (!KIND.includes(element.kind) || typeof element.id !== "string")
        return null;
      for (const key of NUMBERS)
        if (!Number.isFinite(element[key])) return null;
      if (
        element.rays < 1 ||
        element.rays > 41 ||
        element.size <= 0 ||
        element.focal === 0 ||
        element.index < 1
      )
        return null;
      if (
        element.kind === "source" &&
        raw.version === 2 &&
        element.spectrum !== undefined &&
        !isSpectrumValid(element.spectrum)
      )
        return null;
    }
    return normalizeDocument(raw as LabDocument);
  } catch {
    return null;
  }
}
