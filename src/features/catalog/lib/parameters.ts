import type { Element } from "../../../shared/document";
import { spectrumOf } from "../../optics/lib/spectrum";

export type NumericKey =
  | "angle"
  | "size"
  | "power"
  | "rays"
  | "spread"
  | "wavelength"
  | "focal"
  | "index";

export interface Parameter {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export function parameters(element: Element): Parameter[] {
  const common: Parameter[] = [
    {
      key: "angle",
      label: "旋转角度",
      min: -180,
      max: 180,
      step: 1,
      unit: "°",
    },
    {
      key: "size",
      label: element.kind === "source" ? "光束宽度" : "器件口径",
      min: 10,
      max: 300,
      step: 1,
      unit: "mm",
    },
  ];
  if (element.kind === "source") {
    // The wavelength slider and spectrum editor write the same value: editing
    // the slider updates band 1 of the spectrum, and a single-line spectrum
    // writes its wavelength back here, so a monochromatic source behaves like
    // the original single-wavelength control. A continuous source has no one
    // "main wavelength", so the slider is replaced by the spectrum editor.
    if (spectrumOf(element).mode !== "continuous")
      common.push({
        key: "wavelength",
        label: "主波长",
        min: 380,
        max: 750,
        step: 1,
        unit: "nm",
      });
    common.push(
      { key: "rays", label: "采样光线", min: 3, max: 41, step: 2, unit: "条" },
      { key: "spread", label: "发散角", min: 0, max: 60, step: 1, unit: "°" },
      {
        key: "power",
        label: "光源功率",
        min: 0.1,
        max: 3,
        step: 0.1,
        unit: "W",
      },
    );
  }
  if (element.kind === "lens")
    common.push({
      key: "focal",
      label: "焦距",
      min: -300,
      max: 400,
      step: 10,
      unit: "mm",
    });
  if (element.kind === "prism")
    common.push({
      key: "index",
      label: "折射率 nD",
      min: 1.1,
      max: 2,
      step: 0.01,
      unit: "",
    });
  return common;
}
