import { useState } from "react";
import type { LabDocument, TraceResult } from "../../../shared/document";
import { missionDocument, missions } from "./presets";
import { evaluateMission } from "../lib/evaluate";

export function useMission(doc: LabDocument, result: TraceResult) {
  const [id, setId] = useState("focus");
  const mission = missions.find((entry) => entry.id === id) ?? missions[0];
  const evaluation = evaluateMission(mission, doc, result);
  return {
    mission,
    evaluation,
    missions,
    choose: (next: string) => {
      setId(next);
      return missionDocument(next);
    },
  };
}
