import { useEffect, useMemo, useRef, useState } from "react";
import type { LabDocument } from "../../../shared/document";
import { traceDocument } from "../lib/trace";

const PREVIEW_DEBOUNCE_MS = 60;

/**
 * Runs the analysis for the committed document at `stable` quality, and for a
 * drag preview at `preview` quality. The two results are returned separately:
 * the UI must be able to say which one a curve came from, because a preview is
 * deliberately coarser and its sampling error is larger.
 */
export function useOptics(doc: LabDocument, previewDoc: LabDocument | null) {
  const [visible, setVisible] = useState(true);
  const [normals, setNormals] = useState(false);
  const [livePreview, setLivePreview] = useState<LabDocument | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the preview so pointer moves stay responsive on dense spectra.
  useEffect(() => {
    if (!previewDoc) {
      setLivePreview(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLivePreview(previewDoc), PREVIEW_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [previewDoc]);

  const stable = useMemo(() => traceDocument(doc, "stable"), [doc]);
  const preview = useMemo(
    () => (livePreview ? traceDocument(livePreview, "preview") : null),
    [livePreview],
  );

  // The active result is the only one any consumer measures. `previewDoc` is
  // non-null for the whole drag (it is set on the first pointer move and
  // cleared on release), so use that to decide whether the active numbers are
  // provisional, even before the first debounced preview result exists.
  const result = preview ?? stable;
  return {
    result,
    stable,
    preview,
    quality: result.quality,
    dragging: previewDoc !== null,
    visible,
    setVisible,
    normals,
    setNormals,
  };
}
