import { useMemo, useState } from "react";
import type { LabDocument, TraceResult } from "../../../shared/document";
import { measure } from "../lib/measurement";
import { selectableBands } from "../../optics/lib/bands";

/**
 * Detector selection is keyed by document id, not index, and the chosen band
 * filter is validated against the current result. Switching screens therefore
 * cannot silently keep a band id that the new analysis does not contain.
 */
export function useDetector(doc: LabDocument, result: TraceResult) {
  const [chosen, setChosen] = useState("");
  const [resolution, setResolution] = useState(64);
  const [bandFilter, setBandFilter] = useState<string>("");
  const screens = doc.items.filter((element) => element.kind === "screen");
  const screen =
    screens.find((element) => element.id === chosen) ?? screens[0];
  const bands = useMemo(() => selectableBands(result), [result]);
  const validFilter = bands.some((band) => band.id === bandFilter)
    ? bandFilter
    : "";
  const labels = useMemo(
    () =>
      new Map(
        result.sampling.bands.map((report) => [
          report.bandId,
          {
            label: report.label,
            energy: report.energy,
            maxGap: report.maxGap,
            positionUncertainty: report.positionUncertainty,
            energyUncertainty: report.energyUncertainty,
          },
        ]),
      ),
    [result],
  );
  return {
    screens,
    screen,
    setChosen,
    resolution,
    setResolution,
    bands,
    bandFilter: validFilter,
    setBandFilter,
    measurement: measure(
      screen,
      result.hits,
      resolution,
      validFilter ? [validFilter] : undefined,
      labels,
    ),
  };
}
