# Tactical mode

A plan for an isometric, height-aware battle view in the style of classic
tactical RPGs: a diamond grid with tile elevation, a rotating camera, movement
and attack ranges that respect height, unit facing, and a speed-based turn
timeline.

This page is the roadmap. Each phase below is one pull request, and a phase
starts only after the one before it has merged. Sections are updated as phases
land.

## What the genre does

This is a study of the conventions shared by isometric tactical RPGs, taken
from how those games play and from public design write-ups. No game binaries,
data files, art, names or maps were examined or copied, and none will be: the
tactical mode is an original implementation of genre mechanics on this VTT's
own data.

| Convention | How it works in the genre | What it means here |
| --- | --- | --- |
| Diamond grid | A square grid drawn in 2:1 dimetric projection, so each cell is a diamond twice as wide as it is tall. | A second way to draw the existing square grid. The cell model does not change. |
| Tile height | Each cell has an integer height. Cliffs, stairs and rooftops are stacks of steps. | One small integer per cell, stored on the map. |
| Camera | Four fixed views, a quarter turn apart, so nothing stays hidden behind a wall. | A per-viewer rotation of 0, 90, 180 or 270 degrees. |
| Move and Jump | A unit walks up to *Move* cells, orthogonally, and can climb or drop at most *Jump* height steps between neighbouring cells. Allies can be passed through, enemies cannot, and nobody ends on an occupied cell. | A flood fill over the height grid, drawn as highlighted cells. |
| Attack range | A minimum and maximum distance in cells, plus a vertical tolerance. Height can extend ranged reach. | A range template that also reads the height grid. |
| Facing | Units face one of four directions. Attacks from the side or the back are stronger, so every turn ends by choosing a facing. | The token's existing `rotation`, snapped to quarter turns, with front, side and back arcs shown. |
| Turn timeline | Each unit gains charge every tick according to its speed and acts at a threshold, so fast units act more often. The upcoming order is shown as a list. | A second ordering mode for the initiative tracker, with a preview of the next turns. |
| Turn flow | Move, act, then wait and face, in either order for the first two. | A small action bar for the token whose turn it is. |

## What the VTT has today

- The map is three stacked 2D canvases drawn by pure layer functions
  (`frontend/src/components/campaign/map/layers/`). There is no rendering
  library and no WebGL.
- The grid is square. Token positions are whole cells with a bottom-left
  origin, and all conversion goes through `map/coords.ts`.
- Tokens are a JSON array on `Map.tokens`. A token already has a `rotation` of
  0 to 360 degrees.
- Initiative is an in-memory order per campaign, sorted by a single number.
- Nothing stores height, and nothing checks distance or turn ownership when a
  token moves.
- Fog, walls, dynamic lighting and vision are computed in top-down pixel space.

## Design decisions

1. **The isometric view is another projection of the same map.** Cells,
   tokens, permissions and socket events stay as they are. A map that has no
   height data is a flat board and still works in either view.
2. **Canvas 2D stays.** Tiles are drawn back to front with the painter's
   algorithm. A battle map is at most a few thousand cells, which a dirty-flag
   canvas handles without a new dependency.
3. **The map picture is draped over the tile tops.** Each cell's square of the
   existing map image is drawn onto its diamond, so every current map is usable
   at once. Tile sides are shaded faces.
4. **Height is DM data on the map.** One integer from 0 to 32 per cell, in a
   new `Map.tileHeights` column, edited with a DM brush tool.
5. **The VTT computes geometry, not rules.** It answers "which cells can this
   token reach", "is the target in range", "how much higher is the attacker"
   and "is this the target's back". Damage, hit chance and abilities stay with
   the game system and the DM. For Insulam this keeps the rule in
   [INSULAM_INTEGRATION.md](INSULAM_INTEGRATION.md): never duplicate the
   CharacterMaker engine.
6. **Movement limits are advisory by default.** Reach is highlighted for
   everyone. A per-campaign setting lets the DM have the server refuse a
   player's move outside the highlighted cells. The DM is never limited.
7. **Hidden things stay hidden.** The isometric view draws fog from the same
   data as the top-down view. Until dynamic lighting is projected (phase 8), a
   player on a map with dynamic lighting sees the top-down view only.
8. **Shared maths is shared code.** Reach and timeline rules live in
   `utils/rules/` in both projects, byte-identical, under the existing parity
   test.

## Phases

| # | Phase | What ships | Main files |
| --- | --- | --- | --- |
| 0 | Plan | This page. | `docs/TACTICAL_MODE.md` |
| 1 | Geometry core | Pure, tested modules: the height grid type, cell-to-screen projection with height and camera rotation, draw order, and screen-to-cell picking. No visible change. | `frontend/src/components/campaign/map/iso/` |
| 2 | Height data | The `Map.tileHeights` column and migration, validation, a DM route and a socket event to set heights, and the API and event documentation. | `backend/prisma/`, `backend/src/routes/maps.ts`, `backend/src/validators/`, `backend/docs/` |
| 3 | Isometric view | A view switch and camera rotation on the map. Terrain as raised tiles with the map picture on top, grid, fog, and tokens as upright markers. Picking, so tokens can be moved in this view. | `MapCanvas.tsx`, `map/layers/` |
| 4 | Height brush | A DM tool to raise, lower, flatten and fill cells, with undo. | `map/tools/` |
| 5 | Movement reach | Move and Jump values on a token, the reach flood fill, highlighted cells and a path preview while a token is carried, and the optional server check. | `utils/rules/tacticalReach.ts`, `backend/src/websocket/handlers/tokens.ts` |
| 6 | Turn timeline | A speed-based ordering mode for the initiative tracker with a preview of upcoming turns. | `utils/rules/turnTimeline.ts`, `InitiativeTracker.tsx`, `initiativeState.ts` |
| 7 | Facing and attack geometry | Four-way facing with front, side and back arcs, a range template with minimum, maximum and vertical tolerance, and a height-difference readout. | `map/iso/`, `map/layers/drawOverlays.ts` |
| 8 | Turn flow and finish | The move, act and wait action bar, dynamic lighting in the isometric view, and the DM and player guides. | `components/campaign/`, `docs/` |

Every phase carries its own tests, updates the documentation it touches in the
same pull request, and must pass the full CI run before it merges.

## Status

| Phase | State |
| --- | --- |
| 0 Plan | Done |
| 1 Geometry core | Done: `map/iso/heightGrid.ts`, `map/iso/projection.ts` |
| 2 Height data | Done: `Map.tileHeights`, `GET` and `PUT /maps/:id/heights`, the `heights:replaced` event, carried through resize, export and import |
| 3 to 8 | Not started |
