"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveBoardOrder } from "@/app/studio/projects/[id]/structure-actions";
import type { BoardOrder, Episode, Scene, Warning } from "@/lib/studio/structure/types";
import { structureWarnings } from "@/lib/studio/structure/warnings";

type Columns = Record<string, Scene[]>; // actId -> scenes

function toColumns(episodes: Episode[]): Columns {
  const c: Columns = {};
  for (const e of episodes) for (const a of e.acts) c[a.id] = a.scenes;
  return c;
}

function withColumns(episodes: Episode[], cols: Columns): Episode[] {
  return episodes.map((e) => ({
    ...e,
    acts: e.acts.map((a) => ({ ...a, scenes: (cols[a.id] ?? []).map((s) => ({ ...s, act_id: a.id, episode_id: e.id })) })),
  }));
}

const WARN_LABEL: Record<Warning["kind"], string> = {
  prop_before_intro: "Prop before intro",
  steps_out_of_order: "Steps out of order",
  plant_no_payoff: "Plant not paid off",
  payoff_no_plant: "Payoff without plant",
  no_purpose: "No purpose",
};

export function StructureBoard({
  projectId,
  episodes,
  selectedId,
  actForms,
  episodeHeaders,
}: {
  projectId: string;
  episodes: Episode[];
  selectedId?: string;
  /** Server-rendered controls per act (add scene, rename, delete), keyed by act id. */
  actForms: Record<string, React.ReactNode>;
  /** Server-rendered header per episode (title, move, add act, delete), keyed by episode id. */
  episodeHeaders: Record<string, React.ReactNode>;
}) {
  const [cols, setCols] = useState<Columns>(() => toColumns(episodes));
  const [saved, setSaved] = useState<Columns>(() => toColumns(episodes));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [lastKey, setLastKey] = useState(() => JSON.stringify(episodes));

  // When the server sends a new board (after any save, including field edits), take it.
  const key = JSON.stringify(episodes);
  if (key !== lastKey) {
    setLastKey(key);
    setCols(toColumns(episodes));
    setSaved(toColumns(episodes));
  }

  const live = useMemo(() => withColumns(episodes, cols), [episodes, cols]);
  const warnings = useMemo(() => structureWarnings(live), [live]);
  const warnBy = useMemo(() => {
    const m = new Map<string, Warning[]>();
    for (const w of warnings) m.set(w.sceneId, [...(m.get(w.sceneId) ?? []), w]);
    return m;
  }, [warnings]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: string) => (id in cols ? id : Object.keys(cols).find((k) => cols[k].some((s) => s.id === id)));
  const episodeOfAct = (actId: string) => episodes.find((e) => e.acts.some((a) => a.id === actId))?.id;
  const activeScene = activeId ? Object.values(cols).flat().find((s) => s.id === activeId) : null;

  function onStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setError(null);
  }

  function onOver(e: DragOverEvent) {
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    const from = findCol(String(e.active.id));
    const to = findCol(over);
    if (!from || !to || from === to) return;
    if (episodeOfAct(from) !== episodeOfAct(to)) return; // scenes stay within their episode
    setCols((c) => {
      const moving = c[from].find((s) => s.id === e.active.id)!;
      const target = c[to];
      const idx = over in c ? target.length : Math.max(0, target.findIndex((s) => s.id === over));
      return { ...c, [from]: c[from].filter((s) => s.id !== e.active.id), [to]: [...target.slice(0, idx), moving, ...target.slice(idx)] };
    });
  }

  function onEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over ? String(e.over.id) : null;
    let next = cols;
    if (over) {
      const col = findCol(String(e.active.id));
      if (col && col === findCol(over) && !(over in cols)) {
        const oldI = cols[col].findIndex((s) => s.id === e.active.id);
        const newI = cols[col].findIndex((s) => s.id === over);
        if (oldI !== newI) next = { ...cols, [col]: arrayMove(cols[col], oldI, newI) };
      }
    }
    setCols(next);
    const same = Object.keys(next).every((k) => next[k].map((s) => s.id).join() === (saved[k] ?? []).map((s) => s.id).join());
    if (same) return;
    const order: BoardOrder = Object.entries(next).map(([actId, scenes]) => ({ actId, sceneIds: scenes.map((s) => s.id) }));
    start(async () => {
      const r = await saveBoardOrder(projectId, order);
      if (r.ok) setSaved(next);
      else {
        setError(r.error ?? "Couldn't save the new order.");
        setCols(saved);
      }
    });
  }

  return (
    <div>
      <div aria-live="polite" className="mb-3 min-h-6 text-sm">
        {pending ? <span className="s-muted">Saving order…</span> : error ? <span className="font-bold text-[var(--s-magenta-deep)]">{error}</span> : null}
      </div>

      <section aria-labelledby="warn-title" className="s-card mb-4 p-4">
        <h2 id="warn-title" className="s-head text-lg">
          Warnings {warnings.length > 0 ? `(${warnings.length})` : ""}
        </h2>
        {warnings.length === 0 ? (
          <p className="s-muted mt-1 text-sm">✓ No problems found: props are introduced before use, steps are in order, plants are paid off and every scene has a purpose.</p>
        ) : (
          <ul className="mt-1 text-sm">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-[#FFF3C4] px-1.5 text-xs font-bold leading-5">{WARN_LABEL[w.kind]}</span>
                <Link href={`/studio/projects/${projectId}/structure?scene=${w.sceneId}`} className="s-link inline-flex min-h-11 items-center">
                  {w.message}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => { setActiveId(null); setCols(saved); }}>
        <div className="space-y-6">
          {live.map((e) => (
            <div key={e.id} data-episode={e.id}>
              {episodeHeaders[e.id]}
              {e.acts.length === 0 && <p className="s-muted text-sm">This episode has no acts yet.</p>}
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {e.acts.map((a) => (
                  <ActColumn key={a.id} actId={a.id} title={a.title} scenes={cols[a.id] ?? []} warnBy={warnBy} projectId={projectId} selectedId={selectedId} footer={actForms[a.id]} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <DragOverlay>{activeScene ? <SceneCardView scene={activeScene} warnings={warnBy.get(activeScene.id) ?? []} dragging /> : null}</DragOverlay>
      </DndContext>
      <p className="s-muted mt-4 text-xs">
        Keyboard: Tab to a scene&rsquo;s ⠿ handle, press Space to pick it up, use the arrow keys to move it, Space to drop, Escape to cancel. On a
        phone, press and hold the handle. Scenes can move between acts in the same episode.
      </p>
    </div>
  );
}

function ActColumn({
  actId,
  title,
  scenes,
  warnBy,
  projectId,
  selectedId,
  footer,
}: {
  actId: string;
  title: string;
  scenes: Scene[];
  warnBy: Map<string, Warning[]>;
  projectId: string;
  selectedId?: string;
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: actId });
  return (
    <div className={`rounded-xl border-2 p-3 ${isOver ? "border-[var(--s-cobalt)]" : "border-[var(--s-line)]"} bg-[var(--s-paper)]`}>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">{title || "Untitled act"}</h3>
      <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="min-h-16 space-y-2" aria-label={`Scenes in ${title || "this act"}`}>
          {scenes.map((s, i) => (
            <SortableScene key={s.id} scene={s} index={i} warnings={warnBy.get(s.id) ?? []} projectId={projectId} selected={s.id === selectedId} />
          ))}
          {scenes.length === 0 && <li className="s-muted rounded-lg border-2 border-dashed border-[var(--s-line)] p-3 text-center text-xs">Drop a scene here</li>}
        </ol>
      </SortableContext>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

function SortableScene({ scene, index, warnings, projectId, selected }: { scene: Scene; index: number; warnings: Warning[]; projectId: string; selected: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}>
      <div className={`flex gap-2 rounded-lg border-2 bg-white p-2 ${selected ? "border-[var(--s-ink)]" : "border-transparent"}`}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move scene ${index + 1}: ${scene.title || "Untitled"}`}
          className="grid min-h-11 w-9 shrink-0 cursor-grab touch-none place-items-center rounded-md text-lg text-[var(--s-slate)] hover:bg-[var(--s-paper)] active:cursor-grabbing"
        >
          ⠿
        </button>
        <Link href={`/studio/projects/${projectId}/structure?scene=${scene.id}`} className="min-w-0 flex-1 py-1">
          <SceneCardBody scene={scene} warnings={warnings} />
        </Link>
      </div>
    </li>
  );
}

function SceneCardView({ scene, warnings, dragging }: { scene: Scene; warnings: Warning[]; dragging?: boolean }) {
  return (
    <div className={`rounded-lg border-2 border-[var(--s-ink)] bg-white p-2 pl-11 ${dragging ? "shadow-xl" : ""}`}>
      <SceneCardBody scene={scene} warnings={warnings} />
    </div>
  );
}

function SceneCardBody({ scene, warnings }: { scene: Scene; warnings: Warning[] }) {
  return (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="font-bold leading-tight">{scene.title || "Untitled scene"}</span>
        {warnings.length > 0 && (
          <span className="shrink-0 rounded bg-[#FFF3C4] px-1.5 text-xs font-bold" title={warnings.map((w) => w.message).join("\n")}>
            ⚠ {warnings.length}
          </span>
        )}
      </span>
      <span className="s-muted block text-xs">
        {scene.purpose ? `Purpose: ${scene.purpose}` : "No purpose yet"}
        {scene.chain ? ` · ${scene.chain} step ${scene.chain_step ?? "?"}` : ""}
      </span>
      {scene.beat && <span className="mt-0.5 line-clamp-2 block text-sm">{scene.beat}</span>}
      {(scene.characters.length > 0 || scene.location) && (
        <span className="s-muted mt-0.5 block text-xs">
          {[scene.location, scene.characters.join(", ")].filter(Boolean).join(" · ")}
        </span>
      )}
      {scene.reader_choice && <span className="mt-1 block text-xs font-bold text-[var(--s-cobalt)]">Vote: {scene.reader_choice}</span>}
    </>
  );
}
