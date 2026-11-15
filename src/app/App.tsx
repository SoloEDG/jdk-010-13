import { useEffect, useState } from "react";
import {
  Sun,
  Undo2,
  Redo2,
  Save,
  Grid2X2,
  MousePointer2,
  Move,
  Info,
  FlaskConical,
} from "lucide-react";
import { CatalogPanel, Inspector, createElement } from "../features/catalog";
import { Bench, ObjectList, useDocument } from "../features/bench";
import { useOptics, RayLayer, OpticsControls } from "../features/optics";
import { useDetector, DetectorPanel } from "../features/detector";
import { initialDocument, useMission, MissionPanel } from "../features/missions";

export function App() {
  const state = useDocument(initialDocument);
  const optics = useOptics(state.doc, state.preview);
  const detector = useDetector(state.doc, optics.result);
  const mission = useMission(state.doc, optics.result);
  const [grid, setGrid] = useState(true);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = state.doc.items.find((element) => element.id === state.selected);
  const analysis = optics.result;
  // The panel label must describe the result that is actually on screen, not
  // merely "a drag is in progress": before the first preview tick the shown
  // numbers are still the last settled analysis.
  const quality = analysis.quality;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="app-shell">
      <header>
        <a className="brand" href="./">
          <span className="brand-mark">
            <Sun size={23} />
          </span>
          LUMEN
          <span className="brand-divider" />
          <small>光学实验室</small>
        </a>
        <div className="document-title">
          未命名实验 <span>本地工作区</span>
        </div>
        <div className="header-actions">
          <button title="撤销" disabled={!state.canUndo} onClick={state.undo}>
            <Undo2 size={17} />
          </button>
          <button title="重做" disabled={!state.canRedo} onClick={state.redo}>
            <Redo2 size={17} />
          </button>
          <i />
          <button
            className="save-button"
            onClick={() => {
              try {
                state.save();
                setNotice("实验已保存到此浏览器");
              } catch {
                setNotice("保存失败，浏览器存储空间不足");
              }
            }}
          >
            <Save size={15} />
            {state.saved ? "已保存" : "保存实验"}
          </button>
        </div>
      </header>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">THE OPTICS PLAYGROUND</span>
          <h1>
            让光的路径，清晰可见<span>。</span>
          </h1>
        </div>
        <p>
          <i />
          二维几何光学 · 实时模拟
        </p>
      </div>
      <main>
        <aside className="left-sidebar">
          <CatalogPanel
            onAdd={(kind) => {
              if (state.doc.items.length >= 80) {
                setNotice("场景最多容纳 80 个器件");
                return;
              }
              const element = createElement(kind, state.doc.items.length);
              state.replace({ ...state.doc, items: [...state.doc.items, element] });
              state.setSelected(element.id);
            }}
          />
          <ObjectList
            doc={state.doc}
            selected={state.selected}
            onSelect={state.setSelected}
          />
        </aside>
        <div className="center">
          <section className="canvas-panel">
            <div className="canvas-toolbar">
              <div className="canvas-label">
                <FlaskConical size={15} />
                实验台
                <span className={quality === "preview" ? "preview" : ""}>
                  {quality === "preview"
                    ? "PREVIEW"
                    : optics.dragging
                      ? "HOLD"
                      : "LIVE"}
                </span>
              </div>
              <div className="canvas-tools">
                <OpticsControls
                  visible={optics.visible}
                  normals={optics.normals}
                  onVisible={() => optics.setVisible(!optics.visible)}
                  onNormals={() => optics.setNormals(!optics.normals)}
                />
                <button
                  className={grid ? "enabled" : ""}
                  title="切换网格"
                  onClick={() => setGrid(!grid)}
                >
                  <Grid2X2 size={15} />
                </button>
              </div>
            </div>
            <div className="canvas-container">
              <Bench
                doc={state.doc}
                selected={state.selected}
                onSelect={state.setSelected}
                onUpdate={state.update}
                onPreview={state.setPreview}
                grid={grid}
              >
                {/* One layer at a time: while dragging it is the debounced
                    preview (dashed) or, before the first preview tick, the
                    previous stable result drawn as a faded preview. There is
                    never a moment where two analyses are presented as one. */}
                <RayLayer
                  doc={state.doc}
                  result={optics.result}
                  visible={optics.visible}
                  normals={optics.normals}
                  preview={quality === "preview"}
                />
              </Bench>
              <div className="canvas-badge">
                <MousePointer2 size={13} />
                {quality === "preview"
                  ? "拖动中 · 近似光路"
                  : optics.dragging
                    ? "拖动中 · 上一次稳定光路"
                    : "选择与拖动"}
              </div>
              <div className="scale">
                ━━━━ <span>100 mm</span>
              </div>
            </div>
            <div className="canvas-footer">
              <span>
                <Move size={12} />
                拖动移动器件 <i />
                方向键微调
              </span>
              <span>
                {analysis.segments.length} 段光路 ·{" "}
                {analysis.sampling.spectralSamples} 个采样波长 ·{" "}
                {state.doc.items.length} 个器件
              </span>
            </div>
          </section>
          <DetectorPanel
            screen={detector.screen}
            screens={detector.screens}
            measurement={detector.measurement}
            onChoose={detector.setChosen}
            resolution={detector.resolution}
            onResolution={detector.setResolution}
            bands={detector.bands}
            bandFilter={detector.bandFilter}
            onBandFilter={detector.setBandFilter}
            quality={quality}
            analysisId={analysis.analysisId}
            budgetLimited={analysis.sampling.budgetLimited}
            mergedLines={analysis.sampling.mergedLines}
          />
        </div>
        <aside className="right-sidebar">
          <Inspector
            element={selected}
            onUpdate={(patch) => selected && state.update(selected.id, patch)}
            onRemove={() => selected && state.remove(selected.id)}
          />
          <MissionPanel
            mission={mission.mission}
            missions={mission.missions}
            evaluation={mission.evaluation}
            quality={quality}
            dragging={optics.dragging}
            onChoose={(id) => {
              state.replace(mission.choose(id));
              state.setSelected(null);
            }}
          />
        </aside>
      </main>
      <footer>
        <span>
          <i className={optics.dragging ? "preview" : ""} />
          {quality === "preview"
            ? "拖动预览：粗采样近似结果"
            : optics.dragging
              ? "拖动中 · 显示上一次稳定结果"
              : "光路计算已更新"}
          {analysis.truncated > 0 ? " · 部分光线达到追迹上限" : ""}
          {analysis.sampling.budgetLimited ? " · 受预算限制" : ""}
        </span>
        <span>{notice || "所有实验数据保存在你的浏览器中"}</span>
        <button onClick={() => setHelp(!help)}>
          <Info size={13} />
          使用指南
        </button>
      </footer>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section className="help-modal" onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">QUICK START</span>
            <h2>在光的世界里动手探索</h2>
            <p>1. 点击左侧器件添加到实验台。</p>
            <p>
              2. 拖动器件改变位置；右侧调整角度、焦距与光谱。选中光源后可在
              “光谱” 中切换单色、离散谱线或连续光谱，并逐段设置权重。
            </p>
            <p>
              3.
              光线遇到接收屏后终止，底部实时显示命中能量、光斑半径与采样误差。
              接收屏面板可按波段筛选曲线。
            </p>
            <p>
              4.
              选择实验任务，达到测量条件时自动完成。判定会引用同一次分析 ID，
              保存、撤销和切换屏幕后仍可追溯。
            </p>
            <p className="muted">
              透镜采用近轴薄透镜模型。棱镜使用带色散的 Snell
              折射，550 nm 处折射率等于设定值。拖动器件时使用粗采样预览（虚线光路，
              面板标注“近似”），松手后进行稳定分析；采样点数增加不会改变光源总功率。
            </p>
            <button className="save-button" onClick={() => setHelp(false)}>
              开始探索
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
