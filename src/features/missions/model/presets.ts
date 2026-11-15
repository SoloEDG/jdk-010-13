import type { Element, LabDocument, SpectrumBand } from "../../../shared/document";
import { continuousBand, lineBand, makeSpectrum } from "../../optics/lib/spectrum";

const e = (
  id: string,
  kind: Element["kind"],
  x: number,
  y: number,
  patch: Partial<Element> = {},
): Element => ({
  id,
  kind,
  x,
  y,
  angle: kind === "source" ? 0 : 90,
  size: 180,
  power: 1,
  rays: 9,
  spread: 0,
  wavelength: 550,
  focal: 180,
  index: 1.52,
  ...patch,
});

const mono = (wavelength = 550): Element["spectrum"] =>
  makeSpectrum("mono", [lineBand(wavelength)]);

const lines = (values: number[]): Element["spectrum"] =>
  makeSpectrum(
    "lines",
    values.map((wavelength) => lineBand(wavelength, 1)),
  );

const spectrum = (from: number, to: number): Element["spectrum"] =>
  makeSpectrum("continuous", [continuousBand(from, to, 1)]);

export interface MissionRequirement {
  /** A band selector used by the mission; resolved against the live result. */
  bandIndex: number;
  /** Whether this band's energy must be received by the named screen. */
  screen: string | null;
  /** Minimum received share of this band's emitted energy. */
  minShare: number;
  /** Where the band's centroid must land on the screen, in mm. */
  region?: { from: number; to: number };
  /** Longest acceptable unsampled spectral gap for a continuum, in nm. */
  maxGap?: number;
}

export interface Mission {
  id: string;
  /** Overall spot RMS radius limit, in mm (legacy monochromatic criteria). */
  maxRms?: number;
  /** Mission additionally requires a prism in the scene. */
  requirePrism?: boolean;
  /** Minimum distance between the first two bands' centroids, in mm. */
  minSeparation?: number;
  name: string;
  tag: string;
  description: string;
  condition: string;
  requirements: MissionRequirement[];
  doc: LabDocument;
}

export const missions: Mission[] = [
  {
    id: "focus",
    name: "寻找焦点",
    tag: "透镜成像",
    description: "移动接收屏，使平行光经凸透镜后汇聚成一个清晰光斑。",
    condition: "接收 ≥ 80% 光能，RMS 半径 ≤ 3 mm",
    maxRms: 3,
    requirements: [{ bandIndex: 0, screen: null, minShare: 0.8 }],
    doc: {
      version: 2,
      items: [
        e("source", "source", 140, 300, {
          size: 120,
          wavelength: 550,
          spectrum: mono(550),
        }),
        e("lens", "lens", 450, 300, { size: 240 }),
        e("screen", "screen", 790, 300, { size: 230 }),
      ],
    },
  },
  {
    id: "reflection",
    name: "转折的光",
    tag: "镜面反射",
    description: "调整镜面方向，把光束转向上方的接收屏。",
    condition: "接收屏捕获 ≥ 80% 光源能量",
    requirements: [{ bandIndex: 0, screen: null, minShare: 0.8 }],
    doc: {
      version: 2,
      items: [
        e("source", "source", 150, 370, {
          size: 60,
          wavelength: 550,
          spectrum: mono(550),
        }),
        e("mirror", "mirror", 500, 370, { angle: -35 }),
        e("screen", "screen", 500, 100, { angle: 0, size: 200 }),
      ],
    },
  },
  {
    id: "refraction",
    name: "穿过玻璃",
    tag: "棱镜折射",
    description: "移动接收屏，捕获穿过三棱镜的折射光束。",
    condition: "经过棱镜后，接收 ≥ 60% 光源能量",
    requirePrism: true,
    requirements: [{ bandIndex: 0, screen: null, minShare: 0.6 }],
    doc: {
      version: 2,
      items: [
        e("source", "source", 130, 280, {
          size: 45,
          wavelength: 550,
          spectrum: mono(550),
        }),
        e("prism", "prism", 490, 300, { angle: -90, size: 170 }),
        e("screen", "screen", 800, 300, { size: 200 }),
      ],
    },
  },
  {
    id: "dispersion",
    name: "分开两色",
    tag: "色散分光",
    description:
      "调节三棱镜与接收屏，让蓝紫与红两个波段分别落在接收屏的不同区域。",
    condition: "两个波段各自接收 ≥ 85%，落在屏的左右两半且相距 ≥ 40 mm",
    minSeparation: 40,
    requirements: [
      {
        bandIndex: 0,
        screen: null,
        minShare: 0.85,
        region: { from: -100, to: -10 },
      },
      {
        bandIndex: 1,
        screen: null,
        minShare: 0.85,
        region: { from: 10, to: 100 },
      },
    ],
    doc: {
      version: 2,
      items: [
        e("source", "source", 120, 300, {
          size: 9,
          spectrum: lines([450, 650]),
        }),
        e("prism", "prism", 600, 340, { angle: 30, size: 160 }),
        // Start far enough out that only the red band lands on the screen, so
        // the learner has to move the screen and see the two spots separate.
        e("screen", "screen", 770, 400, { angle: 0, size: 200 }),
      ],
    },
  },
  {
    id: "spectrum",
    name: "连续光谱",
    tag: "连续色散",
    description: "把连续光谱光源投到接收屏，观察色带并测量各波段能量。",
    condition: "连续谱接收 ≥ 65%，且每个 40 nm 子波段都被采到",
    requirements: [
      {
        bandIndex: 0,
        screen: null,
        minShare: 0.65,
        // 40 nm sub-bands are only meaningful if the sampler actually covered
        // the continuum at least that finely.
        maxGap: 40,
      },
    ],
    doc: {
      version: 2,
      items: [
        e("source", "source", 120, 300, {
          size: 12,
          spectrum: spectrum(430, 680),
        }),
        e("prism", "prism", 600, 340, { angle: 30, size: 160 }),
        e("screen", "screen", 880, 440, { angle: 0, size: 220 }),
      ],
    },
  },
];

export const initialDocument = missions[0].doc;

/** Seed spectra are clones so editing a mission never mutates the preset. */
export function missionDocument(id: string): LabDocument {
  const mission = missions.find((entry) => entry.id === id)!;
  return structuredClone(mission.doc);
}

export function bandsOf(doc: LabDocument): SpectrumBand[] {
  return doc.items
    .filter((element) => element.kind === "source")
    .flatMap((element) =>
      element.spectrum ? element.spectrum.bands : [],
    );
}
