# Tactical mode

A plan for a tactics game run by a game master, in the style of classic
tactical RPGs. First the board: a diamond grid with tile elevation, a rotating
camera, movement and attack ranges that respect height, unit facing, and a
speed-based turn timeline. Then the game on it: characters built by the rules,
abilities, enemies, prepared adventures, and combat the VTT resolves.

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
5. **The VTT resolves the game.** The goal is a tactics game run by a game
   master: the GM prepares the adventure's maps, enemies, non-player
   characters, abilities and challenges, players build characters by the
   rules, and in combat the VTT works out who can act, what an ability
   reaches, the rolls, the damage and the conditions, and applies them. The
   GM can always overrule a result. Phases 1 to 8 build the board this
   needs; phases 9 to 14 build the game on it. The Insulam system is to
   live in the VTT. [INSULAM_INTEGRATION.md](INSULAM_INTEGRATION.md) still
   describes the earlier arrangement, in which the VTT never holds Insulam
   rules, and is rewritten when phase 10 starts.
6. **Movement limits are advisory until the VTT runs the turn.** Reach is
   highlighted for everyone, and a token can still be put down outside it.
   Refusing a move belongs with combat resolution (phase 14), where the
   server knows whose turn it is; the reach module moves to shared code then.
   The DM is never limited.
7. **Hidden things stay hidden.** Until the isometric view draws fog and
   dynamic lighting (phase 8), a player is offered it only on a map with
   neither, and is returned to the top-down view if either is switched on.
   The DM, who sees everything, may use it on any map.
8. **Shared maths is shared code.** Reach and timeline rules live in
   `utils/rules/` in both projects, byte-identical, under the existing parity
   test.

## Phases

### The board

| # | Phase | What ships | Main files |
| --- | --- | --- | --- |
| 0 | Plan | This page. | `docs/TACTICAL_MODE.md` |
| 1 | Geometry core | Pure, tested modules: the height grid type, cell-to-screen projection with height and camera rotation, draw order, and screen-to-cell picking. No visible change. | `frontend/src/components/campaign/map/iso/` |
| 2 | Height data | The `Map.tileHeights` column and migration, validation, a DM route and a socket event to set heights, and the API and event documentation. | `backend/prisma/`, `backend/src/routes/maps.ts`, `backend/src/validators/`, `backend/docs/` |
| 3 | Isometric view | A view switch and camera rotation on the map. Terrain as raised tiles with the map picture on top, grid, and tokens as upright markers. Picking, so tokens can be moved in this view. | `MapView.tsx`, `TacticalMapCanvas.tsx`, `map/iso/` |
| 4 | Height brush | A DM tool to raise, lower, flatten and fill cells, with undo. | `map/tools/` |
| 5 | Movement reach | Move and Jump values on a token, the reach flood fill, highlighted cells and a path preview while a token is carried. | `map/iso/reach.ts`, `map/iso/tacticalStats.ts` |
| 6 | Turn timeline | A speed-based ordering mode for the initiative tracker with a preview of upcoming turns. | `utils/rules/turnTimeline.ts`, `InitiativeTracker.tsx`, `initiativeState.ts` |
| 7 | Facing and attack geometry | Four-way facing with front, side and back arcs, a range template with minimum, maximum and vertical tolerance, and a height-difference readout. | `map/iso/`, `map/layers/drawOverlays.ts` |
| 8 | Turn flow and finish | The move, act and wait action bar, fog and dynamic lighting in the isometric view, and the DM and player guides. | `components/campaign/`, `docs/` |

### The game on the board

| # | Phase | What ships |
| --- | --- | --- |
| 9 | Rules engine core | A system-neutral engine, shared by browser and server: dice and tests, resources, conditions with durations, and effects that an ability applies to its targets. The server is the one that rolls and applies. |
| 10 | The Insulam system | Insulam as a game system of the VTT: the character sheet, character creation by the rules, and the values combat reads from a sheet. |
| 11 | Abilities | Abilities as data: cost, range, area, targets and effects. A catalogue for the system, and an editor for the GM's own. |
| 12 | Enemies and non-player characters | Tactical stat blocks with abilities and behaviour notes, a bestiary, and placing them on a map ready to fight. |
| 13 | Adventures | An adventure as an ordered set of prepared maps and encounters, with objectives and challenges, that the GM runs scene by scene. |
| 14 | Combat resolution | On a unit's turn: choose an ability, see valid targets and the area, confirm, and the server rolls, applies damage and conditions and writes the result to the log. The GM can adjust or undo. |

### Open decisions

Phases 5 to 7 can proceed with numbers the GM sets by hand. Phases 9 to 14
cannot start until the owner of the game settles these:

1. **Which rules text is the Insulam system.** Two versions exist and differ
   in how a character is built and how space is measured.
2. **How the rules' distances become cells.** Cell size, what one unit of
   movement covers, and how height counts towards range and movement.
3. **Where Insulam content lives.** This repository is public and AGPL. The
   engine can be public while the game's own content (rules text, ability
   catalogue, bestiary) is loaded from a private package, or the content can
   be published here.

Every phase carries its own tests, updates the documentation it touches in the
same pull request, and must pass the full CI run before it merges.

## Status

| Phase | State |
| --- | --- |
| 0 Plan | Done |
| 1 Geometry core | Done: `map/iso/heightGrid.ts`, `map/iso/projection.ts` |
| 2 Height data | Done: `Map.tileHeights`, `GET` and `PUT /maps/:id/heights`, the `heights:replaced` event, carried through resize, export and import |
| 3 Isometric view | Done: `MapView.tsx` switches between `MapCanvas` and `TacticalMapCanvas.tsx`, drawn by `map/iso/drawIsoScene.ts`. No fog, lighting, hit point bars or token menu in this view yet |
| 4 Height brush | Done: raise, lower and level brushes with undo in `TacticalMapCanvas.tsx`, from `map/iso/heightBrush.ts` and `map/iso/useHeightBrush.ts` |
| 5 Movement reach | Done: Move and Jump in a token's `metadata.tactical`, set by the DM with a right click; `map/iso/reach.ts` works out the reach and the path |
| 6 to 8 | Not started |
| 9 to 14 | Not started; blocked on the open decisions above |
