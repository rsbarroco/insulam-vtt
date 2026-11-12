// ============================================
// The tactical (isometric) view of the current map
//
// The same map, tokens and socket events as the top-down MapCanvas, drawn on
// a diamond grid with tile heights and a camera that turns in quarter turns.
// Tokens are picked up with a click and put down with a second click, as in
// the top-down view, and the moves go out as the same events.
//
// The DM's drawing tools (walls, fog, lights, the ruler) stay in the top-down
// view; MapView decides which of the two is on screen.
// ============================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eraser,
  Grid3x3,
  Maximize,
  Mountain,
  RotateCcw,
  RotateCw,
  Undo2,
} from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import {
  useCharacterHp,
  useCurrentTurnTokenId,
  useGameStore,
  useMapPeekTokenId,
  useTokenList,
} from '@/stores/gameStore';
import type { Token } from '@/types';
import { TokenLayer } from '@/types';
import { controlsToken } from '@/utils/tokenOwnership';
import { tokenDisplayName } from '@/utils/tokenDisplayName';
import Button from '@/components/ui/Button';
import { useTokenImages } from './map/useTokenImages';
import { cachedTokenImage, placeholderColor, DOWNED_TOKEN_ALPHA } from './map/layers/drawTokens';
import {
  blockingTokensAt,
  isTokenDowned,
  isTokenVisibleTo,
  pickMovableTokenAt,
  pickTokenAt,
} from './map/tokenHitTest';
import { releaseHeldToken } from './map/tokenHold';
import { isTypingInto } from './map/typingTarget';
import { heightAt, isHeightGrid, MAX_TILE_HEIGHT } from './map/iso/heightGrid';
import { useHeightBrush } from './map/iso/useHeightBrush';
import { cellKey, computeReach, fallDamageDice, pathTo } from './map/iso/reach';
import {
  reachObstacles,
  speedPatch,
  tokenSpeed,
  readSpeedOverride,
  walkingSpeedFromLine,
  TACTICAL_LIMITS,
} from './map/iso/tacticalStats';
import api from '@/services/api';
import { apiErrorMessage } from '@/utils/errors';
import type { BrushMode } from './map/iso/heightBrush';
import {
  isoBoardSize,
  isoMetrics,
  pickCell,
  turnCamera,
  type Cell,
  type IsoView,
  type QuarterTurn,
} from './map/iso/projection';
import { drawIsoScene, pickTokenDisc, type IsoCamera, type IsoToken } from './map/iso/drawIsoScene';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
/** Moves of a held token are sent at most this often, as in the top-down view. */
const MOVE_THROTTLE_MS = 16;
/** A press that travels less than this is a click, not a pan. */
const CLICK_SLOP_PX = 4;
const TURN_RING = '#facc15';
const PEEK_RING = '#60a5fa';

const BRUSHES: ReadonlyArray<{ mode: BrushMode; icon: typeof ArrowUp; label: string }> = [
  { mode: 'raise', icon: ArrowUp, label: 'Raise squares' },
  { mode: 'lower', icon: ArrowDown, label: 'Lower squares' },
  { mode: 'level', icon: Mountain, label: 'Set squares to a height' },
];

/** Where a footprint goes so that the pointed cell is at its middle, kept on the board. */
export function footprintOriginAt(
  cell: Cell,
  size: { width: number; height: number },
  board: { cols: number; rows: number }
): Cell {
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
  return {
    x: clamp(cell.x - Math.floor((size.width - 1) / 2), board.cols - size.width),
    y: clamp(cell.y - Math.floor((size.height - 1) / 2), board.rows - size.height),
  };
}

/** The camera that shows the whole board, centred, with a margin. */
export function fitCamera(
  view: IsoView,
  canvas: { width: number; height: number },
  tallest: number
): IsoCamera {
  const board = isoBoardSize(view);
  // The box leaves room above the board for the tallest possible tile; only
  // the part this board's own tallest tile reaches needs to fit.
  const unused = (MAX_TILE_HEIGHT - tallest) * isoMetrics(view.gridSize).stepH;
  const usedH = board.h - unused;
  const margin = 32;
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, (canvas.width - margin * 2) / board.w, (canvas.height - margin * 2) / usedH)
  );
  return {
    zoom,
    pan: {
      x: (canvas.width - board.w * zoom) / 2,
      y: (canvas.height - usedH * zoom) / 2 - unused * zoom,
    },
  };
}

export default function TacticalMapCanvas() {
  const { currentMap, setCurrentMap, userRole, campaign } = useCampaign();
  const { socket } = useWebSocket();
  const { user } = useAuth();
  const { showToast } = useToast();
  const tokens = useTokenList();
  const tokenImages = useTokenImages(tokens);
  const characterHpCache = useCharacterHp();
  const currentTurnTokenId = useCurrentTurnTokenId();
  const peekTokenId = useMapPeekTokenId();
  const isDM = userRole === 'DM';

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [rotation, setRotation] = useState<QuarterTurn>(0);
  const [camera, setCamera] = useState<IsoCamera>({ zoom: 1, pan: { x: 0, y: 0 } });
  const [showGrid, setShowGrid] = useState(true);
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);
  const [held, setHeld] = useState<Token | null>(null);
  /** The map the held token was picked up on, which is where it goes back to. */
  const heldOnMapRef = useRef<string | null>(null);
  const lastMoveEmitRef = useRef(0);
  const pressRef = useRef<{
    x: number;
    y: number;
    pan: { x: number; y: number };
    moved: boolean;
    button: number;
  } | null>(null);
  /** The token whose movement numbers the DM is editing, and where the editor sits. */
  const [editing, setEditing] = useState<{ tokenId: string; x: number; y: number } | null>(null);

  const heights = isHeightGrid(currentMap?.tileHeights) ? currentMap.tileHeights : null;
  // Heights for another size of board would put tiles in the wrong place;
  // a resize sends new ones, and until they arrive the board is flat.
  const storedHeights =
    heights && currentMap && heights.cols === currentMap.width && heights.rows === currentMap.height
      ? heights
      : null;

  // The DM's height brush. Its draft is what is drawn while a stroke is
  // being painted or saved.
  const brush = useHeightBrush({
    campaignId: campaign?.id,
    mapId: currentMap?.id,
    cols: currentMap?.width ?? 0,
    rows: currentMap?.height ?? 0,
    stored: storedHeights,
    onError: (message) => showToast(message, 'error'),
    onSaved: (savedMapId, tileHeights) =>
      setCurrentMap((latest) =>
        latest && latest.id === savedMapId ? { ...latest, tileHeights } : latest
      ),
  });
  const boardHeights = brush.heights;
  const brushMode = isDM ? brush.mode : null;
  const paintingRef = useRef(false);

  const view = useMemo<IsoView | null>(
    () =>
      currentMap
        ? {
            cols: currentMap.width,
            rows: currentMap.height,
            gridSize: currentMap.gridSize,
            rotation,
          }
        : null,
    [currentMap, rotation]
  );

  // ── Map picture ────────────────────────────────────────────────────────
  const imageUrl = currentMap?.imageUrl;
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setMapImage(img);
    img.onerror = () => setMapImage(null);
    img.src = imageUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
      setMapImage(null);
    };
  }, [imageUrl]);

  // ── Canvas size ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () =>
      setCanvasSize({ width: container.clientWidth, height: container.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Camera ─────────────────────────────────────────────────────────────
  const tallest = useMemo(
    () => (boardHeights ? Math.max(0, ...boardHeights.heights) : 0),
    [boardHeights]
  );
  const fit = useCallback(() => {
    if (view && canvasSize.width > 0 && canvasSize.height > 0)
      setCamera(fitCamera(view, canvasSize, tallest));
  }, [view, canvasSize, tallest]);

  // Fit when the board, its turn or the room for it changes; not when a
  // height is edited, which would move the board under the DM's pointer.
  const fitKey = view
    ? `${currentMap?.id}:${view.cols}x${view.rows}:${view.rotation}:${canvasSize.width > 0}`
    : '';
  const fittedKeyRef = useRef('');
  useEffect(() => {
    if (!fitKey || canvasSize.width === 0 || fittedKeyRef.current === fitKey) return;
    fittedKeyRef.current = fitKey;
    fit();
  }, [fitKey, canvasSize.width, fit]);

  // ── Live map changes this view depends on ──────────────────────────────
  // MapCanvas applies these while it is on screen; this view must too, above
  // all so that fog or lighting switched on sends a player back to the
  // top-down view, which is the one that hides what they may not see.
  useEffect(() => {
    const io = socket?.getSocket();
    if (!io) return;
    const onSettings = (data: {
      mapId: string;
      lightingEnabled: boolean;
      fogEnabled: boolean;
      globalIllumination: boolean;
      explorationEnabled: boolean;
    }) => {
      setCurrentMap((latest) =>
        latest && latest.id === data.mapId
          ? {
              ...latest,
              lightingEnabled: data.lightingEnabled,
              fogEnabled: data.fogEnabled,
              globalIllumination: data.globalIllumination,
              explorationEnabled: data.explorationEnabled,
            }
          : latest
      );
    };
    io.on('map:settings:updated', onSettings);
    return () => {
      io.off('map:settings:updated', onSettings);
    };
  }, [socket, setCurrentMap]);

  // ── Tokens ─────────────────────────────────────────────────────────────
  const canMoveToken = useCallback(
    (token: Token): boolean => {
      if (!campaign) return false;
      if (isDM) return true;
      if (campaign.status === 'PAUSED' || campaign.status === 'INACTIVE') return false;
      return controlsToken(token, user?.id, userRole);
    },
    [campaign, isDM, user?.id, userRole]
  );

  const tokenView = useMemo(
    () => ({
      isDM,
      // This view is shown to players only on a map with no fog and no
      // dynamic lighting (see MapView), so nothing here is hidden by either.
      revealedCells: null,
      isOwnToken: (token: Token) => controlsToken(token, user?.id, userRole),
      dmShowSpiritTokens: true,
      mapWidth: currentMap?.width ?? 0,
      mapHeight: currentMap?.height ?? 0,
    }),
    [isDM, user?.id, userRole, currentMap?.width, currentMap?.height]
  );

  const visibleTokens = useMemo(
    () => tokens.filter((token) => isTokenVisibleTo(token, tokenView)),
    [tokens, tokenView]
  );

  const sceneTokens = useMemo<IsoToken[]>(
    () =>
      visibleTokens.map((token) => {
        let alpha = 1;
        if (isTokenDowned(token, characterHpCache)) alpha = DOWNED_TOKEN_ALPHA;
        if (token.layer === TokenLayer.SPIRIT) alpha = Math.min(alpha, 0.6);
        if (held?.id === token.id) alpha = 0.35;
        return {
          id: token.id,
          cell: { x: Math.floor(token.position.x), y: Math.floor(token.position.y) },
          size: token.size,
          image: cachedTokenImage(token, tokenImages),
          colour: placeholderColor(token),
          ring:
            token.id === currentTurnTokenId
              ? TURN_RING
              : token.id === peekTokenId
                ? PEEK_RING
                : undefined,
          alpha,
        };
      }),
    [visibleTokens, characterHpCache, held?.id, tokenImages, currentTurnTokenId, peekTokenId]
  );

  const hoverToken = useMemo(() => {
    if (!hoverCell) return null;
    for (let i = visibleTokens.length - 1; i >= 0; i--) {
      const token = visibleTokens[i];
      const { x, y } = token.position;
      if (
        hoverCell.x >= x &&
        hoverCell.x < x + token.size.width &&
        hoverCell.y >= y &&
        hoverCell.y < y + token.size.height
      ) {
        return token;
      }
    }
    return null;
  }, [hoverCell, visibleTokens]);

  // ── Reach ──────────────────────────────────────────────────────────────
  // Shown for the held token, or the one pointed at, when it has a speed:
  // from its stat block, or set on it by the DM. What is in the way is what
  // this viewer can see.
  const reachToken = held ?? (brushMode ? null : hoverToken);
  const reachSpeed = reachToken ? (tokenSpeed(reachToken)?.feet ?? null) : null;
  const reach = useMemo(() => {
    if (!reachToken || reachSpeed === null || !currentMap) return null;
    const obstacles = reachObstacles(reachToken, visibleTokens, characterHpCache);
    return computeReach(
      {
        cell: { x: Math.floor(reachToken.position.x), y: Math.floor(reachToken.position.y) },
        size: reachToken.size,
        speed: reachSpeed,
      },
      {
        cols: currentMap.width,
        rows: currentMap.height,
        heights: boardHeights,
        feetPerSquare: currentMap.feetPerSquare,
        diagonalRule: currentMap.diagonalRule,
        ...obstacles,
      }
    );
  }, [reachToken, reachSpeed, currentMap, visibleTokens, characterHpCache, boardHeights]);

  const dropCell = useMemo(
    () =>
      held && hoverCell && currentMap
        ? footprintOriginAt(hoverCell, held.size, {
            cols: currentMap.width,
            rows: currentMap.height,
          })
        : null,
    [held, hoverCell, currentMap]
  );
  const dropPath = useMemo(
    () => (reach && dropCell ? pathTo(reach, dropCell) : null),
    [reach, dropCell]
  );
  const sceneReach = useMemo(
    () =>
      reach && reachToken
        ? { stops: new Set(reach.stops.keys()), size: reachToken.size, path: dropPath ?? [] }
        : null,
    [reach, reachToken, dropPath]
  );

  // What putting the token down here costs, for the hint.
  const dropStop = reach && dropCell ? (reach.stops.get(cellKey(dropCell)) ?? null) : null;
  const moveSummary =
    reachSpeed === null
      ? ''
      : !dropStop
        ? 'out of reach'
        : `${dropStop.feet} of ${reachSpeed} ft` +
          (dropStop.fallFeet > 0
            ? ` · falls ${dropStop.fallFeet} ft (${fallDamageDice(dropStop.fallFeet)}d6)`
            : '');

  const drop = useMemo(() => {
    if (!held || !dropCell) return null;
    const blocked = !isDM && blockingTokensAt(tokens, held, dropCell, characterHpCache).length > 0;
    const token = sceneTokens.find((candidate) => candidate.id === held.id);
    return token
      ? { token, cell: dropCell, blocked, outOfReach: reach !== null && dropPath === null }
      : null;
  }, [held, dropCell, isDM, tokens, characterHpCache, sceneTokens, reach, dropPath]);

  // ── Drawing ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !view || canvasSize.width === 0) return;
    const frame = requestAnimationFrame(() => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(canvasSize.width * ratio);
      const height = Math.round(canvasSize.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      drawIsoScene(
        ctx,
        {
          view,
          heights: boardHeights,
          mapImage,
          showGrid,
          tokens: sceneTokens,
          hoverCell: held ? null : hoverCell,
          drop,
          reach: sceneReach,
        },
        { zoom: camera.zoom * ratio, pan: { x: camera.pan.x * ratio, y: camera.pan.y * ratio } },
        { width, height }
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [
    view,
    boardHeights,
    mapImage,
    showGrid,
    sceneTokens,
    hoverCell,
    held,
    drop,
    sceneReach,
    camera,
    canvasSize,
  ]);

  // ── Pointer ────────────────────────────────────────────────────────────
  const toIso = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: (event.clientX - rect.left - camera.pan.x) / camera.zoom,
        y: (event.clientY - rect.top - camera.pan.y) / camera.zoom,
      };
    },
    [camera]
  );

  const canEmit = useCallback(() => Boolean(socket?.getSocket()), [socket]);

  const cancelHold = useCallback(() => {
    if (held && currentMap && canEmit()) {
      socket!.emitTokenMove(releaseHeldToken(held, heldOnMapRef.current ?? currentMap.id));
    }
    setHeld(null);
  }, [held, currentMap, canEmit, socket]);

  // A held token goes back if the map changes under it or this view closes.
  const cancelHoldRef = useRef(cancelHold);
  cancelHoldRef.current = cancelHold;
  const mapId = currentMap?.id;
  useEffect(() => () => cancelHoldRef.current(), [mapId]);

  const click = (event: React.PointerEvent) => {
    const iso = toIso(event);
    if (!iso || !view || !currentMap) return;
    const cell = pickCell(iso.x, iso.y, view, boardHeights);

    if (held) {
      if (!cell) return;
      const target = footprintOriginAt(cell, held.size, {
        cols: currentMap.width,
        rows: currentMap.height,
      });
      if (!isDM) {
        const blockedBy = blockingTokensAt(tokens, held, target, characterHpCache);
        if (blockedBy.length > 0) {
          showToast(`${tokenDisplayName(blockedBy[0])} is already standing there.`, 'info');
          cancelHold();
          return;
        }
      }
      if (canEmit())
        socket!.emitTokenMoveEnd({
          tokenId: held.id,
          mapId: currentMap.id,
          x: target.x,
          y: target.y,
        });
      useGameStore.getState().applyTokenMove(held.id, target);
      setHeld(null);
      return;
    }

    // A disc stands above its cell and can cover the cells behind it, so the
    // disc under the pointer is asked first, then the cell.
    const disc = pickTokenDisc(iso.x, iso.y, sceneTokens, boardHeights, view);
    const onDisc = disc ? visibleTokens.find((token) => token.id === disc.id) : undefined;
    const token =
      onDisc && canMoveToken(onDisc)
        ? onDisc
        : cell
          ? pickMovableTokenAt(tokens, cell.x, cell.y, canMoveToken, tokenView)
          : null;
    if (!token) return;
    heldOnMapRef.current = currentMap.id;
    setHeld(token);
    if (canEmit()) socket!.emitTokenMoveStart({ tokenId: token.id, mapId: currentMap.id });
  };

  /** The token under the pointer: the disc first, then the cell. */
  const tokenUnder = (event: { clientX: number; clientY: number }): Token | null => {
    const iso = toIso(event);
    if (!iso || !view) return null;
    const disc = pickTokenDisc(iso.x, iso.y, sceneTokens, boardHeights, view);
    if (disc) return visibleTokens.find((token) => token.id === disc.id) ?? null;
    const cell = pickCell(iso.x, iso.y, view, boardHeights);
    return cell ? pickTokenAt(tokens, cell.x, cell.y, tokenView) : null;
  };

  const openStatsEditor = (event: React.PointerEvent) => {
    if (!isDM || held) return;
    const token = tokenUnder(event);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!token || !rect) {
      setEditing(null);
      return;
    }
    setEditing({ tokenId: token.id, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const saveSpeed = async (tokenId: string, speed: number | null) => {
    if (!campaign?.id || !currentMap?.id) return;
    const token = useGameStore.getState().tokens[tokenId];
    if (!token) return;
    const before = token.metadata;
    const metadata = { ...(before ?? {}), ...speedPatch(speed) };
    useGameStore.getState().patchToken(tokenId, { metadata });
    setEditing(null);
    try {
      await api.updateToken(campaign.id, currentMap.id, tokenId, {
        metadata: speedPatch(speed),
      });
    } catch (error) {
      useGameStore.getState().patchToken(tokenId, { metadata: before });
      showToast(apiErrorMessage(error) ?? 'The speed could not be saved', 'error');
    }
  };

  const paintAt = (event: { clientX: number; clientY: number }) => {
    const iso = toIso(event);
    if (!iso || !view) return;
    const cell = pickCell(iso.x, iso.y, view, boardHeights);
    if (cell) brush.paint(cell);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    // The right button always pans, so the map can be moved with a brush up.
    // A right click that does not travel opens a token's movement numbers.
    if (event.button === 2) {
      event.currentTarget.setPointerCapture(event.pointerId);
      pressRef.current = {
        x: event.clientX,
        y: event.clientY,
        pan: camera.pan,
        moved: false,
        button: 2,
      };
      return;
    }
    if (event.button !== 0) return;
    if (brushMode && !held) {
      event.currentTarget.setPointerCapture(event.pointerId);
      paintingRef.current = true;
      paintAt(event);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = {
      x: event.clientX,
      y: event.clientY,
      pan: camera.pan,
      moved: false,
      button: 0,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (paintingRef.current) paintAt(event);
    const press = pressRef.current;
    if (press) {
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) press.moved = true;
      if (press.moved) {
        setCamera((current) => ({
          zoom: current.zoom,
          pan: { x: press.pan.x + dx, y: press.pan.y + dy },
        }));
        return;
      }
    }
    const iso = toIso(event);
    if (!iso || !view || !currentMap) return;
    const cell = pickCell(iso.x, iso.y, view, boardHeights);
    setHoverCell((previous) =>
      previous?.x === cell?.x && previous?.y === cell?.y ? previous : cell
    );

    if (held && cell && canEmit()) {
      const now = Date.now();
      if (now - lastMoveEmitRef.current >= MOVE_THROTTLE_MS) {
        const target = footprintOriginAt(cell, held.size, {
          cols: currentMap.width,
          rows: currentMap.height,
        });
        socket!.emitTokenMove({ tokenId: held.id, mapId: currentMap.id, x: target.x, y: target.y });
        lastMoveEmitRef.current = now;
      }
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (paintingRef.current) {
      paintingRef.current = false;
      brush.endStroke();
      return;
    }
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.moved) return;
    if (press.button === 2) openStatsEditor(event);
    else click(event);
  };

  // The wheel zooms about the pointer. React's wheel listener is passive, so
  // this one is attached by hand to be allowed to stop the page scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setCamera((current) => {
        const zoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
        );
        const scale = zoom / current.zoom;
        return {
          zoom,
          pan: {
            x: at.x - (at.x - current.pan.x) * scale,
            y: at.y - (at.y - current.pan.y) * scale,
          },
        };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ── Keyboard ───────────────────────────────────────────────────────────
  const brushActiveRef = useRef(false);
  brushActiveRef.current = brushMode !== null;
  const undoRef = useRef(brush.undo);
  undoRef.current = brush.undo;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingInto(event.target)) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      ) {
        if (brushActiveRef.current) {
          event.preventDefault();
          undoRef.current();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'q' || event.key === 'Q') setRotation((current) => turnCamera(current, -1));
      else if (event.key === 'e' || event.key === 'E')
        setRotation((current) => turnCamera(current, 1));
      else if (event.key === 'Escape') cancelHoldRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const editingToken = editing
    ? (tokens.find((token) => token.id === editing.tokenId) ?? null)
    : null;

  if (!currentMap) return null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-surface"
      data-testid="tactical-map"
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${held ? 'cursor-grabbing' : 'cursor-default'}`}
        aria-label={`Tactical view of ${currentMap.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverCell(null)}
        onContextMenu={(event) => event.preventDefault()}
      />

      <div className="absolute top-4 left-4 glass-panel p-2 flex items-center gap-1 bg-parchment/90 backdrop-blur-xs">
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          iconOnly
          aria-label="Turn the view left"
          title="Turn the view left (Q)"
          onClick={() => setRotation((current) => turnCamera(current, -1))}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCw}
          iconOnly
          aria-label="Turn the view right"
          title="Turn the view right (E)"
          onClick={() => setRotation((current) => turnCamera(current, 1))}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Maximize}
          iconOnly
          aria-label="Fit the map to the screen"
          title="Fit the map to the screen"
          onClick={fit}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Grid3x3}
          iconOnly
          aria-label={showGrid ? 'Hide the grid' : 'Show the grid'}
          aria-pressed={showGrid}
          title={showGrid ? 'Hide the grid' : 'Show the grid'}
          onClick={() => setShowGrid((current) => !current)}
        />
      </div>

      {isDM && (
        <div
          className="absolute top-16 left-4 glass-panel p-2 flex items-center gap-1 bg-parchment/90 backdrop-blur-xs"
          role="group"
          aria-label="Tile heights"
        >
          {BRUSHES.map(({ mode, icon, label }) => (
            <Button
              key={mode}
              variant={brush.mode === mode ? 'secondary' : 'ghost'}
              size="sm"
              icon={icon}
              iconOnly
              aria-label={label}
              aria-pressed={brush.mode === mode}
              title={label}
              onClick={() => brush.setMode(brush.mode === mode ? null : mode)}
            />
          ))}
          <label className="flex items-center gap-1 text-sm text-ink">
            <span className="sr-only">Height the level brush sets</span>
            <input
              type="number"
              min={0}
              max={MAX_TILE_HEIGHT}
              value={brush.level}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value))
                  brush.setLevel(Math.max(0, Math.min(MAX_TILE_HEIGHT, Math.round(value))));
              }}
              className="input-cozy w-16 text-sm py-1"
              title="Height the level brush sets"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            icon={Undo2}
            iconOnly
            aria-label="Undo height edit"
            title="Undo height edit (Ctrl+Z)"
            disabled={!brush.canUndo}
            onClick={brush.undo}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Eraser}
            iconOnly
            aria-label="Flatten the whole map"
            title="Flatten the whole map"
            disabled={tallest === 0}
            onClick={brush.flattenAll}
          />
        </div>
      )}

      {hoverCell && (
        <div className="absolute bottom-4 left-4 glass-panel px-3 py-1.5 bg-parchment/90 backdrop-blur-xs text-sm text-ink">
          {hoverToken && <span className="font-medium">{tokenDisplayName(hoverToken)} · </span>}
          <span>
            ({hoverCell.x}, {hoverCell.y})
          </span>
          <span> · height {heightAt(boardHeights, hoverCell.x, hoverCell.y)}</span>
        </div>
      )}

      {held && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
          Click a square to put {tokenDisplayName(held)} down, or press Esc to cancel
          {reachSpeed !== null && drop && ` · ${moveSummary}`}
        </div>
      )}

      {editing && editingToken && (
        <TacticalStatsEditor
          key={editing.tokenId}
          name={tokenDisplayName(editingToken)}
          override={readSpeedOverride(editingToken)}
          printed={walkingSpeedFromLine(editingToken.statBlock?.speed)}
          style={{ left: Math.max(8, editing.x), top: Math.max(8, editing.y) }}
          onSave={(speed) => void saveSpeed(editing.tokenId, speed)}
          onClose={() => setEditing(null)}
        />
      )}

      {brushMode && !held && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
          Click or drag over squares to change their height. Drag with the right button to move the
          map.
        </div>
      )}
    </div>
  );
}

interface TacticalStatsEditorProps {
  name: string;
  /** The speed the DM set on this token, if any. */
  override: number | null;
  /** The walking speed its stat block gives, if it has one. */
  printed: number | null;
  style: React.CSSProperties;
  onSave: (speed: number | null) => void;
  onClose: () => void;
}

/** The DM's small form for a token's walking speed. */
function TacticalStatsEditor({
  name,
  override,
  printed,
  style,
  onSave,
  onClose,
}: TacticalStatsEditorProps) {
  const [text, setText] = useState(String(override ?? printed ?? 30));
  const value = Number(text);
  const valid =
    text.trim() !== '' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= TACTICAL_LIMITS.maxSpeed;

  return (
    <form
      className="absolute z-30 glass-panel p-3 space-y-2 w-60 bg-parchment/95 backdrop-blur-xs shadow-lg"
      style={style}
      aria-label={`Speed of ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <p className="text-sm font-medium text-ink truncate">{name}</p>
      <label className="flex items-center justify-between gap-2 text-sm text-ink">
        Speed (feet)
        <input
          type="number"
          min={0}
          max={TACTICAL_LIMITS.maxSpeed}
          step={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="input-cozy w-20 text-sm py-1"
          autoFocus
        />
      </label>
      <p className="text-xs text-ink-muted">
        {printed !== null
          ? `Its stat block says ${printed} ft.`
          : 'This token has no stat block speed; set one to see how far it can move.'}
      </p>
      <div className="flex items-center justify-end gap-1 pt-1">
        {override !== null && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onSave(null)}>
            {printed !== null ? 'Use stat block' : 'Clear'}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!valid}>
          Save
        </Button>
      </div>
    </form>
  );
}
