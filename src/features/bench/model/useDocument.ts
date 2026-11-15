import { useCallback, useState } from "react";
import type { LabDocument, Element } from "../../../shared/document";
import { patchDocument } from "../../../shared/commands";
import { loadDocument, saveDocument } from "../lib/storage";
import { normalizeDocument } from "../../optics/lib/spectrum";

export interface DocumentState {
  doc: LabDocument;
  selected: string | null;
  setSelected: (id: string | null) => void;
  saved: boolean;
  canUndo: boolean;
  canRedo: boolean;
  replace: (next: LabDocument) => void;
  update: (id: string, patch: Partial<Element>) => void;
  remove: (id: string) => void;
  save: () => void;
  undo: () => void;
  redo: () => void;
}

/**
 * Document history plus a transient "preview layout" used while dragging.
 *
 * A drag never enters the undo stack: the committed state changes only on
 * release, so undo always returns to a layout that had a settled analysis.
 * The preview layout is returned separately and never saved.
 */
export function useDocument(initial: LabDocument) {
  const [doc, setDoc] = useState<LabDocument>(
    () => loadDocument() ?? normalizeDocument(initial),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [past, setPast] = useState<LabDocument[]>([]);
  const [future, setFuture] = useState<LabDocument[]>([]);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<LabDocument | null>(null);

  const replace = useCallback((next: LabDocument) => {
    setPast((previous) => [...previous.slice(-49), doc]);
    setFuture([]);
    setDoc(next);
    setSaved(false);
    setPreview(null);
  }, [doc]);

  const update = useCallback(
    (id: string, patch: Partial<Element>) => replace(patchDocument(doc, id, patch)),
    [doc, replace],
  );

  return {
    doc,
    selected,
    setSelected,
    saved,
    replace,
    update,
    /** Live geometry while a pointer drag is in flight. */
    preview,
    setPreview,
    remove: (id: string) => {
      replace({ ...doc, items: doc.items.filter((element) => element.id !== id) });
      setSelected(null);
    },
    save: () => {
      saveDocument(doc);
      setSaved(true);
    },
    undo: () => {
      const previous = past.at(-1);
      if (!previous) return;
      setFuture((entries) => [doc, ...entries]);
      setDoc(previous);
      setPast((entries) => entries.slice(0, -1));
      setSaved(false);
      setPreview(null);
    },
    redo: () => {
      if (!future[0]) return;
      setPast((entries) => [...entries, doc]);
      setDoc(future[0]);
      setFuture((entries) => entries.slice(1));
      setSaved(false);
      setPreview(null);
    },
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  } satisfies DocumentState & {
    preview: LabDocument | null;
    setPreview: (doc: LabDocument | null) => void;
  };
}
