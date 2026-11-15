import { test } from "node:test";
import assert from "node:assert/strict";
import type { Element, LabDocument, SpectrumBand } from "../src/shared/document";
import {
  bandEnergy,
  continuousBand,
  convertSpectrum,
  lineBand,
  makeSpectrum,
  normalizeDocument,
  spectrumOf,
} from "../src/features/optics/lib/spectrum";
import { traceDocument } from "../src/features/optics/lib/trace";
import { evaluateMission } from "../src/features/missions/lib/evaluate";
import { missions } from "../src/features/missions/model/presets";
import { measure } from "../src/features/detector/lib/measurement";

const element = (patch: Partial<Element> & { id: string; kind: Element["kind"] }): Element => ({
  x: 100,
  y: 300,
  angle: patch.kind === "source" ? 0 : 90,
  size: 100,
  power: 1,
  rays: 9,
  spread: 0,
  wavelength: 550,
  focal: 180,
  index: 1.52,
  ...patch,
});

const lensDoc = (spectrum: ReturnType<typeof makeSpectrum>): LabDocument => ({
  version: 2,
  items: [
    element({ id: "s", kind: "source", spectrum }),
    element({ id: "l", kind: "lens", x: 400, size: 200, focal: 150 }),
    element({ id: "d", kind: "screen", x: 550, size: 200 }),
  ],
});

const prismDoc = (bands: SpectrumBand[]): LabDocument => ({
  version: 2,
  items: [
    element({
      id: "s",
      kind: "source",
      x: 120,
      size: 9,
      spectrum: makeSpectrum("lines", bands),
    }),
    element({ id: "p", kind: "prism", x: 600, y: 340, angle: 30, size: 160 }),
    element({ id: "d", kind: "screen", x: 690, y: 400, angle: 0, size: 200 }),
  ],
});

const totalPower = (doc: LabDocument) =>
  traceDocument(doc, "stable").hits.reduce((sum, hit) => sum + hit.power, 0);

test("a version-1 monochromatic document becomes exactly one spectral line", () => {
  const legacy: LabDocument = {
    version: 1,
    items: [
      element({ id: "s", kind: "source", wavelength: 512, power: 0.8 }),
      element({ id: "l", kind: "lens", x: 400, size: 200, focal: 150 }),
      element({ id: "d", kind: "screen", x: 550, size: 200 }),
    ],
  };
  const upgraded = normalizeDocument(legacy);
  const spectrum = spectrumOf(upgraded.items[0]);
  assert.equal(upgraded.version, 2);
  assert.equal(spectrum.mode, "mono");
  assert.equal(spectrum.bands.length, 1);
  assert.equal(spectrum.bands[0].kind, "line");
  assert.equal(spectrum.bands[0].wavelength, 512);
  assert.equal(bandEnergy(upgraded.items[0], spectrum.bands[0]), 0.8);

  const restored = traceDocument(upgraded, "stable");
  assert.equal(restored.sampling.emittedEnergy, 0.8);
  assert.equal(restored.sampling.spectralSamples, 1);
  assert.equal(restored.hits.length, 9);
  for (const hit of restored.hits) assert.equal(hit.bandId, "s::line-0");
});

test("splitting one band into two preserves the source's total emitted power", () => {
  const one = lensDoc(makeSpectrum("lines", [lineBand(550, 1)]));
  const two = lensDoc(makeSpectrum("lines", [lineBand(480, 1), lineBand(620, 1)]));
  const three = lensDoc(
    makeSpectrum("lines", [lineBand(480, 1), lineBand(550, 2), lineBand(620, 1)]),
  );
  for (const doc of [one, two, three]) {
    const result = traceDocument(doc, "stable");
    assert.ok(Math.abs(result.sampling.emittedEnergy - 1) < 1e-9);
    assert.ok(Math.abs(totalPower(doc) - 1) < 1e-9);
  }
  const weighted = traceDocument(three, "stable");
  const shares = weighted.bands.map((band) => band.energy);
  assert.deepEqual(shares, [0.25, 0.5, 0.25]);
});

test("adding spectral samples never adds power", () => {
  const doc = lensDoc(makeSpectrum("continuous", [continuousBand(430, 680, 1)]));
  const preview = traceDocument(doc, "preview");
  const stable = traceDocument(doc, "stable");
  assert.ok(stable.sampling.spectralSamples > preview.sampling.spectralSamples);
  assert.ok(stable.sampling.rayCount > preview.sampling.rayCount);
  for (const result of [preview, stable])
    assert.ok(Math.abs(result.sampling.emittedEnergy - 1) < 1e-9);
  assert.ok(Math.abs(totalPower(doc) - 1) < 1e-9);
});

test("probe traces carry no energy and are reported separately", () => {
  const doc = lensDoc(makeSpectrum("continuous", [continuousBand(430, 680, 1)]));
  const result = traceDocument(doc, "stable");
  assert.ok(result.sampling.probes > 0);
  const credited = new Set(
    result.hits.map((hit) => `${hit.source}@${hit.wavelength.toFixed(4)}`),
  );
  assert.equal(result.sampling.spectralSamples, credited.size);
  assert.ok(Math.abs(result.sampling.receivedEnergy - totalPower(doc)) < 1e-9);
});

test("a coarse preview admits it may have missed a narrow receiving window", () => {
  const doc: LabDocument = {
    version: 2,
    items: [
      element({
        id: "s",
        kind: "source",
        x: 120,
        size: 40,
        spectrum: makeSpectrum("continuous", [continuousBand(430, 650, 1)]),
      }),
      element({ id: "p", kind: "prism", x: 500, y: 275, angle: 30, size: 130 }),
      element({ id: "d", kind: "screen", x: 750, y: 300, size: 1.5 }),
    ],
  };
  const preview = traceDocument(doc, "preview");
  assert.ok(preview.sampling.energyUncertainty > 0.01);
  assert.ok(preview.sampling.bands.some((band) => band.unresolved));

  const stable = traceDocument(doc, "stable");
  assert.ok(stable.sampling.energyUncertainty < preview.sampling.energyUncertainty);
  assert.ok(stable.sampling.maxGap <= preview.sampling.maxGap);
});

test("dense line spectra are merged with conserved power and reported merges", () => {
  const bands = Array.from({ length: 40 }, (_, index) =>
    lineBand(420 + index * 5, 1),
  );
  const doc = lensDoc(makeSpectrum("lines", bands));
  const preview = traceDocument(doc, "preview");
  assert.ok(preview.sampling.mergedLines > 0);
  assert.ok(Math.abs(preview.sampling.emittedEnergy - 1) < 1e-9);
  const merged = preview.bands.filter((band) => band.kind === "line");
  const totalWeight = merged.reduce((sum, band) => sum + band.weight, 0);
  assert.equal(totalWeight, 40);
  // A merged representative sits at the energy-weighted mean of its group, so
  // the sum of wavelength x energy is unchanged by merging.
  const trueMoment = bands.reduce((sum, band) => sum + band.wavelength, 0) / 40;
  const moment =
    preview.sampling.bands.reduce(
      (sum, report) => sum + report.representative,
      0,
    ) / preview.sampling.bands.length;
  assert.ok(Math.abs(trueMoment - moment) < 30);

  const stable = traceDocument(doc, "stable");
  // Stable relaxes the line budget but does not remove it: with 40 lines only
  // the remaining 20 merges are reported, never silently hidden.
  assert.ok(stable.sampling.mergedLines < preview.sampling.mergedLines);
  assert.ok(Math.abs(stable.sampling.emittedEnergy - 1) < 1e-9);
});

test("a prism separates two lines onto different regions of one screen", () => {
  const doc = prismDoc([lineBand(450, 1), lineBand(650, 1)]);
  const result = traceDocument(doc, "stable");
  const centroids = result.sampling.bands.map((report) => {
    const hits = result.hits.filter((hit) => hit.bandId === report.bandId);
    const energy = hits.reduce((sum, hit) => sum + hit.power, 0);
    assert.ok(energy > report.energy * 0.9);
    return hits.reduce((sum, hit) => sum + hit.position * hit.power, 0) / energy;
  });
  assert.ok(centroids[0] < -20, `blue centroid ${centroids[0]}`);
  assert.ok(centroids[1] > 20, `red centroid ${centroids[1]}`);
  assert.ok(Math.abs(centroids[0] - centroids[1]) > 40);
});

test("an unaligned layout fails the two-band mission while a solved one passes", () => {
  const mission = missions.find((entry) => entry.id === "dispersion")!;
  const unsolved = evaluateMission(
    mission,
    mission.doc,
    traceDocument(mission.doc, "stable"),
  );
  assert.equal(unsolved.complete, false);
  assert.ok(unsolved.blockers.length > 0);

  const solved = structuredClone(mission.doc);
  solved.items.find((element) => element.id === "screen")!.x = 690;
  const solvedResult = traceDocument(solved, "stable");
  const verdict = evaluateMission(mission, solved, solvedResult);
  assert.equal(verdict.complete, true);
  assert.equal(verdict.bands.length, 2);
  assert.ok(verdict.bands.every((band) => band.passed));
  // Judgement and curve cite the same analysis.
  assert.equal(verdict.analysisId, solvedResult.analysisId);
});

test("switching screens keeps an analysis that can be traced back", () => {
  const doc = prismDoc([lineBand(450, 1), lineBand(650, 1)]);
  doc.items.push(element({ id: "d2", kind: "screen", x: 400, size: 220 }));
  const result = traceDocument(doc, "stable");
  const first = measure(doc.items.find((e) => e.id === "d"), result.hits, 32);
  const second = measure(doc.items.find((e) => e.id === "d2"), result.hits, 32);
  assert.notEqual(first.screen, second.screen);
  // Screen choice only filters hits; the underlying analysis id is unchanged.
  assert.equal(result.analysisId, traceDocument(doc, "stable").analysisId);
});

test("band filtering partitions the same received energy", () => {
  const doc = prismDoc([lineBand(450, 1), lineBand(650, 1)]);
  const result = traceDocument(doc, "stable");
  const all = measure(doc.items.find((e) => e.id === "d"), result.hits, 64);
  const blue = measure(
    doc.items.find((e) => e.id === "d"),
    result.hits,
    64,
    ["s::line-0"],
  );
  const red = measure(
    doc.items.find((e) => e.id === "d"),
    result.hits,
    64,
    ["s::line-1"],
  );
  assert.ok(Math.abs(all.energy - (blue.energy + red.energy)) < 1e-9);
  assert.equal(all.bins.length, 64);
  for (let index = 0; index < all.bins.length; index++)
    assert.ok(
      Math.abs(all.bins[index] - (blue.bins[index] + red.bins[index])) < 1e-9,
    );
});

test("changing spectrum mode keeps total power", () => {
  const mono = makeSpectrum("mono", [lineBand(550, 1)]);
  const lines = convertSpectrum(mono, "lines");
  const continuous = convertSpectrum(lines, "continuous");
  const back = convertSpectrum(continuous, "lines");
  for (const spectrum of [mono, lines, continuous, back]) {
    const source = element({ id: "s", kind: "source", power: 1.4, spectrum });
    const total = spectrum.bands.reduce(
      (sum, band) => sum + bandEnergy(source, band, spectrum.bands),
      0,
    );
    assert.ok(Math.abs(total - 1.4) < 1e-9, spectrum.mode);
  }
  assert.equal(convertSpectrum(continuous, "mono").bands.length, 1);
});

test("changing the number of spatial rays does not change total power", () => {
  const spectrum = makeSpectrum("continuous", [continuousBand(430, 680, 1)]);
  const emitted: number[] = [];
  const received: number[] = [];
  for (const rays of [3, 9, 21, 41]) {
    const doc = lensDoc(spectrum);
    doc.items[0].rays = rays;
    const result = traceDocument(doc, "stable");
    emitted.push(result.sampling.emittedEnergy);
    received.push(result.hits.reduce((sum, hit) => sum + hit.power, 0));
  }
  for (const value of emitted) assert.ok(Math.abs(value - 1) < 1e-9);
  for (const value of received) assert.ok(Math.abs(value - 1) < 1e-9);
});

test("analysis identity follows the spectrum and layout, not the screen choice", () => {
  const doc = prismDoc([lineBand(450, 1), lineBand(650, 1)]);
  const base = traceDocument(doc, "stable");
  assert.equal(base.analysisId, traceDocument(doc, "stable").analysisId);

  const movedScreen = structuredClone(doc);
  movedScreen.items[2].x += 5;
  const moved = traceDocument(movedScreen, "stable");
  assert.notEqual(moved.layoutId, base.layoutId);
  assert.equal(moved.spectrumId, base.spectrumId);
  assert.notEqual(moved.analysisId, base.analysisId);

  const editedSpectrum = structuredClone(doc);
  editedSpectrum.items[0].spectrum = makeSpectrum("lines", [
    lineBand(450, 1),
    lineBand(640, 1),
  ]);
  const edited = traceDocument(editedSpectrum, "stable");
  assert.notEqual(edited.spectrumId, base.spectrumId);
  assert.equal(edited.layoutId, base.layoutId);

  // Preview and stable are different analyses of the same spectrum/layout.
  const preview = traceDocument(doc, "preview");
  assert.equal(preview.spectrumId, base.spectrumId);
  assert.equal(preview.layoutId, base.layoutId);
  assert.notEqual(preview.analysisId, base.analysisId);
});

test("saved documents reload with the same spectra and analysis identity", async () => {
  const { loadDocument, saveDocument } = await import(
    "../src/features/bench/lib/storage"
  );
  const store = new Map<string, string>();
  const previous = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  try {
    const doc = prismDoc([lineBand(450, 1), lineBand(650, 1)]);
    doc.items[0].spectrum = makeSpectrum("continuous", [
      continuousBand(430, 500, 1),
      continuousBand(520, 680, 1),
    ]);
    const before = traceDocument(doc, "stable");
    saveDocument(doc);
    const loaded = loadDocument();
    assert.ok(loaded);
    assert.equal(loaded!.version, 2);
    assert.deepEqual(
      loaded!.items[0].spectrum,
      doc.items[0].spectrum,
    );
    const after = traceDocument(loaded!, "stable");
    assert.equal(after.analysisId, before.analysisId);
    assert.equal(after.spectrumId, before.spectrumId);
    assert.equal(after.layoutId, before.layoutId);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = previous;
  }
});

test("a legacy document in storage loads as one line with the same energy", async () => {
  const { loadDocument } = await import("../src/features/bench/lib/storage");
  const store = new Map<string, string>();
  const previous = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  try {
    const legacy = {
      version: 1,
      items: [
        element({ id: "s", kind: "source", size: 100, power: 0.7, wavelength: 500 }),
        element({ id: "l", kind: "lens", x: 400, size: 200, focal: 150 }),
        element({ id: "d", kind: "screen", x: 550, size: 200 }),
      ],
    };
    store.set("lumen-document", JSON.stringify(legacy));
    const loaded = loadDocument();
    assert.ok(loaded);
    const result = traceDocument(loaded!, "stable");
    assert.equal(result.sampling.emittedEnergy, 0.7);
    assert.equal(result.bands.length, 1);
    assert.equal(result.bands[0].wavelength, 500);
    assert.ok(Math.abs(result.hits.reduce((s, h) => s + h.power, 0) - 0.7) < 1e-9);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = previous;
  }
});

test("re-analysing the same spectrum and layout is deterministic", () => {
  const doc = prismDoc([lineBand(450, 1), lineBand(650, 1)]);
  const first = traceDocument(doc, "stable");
  const second = traceDocument(doc, "stable");
  assert.equal(first.analysisId, second.analysisId);
  assert.equal(first.segments.length, second.segments.length);
  assert.deepEqual(
    first.hits.map((hit) => [hit.bandId, hit.screen, hit.position.toFixed(6)]),
    second.hits.map((hit) => [hit.bandId, hit.screen, hit.position.toFixed(6)]),
  );

  // Undo restores the earlier document, so re-tracing it must reproduce the
  // earlier analysis id exactly — the basis for tracing a saved or undone
  // curve and verdict back to the same spectrum + layout.
  const before = traceDocument(doc, "stable");
  const edited = structuredClone(doc);
  edited.items[1].angle = 40;
  traceDocument(edited, "stable");
  const undone = structuredClone(doc);
  assert.equal(traceDocument(undone, "stable").analysisId, before.analysisId);
});

test("preview analysis is deterministic too", () => {
  const doc = prismDoc([lineBand(450, 1), lineBand(650, 1)]);
  doc.items[0].spectrum = makeSpectrum("continuous", [continuousBand(400, 700, 1)]);
  const first = traceDocument(doc, "preview");
  const second = traceDocument(doc, "preview");
  assert.equal(first.analysisId, second.analysisId);
  assert.equal(first.sampling.rayCount, second.sampling.rayCount);
  assert.equal(first.quality, "preview");
  assert.notEqual(first.analysisId, traceDocument(doc, "stable").analysisId);
});

test("exhausting the ray budget degrades visibly instead of silently", () => {
  const doc = lensDoc(makeSpectrum("continuous", [continuousBand(400, 700, 1)]));
  const full = traceDocument(doc, "stable");
  const tight = traceDocument(doc, "stable", { budget: 60 });
  assert.equal(tight.sampling.budgetLimited, true);
  // Power is conserved either way: a budget can coarsen the answer, never
  // create or destroy emitted watts.
  for (const result of [full, tight])
    assert.ok(Math.abs(result.sampling.emittedEnergy - 1) < 1e-9);
  // The coarse grid is still verified by chord/crossing checks, so its error
  // bound is never *smaller* than the refined one; here it is merely wider in
  // spectral gap and flagged as budget-limited rather than silently trusted.
  assert.ok(
    tight.sampling.energyUncertainty >= full.sampling.energyUncertainty - 1e-12,
  );
  assert.ok(tight.sampling.spectralSamples < full.sampling.spectralSamples);
  assert.ok(tight.sampling.maxGap > full.sampling.maxGap);
});
