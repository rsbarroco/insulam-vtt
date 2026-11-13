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
| 8 | Distance, sight and cover | The distance between two creatures in feet, whether one can see the other over raised ground, and the cover the ground and other creatures give, shown while a token is carried over a target. Weapon ranges and areas of effect come with actions as data (phase 10) and combat resolution (phase 14). | `map/iso/sight.ts`, `TacticalMapCanvas.tsx` |

### The game on the board

| # | Phase | What ships |
| --- | --- | --- |
| 9 | Rules engine | On the server: d20 tests with advantage and disadvantage, attack rolls against Armor Class, saving throws against a DC, damage by type with resistance, vulnerability and immunity, critical hits, temporary hit points, the conditions with their durations, concentration, and death saving throws. |
| 10 | Actions as data | What a creature can do, in a form the engine can run: weapon attacks from the sheet, spells, and monster actions, each with its cost in the turn, range, area, targets and effects. An editor for the GM's own. |
| 11 | Characters by the rules | Guided character creation and levelling that fills in the existing D&D 5e sheet: species, background, class and level choices. Gestalt by default, with house rules a campaign switches on (see below). |
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

### Character creation: gestalt and house rules

Characters are built gestalt by default: at each level a character advances
in two classes at once and has the features of both. The fifth edition has no
official gestalt rule, so the VTT fixes one, and a campaign can turn gestalt
off for ordinary single-class characters.

- **Hit points** use the larger of the two classes' Hit Dice, once.
- **Proficiencies** are those of both classes; saving throws are the two each
  class gives at level 1.
- **Nothing doubles** that both classes give at the same level: one Ability
  Score Improvement or feat per level, and Extra Attack does not stack.
- **Spell slots** follow the multiclass table for the sum of both classes'
  caster levels, never above the character's level.
- **Multiclassing** within either track stays as the rules have it.

On top of that a campaign has house rules, each a switch in the campaign's
settings that character creation obeys. They are on by default, and a
campaign that wants the rules as written turns them off.

- **Ability scores go to 22**, not 20.
- **Every fourth level gives both a feat and +2 to ability scores** (+2 to
  one score or +1 to two), at character levels 4, 8, 12, 16 and 20, in place
  of the choice between the two. A feat's own +1 to a score still applies.
  The extra improvements some classes get at other levels give the same
  pair. Gestalt does not double it: one such gain per level.
- **Background ability scores are unlinked.** The increases a background
  gives go to any scores the player chooses.
- **The background's feat is free.** A character takes any origin feat,
  whatever the background.

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
- **Distance.** Between two creatures: the squares between their nearest
  edges, counted by the map's diagonal setting, or the difference in the
  height of the ground they stand on if that is the greater.
- **Areas.** A square is in an area when its centre is. A Sphere or Cylinder
  is centred on the creature aimed at. A Cone or Line starts at the middle of
  the caster and points at the creature aimed at; a Cone is as wide as it is
  long, a Line one square wide, and neither covers the caster's own squares.
  A Cube is placed around the creature aimed at. An Emanation reaches its
  size from the caster's edges. Heights are not counted.
- **Sight and cover.** A creature stands two height steps tall for each
  square of its size. Lines run from the top of the attacker to four heights
  on the target. Ground that rises above a line blocks it. None blocked is no
  cover, one or two is half cover, three is three-quarters cover, and four is
  total cover: the target cannot be seen. Another creature in the way gives
  at least half cover, as the rules say.
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
| 8 Distance, sight and cover | Done: `map/iso/sight.ts`, shown as a line and a hint while a token is carried over another. Walls from the top-down view are not counted |
| 9 Rules engine | Done as a library: `backend/src/rules/dnd/` (D20 Tests, attacks and cover, saves, damage and healing, conditions, death saves). Phase 14 puts it behind combat, starting with the attack roll resolution. The text of the rules themselves ("Playing the Game" and the "Rules Glossary" of the SRD 5.2.1) is in `data/srd-5.2.1-rules.json` (built by `scripts/srd-rules.py`, read by `rulesText.ts`), served by `GET /api/campaigns/{campaignId}/rules/dnd/reference` and looked up in the **Rules of play** panel (`components/campaign/RulesReference.tsx`). Of the standard actions the VTT applies Attack, Magic, Dash and Dodge (`dodging` in the combat state, read by `conditions.ts` into attack rolls and Dexterity saving throws). Opportunity Attacks are offered when the acting combatant moves out of an enemy's reach (`opportunity.ts`, `opportunities` in the combat state, `combat.attack` with `opportunity: true`), and Disengage stops them. Ability checks are rolled by the server against a DC (`checks.ts`, `combat.check`, the **Check** panel of the turn bar), which is how the Hide action is taken and how Search, Study and Influence are rolled; `combat.actions` gives a creature's passive Perception. On a lit map an attack and an Opportunity Attack ask whether each side can see the other (`creatureSees` in `utils/spirit-layer.ts`, on the shared `visibilityRule.ts`): darkness gives Disadvantage or Advantage. The 38 weapons of the reference document are in `utils/srdWeapons.ts` (the same file on both sides, written by `scripts/srd-weapons.py`): the sheet editor adds one as an attack, a sheet attack named after one takes its properties, and a Heavy weapon gives Disadvantage under 13. Of the masteries, Topple, Push and Graze are applied for an attack the sheet marks `useMastery` when its character has Weapon Mastery (`masteries.ts`); Sap, Slow and Vex are kept in the combat state as `marks` until used or run out; Cleave and Nick are not applied yet. Every creature has the Unarmed Strike among its actions (`unarmed.ts`): damage, Grapple, and Shove to knock Prone or push. Rests are resolved for a character's sheet (`rests.ts`, `combat.rest`, the roster's character menu): a Short Rest spends a Hit Point Die and heals, a Long Rest restores Hit Points, Hit Point Dice and spell slots and eases Exhaustion. Still to do from that text: Help and Ready (recorded by name only), features that come back on a rest, ending a grapple when the grappler is Incapacitated or moved away, knocking a creature out, ending Invisible when a hidden creature is found or attacks, Heroic Inspiration, jumping (Difficult Terrain is painted by the DM and stored with the tile heights as `difficult`, and costs a foot more for each foot in `reach.ts`; a fall's damage and Prone are applied: `falling.ts`, `combat.fall`, sent by the tactical view when a move drops 10 feet or more; a Prone creature crawls and stands up for half its Speed with `combat.stand`, and conditions that leave a Speed of 0 stop movement), ability checks, grappling and shoving, and rests |
| 10 Actions as data | Part done: `backend/src/rules/dnd/actions.ts` reads a sheet's attacks and a stat block's actions (attack rolls, saving throws, damage, defences) in the 2014 and 2024 wording. `spells.ts` holds the 339 spells of the SRD 5.2.1 (`data/srd-5.2.1-spells.json`, built by `scripts/srd-spells.py`) and reads each one's attack, saving throw, damage, area and scaling; a sheet's cantrips and prepared spells are listed among its combat actions, and the ones with an attack roll can be cast through `combat.attack`. Still to do: a spell browser in the sheet, and an editor for the GM's own actions |
| 11 Characters by the rules | Part done: the campaign's switches (`Campaign.characterRules`, `utils/characterRules.ts`, the Characters tab of Campaign Settings) and the numbers a build needs in `backend/src/rules/dnd/advancement.ts` (Hit Dice and hit points, saving throws, feats and ability score points by level, spell slots, for one class or two). The backgrounds, species and feats of the reference document are in `data/srd-5.2.1-origins.json` (built by `scripts/srd-origins.py`), read by `origins.ts`, which also decides what the house rules change about an origin. The twelve classes are in `data/srd-5.2.1-classes.json` (built by `scripts/srd-classes.py`), read by `classes.ts`: core traits, the columns of each features table, features by level, Metamagic and Eldritch Invocation options and one subclass each; a test holds `advancement.ts` to the document's own tables. `buildCharacter.ts` checks a character's choices against the campaign's rules and works out the D&D 5e sheet they make, and `routes/rules.ts` serves the catalogue (`GET /api/campaigns/{campaignId}/rules/dnd`) and the builder (`POST …/rules/dnd/build`) to a campaign set to D&D 5e. The builder does not work out equipment, Armor Class beyond 10 + Dexterity, the numbers a species trait or a feature changes, or which spells are known. The New Character dialog offers it as **Build by the campaign's rules** (`components/character/dnd/`). Still to do: levelling an existing character up, equipment, known spells, and content beyond the reference document |
| 12 Monsters of the reference document | Done: the 330 stat blocks of the SRD 5.2.1 are in `backend/src/rules/dnd/data/srd-5.2.1-monsters.json` (built by `scripts/srd-monsters.py`, read by `monsters.ts`), and the creature library is filled from them (`services/creatureSeed.ts`) in place of the 2014 creatures it used to fetch |
| 13 | Not started |
| 14 Combat resolution | Part done: attack rolls and saving throws. `backend/src/rules/dnd/resolveAttack.ts` and `resolveSave.ts` decide them, and `websocket/handlers/combat.ts` (`combat.actions`, `combat.attack`, `combat.save`) applies the damage and logs the roll; `AttackMenu.tsx` asks for them in the tactical view. Distance and cover are in `utils/boardSight.ts`, the same file on both sides. Casting a levelled spell spends a spell slot of the level chosen. An effect with an area is aimed at a creature: `utils/boardArea.ts` finds the squares it covers and the menu sends everyone standing in them. `featureEffects.ts` reads from a sheet's features how many attacks the Attack action makes (Extra Attack) and which features cost a Bonus Action or a Reaction; the turn counts attacks and offers those features. Death saving throws are rolled by `combat.deathSave` and marked by damage at 0 Hit Points. Class features with uses are counted on the sheet (`resources.ts`, `featureUses`): Second Wind heals and Action Surge gives the action back through `combat.feature`, and rests give the uses back. Rage is applied as a `rage` mark (resistance, Rage Damage, Strength Advantage, no spells). Still to do: Sneak Attack, other features' effects, aiming an area at an empty square, conditions applied by an action, undo, and fog and lighting in the tactical view |
