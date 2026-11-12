# Tactical mode

A plan for a tactics game run by a game master, with the look of classic
tactical RPGs and the rules of Dungeons & Dragons, fifth edition, as revised
in 2024 ("5.5e"). First the board: a diamond grid with tile elevation, a
rotating camera, and movement that respects height. Then the game on it:
characters built by the rules, actions and spells, monsters, prepared
adventures, and combat the VTT resolves.

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
| Facing | Units face one of four directions. Attacks from the side or the back are stronger, so every turn ends by choosing a facing. | Not used: the chosen rules have no facing. A token's `rotation` stays cosmetic. |
| Turn timeline | Each unit gains charge every tick according to its speed and acts at a threshold, so fast units act more often. The upcoming order is shown as a list. | Not used: turns follow the rules' initiative order, which the tracker already keeps. |
| Turn flow | Move, act, then wait and face, in either order for the first two. | An action bar for the token whose turn it is, with what the rules give a turn: movement, an action, a bonus action and a reaction. |

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
5. **The VTT resolves the game, by the D&D rules.** The goal is a tactics
   game run by a game master: the GM prepares the adventure's maps, monsters,
   non-player characters and challenges, players build characters by the
   rules, and in combat the VTT works out who can act, what an action
   reaches, the rolls, the damage and the conditions, and applies them. The
   GM can always overrule a result. The rules are D&D's 2024 revision, on
   top of the D&D 5e system the VTT already has (sheets, attacks, spells,
   conditions, the creature library). Insulam's own rules are not
   implemented; [INSULAM_INTEGRATION.md](INSULAM_INTEGRATION.md) is
   unaffected.
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
| 6 | Movement by the rules | Speed read from the character sheet or stat block and turned into squares, eight-way movement with the map's diagonal rule, slopes, climbs and drops by height. The reach and its cost in feet. | `map/iso/reach.ts`, `map/iso/tacticalStats.ts` |
| 7 | The turn | What a creature has spent this turn, kept by the server beside the initiative order: movement, action, bonus action and reaction. An action bar in the tactical view, with Dash, Disengage and the other standard actions that change movement. | `initiativeState.ts`, `InitiativeTracker.tsx`, `TacticalMapCanvas.tsx` |
| 8 | Reach, range and cover | Whether a target is within a weapon's reach or range, long range, line of sight over raised ground, cover from terrain, and the rules' areas of effect drawn on the tactical board. | `map/iso/`, `map/aoeGeometry.ts` |

### The game on the board

| # | Phase | What ships |
| --- | --- | --- |
| 9 | Rules engine | On the server: d20 tests with advantage and disadvantage, attack rolls against Armor Class, saving throws against a DC, damage by type with resistance, vulnerability and immunity, critical hits, temporary hit points, the conditions with their durations, concentration, and death saving throws. |
| 10 | Actions as data | What a creature can do, in a form the engine can run: weapon attacks from the sheet, spells, and monster actions, each with its cost in the turn, range, area, targets and effects. An editor for the GM's own. |
| 11 | Characters by the rules | Guided character creation and levelling that fills in the existing D&D 5e sheet: species, background, class and level choices. |
| 12 | Monsters | Stat blocks from the 2024 rules' reference document, ready to act in combat. The creature library imports the 2014 one today. |
| 13 | Adventures | An adventure as an ordered set of prepared maps and encounters, with objectives and challenges, that the GM runs scene by scene. |
| 14 | Combat resolution | On a creature's turn: choose an action, see valid targets and the area, confirm, and the server rolls, applies damage and conditions and writes the result to the log. The GM can adjust or undo. Fog and dynamic lighting in the tactical view. |

### The rules and what may be shipped

Wizards of the Coast publishes the core of the 2024 rules as the System
Reference Document 5.2, under the Creative Commons Attribution 4.0 licence.
That document is the only source of rules content for this project: the
rules of play, and the species, backgrounds, classes, spells, equipment and
monsters it contains, credited as [SRD_ATTRIBUTION.md](../SRD_ATTRIBUTION.md)
does for the 2014 document today. Anything printed only in the rulebooks
themselves (most subclasses and backgrounds, many spells and monsters) is not
in it and is not shipped. A GM can still enter such things by hand for their
own table, as with any homebrew.

### Where the rules meet the board

The rules measure in feet and say little about height on a grid, so the VTT
fixes these conventions. Each is a default the GM can see and, where it
matters, change per map.

- **Squares.** A square is the map's own scale, 5 feet unless the map says
  otherwise. Speed in feet becomes squares at that scale.
- **Diagonals.** A token moves in eight directions, and a diagonal costs
  what the map's diagonal setting says: always one square, or alternately
  one and two.
- **Height.** One height step is half a square (2.5 feet at the usual
  scale). A rise or drop of one step between neighbouring squares is a slope
  or a stair and costs nothing extra. A larger one is a climb: each extra
  foot costs a foot more, as the rules say of climbing.
- **Falls.** A drop of 10 feet or more can be jumped instead of climbed; the
  view warns of the fall and its damage.
- **Turn order.** Initiative, as the tracker keeps it. No facing.

## Status

| Phase | State |
| --- | --- |
| 0 Plan | Done |
| 1 Geometry core | Done: `map/iso/heightGrid.ts`, `map/iso/projection.ts` |
| 2 Height data | Done: `Map.tileHeights`, `GET` and `PUT /maps/:id/heights`, the `heights:replaced` event, carried through resize, export and import |
| 3 Isometric view | Done: `MapView.tsx` switches between `MapCanvas` and `TacticalMapCanvas.tsx`, drawn by `map/iso/drawIsoScene.ts`. No fog, lighting, hit point bars or token menu in this view yet |
| 4 Height brush | Done: raise, lower and level brushes with undo in `TacticalMapCanvas.tsx`, from `map/iso/heightBrush.ts` and `map/iso/useHeightBrush.ts` |
| 5 Movement reach | Done, then reworked by phase 6: the reach flood fill, highlighted cells and path preview |
| 6 Movement by the rules | Done: speed from the stat block or set on the token, eight-way movement with the map's diagonal rule, slopes, climbs and falls, in `map/iso/reach.ts`. Replaces phase 5's Move and Jump. Player character speed is set by hand until the server reads sheets |
| 7 The turn | Done: `turn` and `reactionsSpent` in the combat state, the `turn.update` and `turn.end` events, and `TurnBar.tsx` under the map. Movement is counted for moves in the tactical view. Counts are kept, not enforced |
| 8 to 14 | Not started |
