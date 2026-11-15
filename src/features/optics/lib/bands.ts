import type { TraceResult } from "../../../shared/document";

/** All bands present in a result, with the source and label to show. */
export function selectableBands(result: TraceResult) {
  return result.bands.map((band) => ({
    id: band.bandId,
    source: band.source,
    label: band.label,
    energy: band.energy,
  }));
}
