// ============================================
// Editing a map's tile heights from the tactical view (DM only)
//
// The brush changes a draft of the heights at once, so the board answers the
// pointer, and the draft is saved when the stroke ends. Saves go one at a
// time: a stroke finished while one is in flight waits and then sends the
// newest heights, so an older save can never land after a newer one.
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { apiErrorMessage } from '@/utils/errors';
import { createHeightGrid, isHeightGrid, type HeightGrid } from './heightGrid';
import {
  beginStroke,
  editableGrid,
  sameHeights,
  strokeCell,
  type BrushMode,
  type BrushStroke,
} from './heightBrush';
import type { Cell } from './projection';

/** How many strokes can be undone. */
const HISTORY_LIMIT = 50;

interface HeightBrushOptions {
  campaignId: string | undefined;
  mapId: string | undefined;
  cols: number;
  rows: number;
  /** The heights the map holds, as last heard from the server. */
  stored: HeightGrid | null;
  onError: (message: string) => void;
  /** The server stored these heights for this map. */
  onSaved: (mapId: string, heights: HeightGrid | null) => void;
}

export function useHeightBrush({
  campaignId,
  mapId,
  cols,
  rows,
  stored,
  onError,
  onSaved,
}: HeightBrushOptions) {
  const [mode, setMode] = useState<BrushMode | null>(null);
  const [level, setLevel] = useState(0);
  /** Heights ahead of the server: being painted, or saved and not yet heard back. */
  const [draft, setDraft] = useState<HeightGrid | null>(null);
  const [history, setHistory] = useState<HeightGrid[]>([]);

  const draftRef = useRef<HeightGrid | null>(null);
  const strokeRef = useRef<BrushStroke | null>(null);
  const savingRef = useRef(false);
  const queuedRef = useRef<HeightGrid | null>(null);
  const targetRef = useRef({ campaignId, mapId });
  targetRef.current = { campaignId, mapId };
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const showDraft = useCallback((next: HeightGrid | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  // Another map, or the same one resized: nothing drafted for the old board
  // applies to this one.
  useEffect(() => {
    strokeRef.current = null;
    queuedRef.current = null;
    showDraft(null);
    setHistory([]);
  }, [mapId, cols, rows, showDraft]);

  const save = useCallback(
    async (grid: HeightGrid) => {
      if (savingRef.current) {
        queuedRef.current = grid;
        return;
      }
      const target = targetRef.current;
      if (!target.campaignId || !target.mapId) return;
      savingRef.current = true;
      let failed = false;
      let saved: HeightGrid | null | undefined;
      try {
        const answer = await api.setMapHeights(target.campaignId, target.mapId, [...grid.heights]);
        saved = isHeightGrid(answer.tileHeights) ? answer.tileHeights : null;
      } catch (error) {
        failed = true;
        onErrorRef.current(apiErrorMessage(error) ?? 'The heights could not be saved');
      }
      savingRef.current = false;
      const next = queuedRef.current;
      queuedRef.current = null;
      const sameBoard = targetRef.current.mapId === target.mapId;
      if (next && sameBoard && !failed) {
        void save(next);
        return;
      }
      // Saved, with nothing newer waiting: the map takes the heights the
      // server stored, and the draft goes. After a failure the draft is
      // dropped too, so the board shows what is really stored.
      if (!sameBoard) return;
      if (saved !== undefined) onSavedRef.current(target.mapId, saved);
      if (!strokeRef.current) showDraft(null);
    },
    [showDraft]
  );

  const current = useCallback(
    () => draftRef.current ?? editableGrid(stored, cols, rows),
    [stored, cols, rows]
  );

  /** Touch a cell with the brush. Starts a stroke if none is under way. */
  const paint = useCallback(
    (cell: Cell) => {
      if (!mode) return;
      const grid = current();
      const stroke = strokeRef.current ?? beginStroke(grid);
      const result = strokeCell(stroke, grid, cell, mode, level);
      strokeRef.current = result.stroke;
      if (result.grid !== grid) showDraft(result.grid);
    },
    [mode, level, current, showDraft]
  );

  /** The pointer was released: keep the stroke for undo and save it. */
  const endStroke = useCallback(() => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    const grid = draftRef.current;
    if (!stroke || !grid || sameHeights(stroke.before, grid)) return;
    setHistory((past) => [...past.slice(-(HISTORY_LIMIT - 1)), stroke.before]);
    void save(grid);
  }, [save]);

  const replaceAll = useCallback(
    (next: HeightGrid) => {
      const grid = current();
      if (sameHeights(grid, next)) return;
      setHistory((past) => [...past.slice(-(HISTORY_LIMIT - 1)), grid]);
      showDraft(next);
      void save(next);
    },
    [current, showDraft, save]
  );

  /** Every cell back to height 0. */
  const flattenAll = useCallback(
    () => replaceAll(createHeightGrid(cols, rows)),
    [replaceAll, cols, rows]
  );

  const undo = useCallback(() => {
    if (strokeRef.current || history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(history.slice(0, -1));
    showDraft(previous);
    void save(previous);
  }, [history, showDraft, save]);

  return {
    mode,
    setMode,
    level,
    setLevel,
    /** The heights to draw: the draft while there is one, else the map's own. */
    heights: draft ?? stored,
    paint,
    endStroke,
    undo,
    canUndo: history.length > 0,
    flattenAll,
  };
}
