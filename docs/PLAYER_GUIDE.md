# CozyVTT Player Guide

Welcome, adventurer! This guide will get you from "I got an invitation link" to "I'm rolling dice with my friends" as quickly and painlessly as possible.

No technical knowledge required. Let's go.

---

## Table of Contents

1. [Getting Your Account](#getting-your-account)
2. [Accepting a Campaign Invitation](#accepting-a-campaign-invitation)
3. [Creating Your Character](#creating-your-character)
4. [The Campaign Page](#the-campaign-page)
5. [Chat and Dice](#chat-and-dice)
6. [Moving Your Token](#moving-your-token)
7. [Measuring and Spell Areas](#measuring-and-spell-areas)
8. [The Initiative Tracker](#the-initiative-tracker)
9. [The Vibe Tracker](#the-vibe-tracker)
10. [Managing Your Characters](#managing-your-characters)
11. [Your Profile](#your-profile)
12. [Quick Reference](#quick-reference)

---

## Getting Your Account

Your platform administrator (or your DM, if they're also the admin) sets up your account. Depending on how their instance is configured, you'll get one of two things by email.

**If you receive an invitation link** (most common):

1. Click **Accept Invitation** in the email
2. Choose your own password — nobody else ever sees it
3. Sign in with your email and that password

The link is valid for **7 days**. If it expires, ask your administrator to send another.

**If you receive a temporary password instead:**

1. Go to the CozyVTT URL
2. Sign in with your email and the temporary password
3. You'll be asked immediately to choose your own password — this is required, and until you do, the temporary one won't get you anywhere else in the app

Either way you end up with a password only you know. Pick something you'll actually remember.

*Screenshot pending — Login page.*

> **Tip:** Head to your [Profile](#your-profile) right away to upload a photo and set your display name. Your DM and fellow players will see it everywhere.

---

## Accepting a Campaign Invitation

Your DM invites you by typing part of your display name into a search and picking your account from the people who match. Two people can have the same display name, and your profile picture is how your DM tells you apart. Here's what happens next:

1. **Log in** to CozyVTT
2. On your **Dashboard**, a **Pending Invitations** section appears below the Your Characters, Asset Library, Documents and Character Templates cards. An invitation sent while the dashboard is open shows up when you come back to the tab, or within a minute
3. Each invitation shows the campaign name and, after **DM:**, who runs the campaign
4. Click **View Invitation →** to open it. Tick the characters you want to bring, if you have any created already, then click **Accept Invitation**. Only characters of the campaign's game system are offered, and only ones not already in a campaign: a D&D 5e campaign takes D&D 5e characters, and a campaign set to Flexible takes Flexible characters
5. Or click **Decline** if it's not for you. An invitation runs out after 14 days, and the DM can withdraw it before you answer; either way it leaves your dashboard

*Screenshot pending — Pending invitations section.*

If you haven't created a character yet, you can accept the invitation without one and assign a character later. Jump to [Creating Your Character](#creating-your-character) and come back.

Once you've accepted, the campaign appears under **Your Campaigns** on the dashboard. Click it anytime to enter the campaign.

---

## Creating Your Character

Before you can fully participate in a campaign, you'll want a character. On your dashboard, click **Manage** beside **Your Characters** to get to your character library.

*Screenshot pending — Characters page (empty state).*

### Step 1: Start a New Character

Click **Create Character**. A dialog pops up asking you to choose a **Game System** — this determines which character sheet you'll fill out.

Ask your DM which system you're playing:

| System | What it's for |
|--------|--------------|
| D&D 5e | Dungeons & Dragons 5th Edition |
| Pathfinder 2e | Pathfinder 2nd Edition |
| Call of Cthulhu 7e | Horror and investigation (Lovecraftian) |
| Flexible | Homebrew or rules-light systems |

*Screenshot pending — New character dialog with game system options.*

### Step 2: Fill Out Your Sheet

Give your character a name and click **Create Character**. The dialog closes, **Character created successfully!** appears, and the new character is on your Characters page. Choose **Edit Character** from its card's menu (**⋮**) to open the **Character Editor**. This is your character sheet — fill it out just like you would on paper.

**Building a D&D character by the rules.** If you choose a campaign set to D&D 5e, a third option appears under the templates: **Build by the campaign's rules**. Instead of an empty sheet you make the choices and the VTT fills the sheet in:

- a **species** and a **background**, with the background's ability score increases (+2 and +1, or +1 to three) and an **origin feat**
- a **class**, and a **second class** if your campaign builds gestalt characters, which advance in two classes at once
- a **level**, from 1 to 20
- the six **ability scores** before anything is added, from 3 to 18: roll them, buy them or use **Standard array**, as your table does. Under each box is the score with everything added
- the **skills** your class lets you choose
- for each level that gives one, a **feat** and where its ability score points go. Pick the same ability twice to add 2 to it
- under **Feature options**, the option of each feature that offers several, at the level it comes (a Fighting Style feat, Hunter's Prey, Metamagic, Eldritch Invocations and the rest below), and under the species a Dragonborn's ancestor or a Tiefling's legacy

What you are offered follows your campaign's own rules, which the line at the top of the form sums up: a campaign may let a background raise any ability scores, let you take any origin feat, raise scores to 22, or give a feat and +2 at every fourth level. If something is missing or not allowed, **Create Character** says what, and nothing is created until it is right.

The sheet comes filled in with your scores, Hit Points, saving throws, skills, spell slots, and the traits, feats and class features written out. It does not choose your equipment or your spells, and Armor Class starts at 10 plus Dexterity: set those in the Character Editor. The species, backgrounds, feats and classes are those of the System Reference Document 5.2.1.

<a id="feature-options"></a>**Feature options.** The VTT reads the option you took from the **name** of the feature on your sheet. The builder writes these names for you. On a sheet you already have, the editor's Features & Traits list shows a select beside a feature that has options (for a character in a D&D 5e campaign): pick the option and the name is rewritten, the description kept. To change an option after a rest, change it there. You can also type the names yourself:

| Feature | Options | Name on the sheet |
|---|---|---|
| Dragonborn: Draconic Ancestry | Black … White | species `Dragonborn (Red)` |
| Tiefling: Fiendish Legacy | Abyssal, Chthonic, Infernal | species `Tiefling (Infernal)` |
| Cleric 7: Blessed Strikes | Divine Strike, Potent Spellcasting | `Blessed Strikes: Divine Strike (Cleric 7)` |
| Druid 3, Circle of the Land: the land | Arid, Polar, Temperate, Tropical | `Circle of the Land Spells: Polar (Druid 3)` (or `Nature's Ward (Polar)`) |
| Druid 7: Elemental Fury | Potent Spellcasting, Primal Strike | `Elemental Fury: Primal Strike (Druid 7)` |
| Fighter 1 and 7, Paladin 2, Ranger 2: Fighting Style | a Fighting Style feat; Blessed Warrior or Druidic Warrior | `Archery (Fighting Style feat)`, `Fighting Style: Blessed Warrior (Paladin 2)` |
| Ranger 3, Hunter: Hunter's Prey | Colossus Slayer, Horde Breaker | `Hunter’s Prey: Colossus Slayer (Ranger 3)` |
| Ranger 7, Hunter: Defensive Tactics | Escape the Horde, Multiattack Defense | `Defensive Tactics: Escape the Horde (Ranger 7)` |
| Sorcerer 2, 10, 17: Metamagic | two options each time | `Metamagic: Careful Spell`, one feature each |
| Sorcerer 6, Draconic: Elemental Affinity | Acid, Cold, Fire, Lightning, Poison | `Elemental Affinity: Fire (Sorcerer 6)` |
| Warlock: Eldritch Invocations | as many as the Warlock table gives | the invocation's name, one feature each: `Devil’s Sight`; with its cantrip `Agonizing Blast (Eldritch Blast)`, `Repelling Blast (Eldritch Blast)`; with the pact weapon `Pact of the Blade (Longsword)` |
| Warlock 10, Fiend: Fiendish Resilience | any damage type but Force | `Fiendish Resilience (Fire)`, nothing after the brackets |
| Boon of Irresistible Offense | the score it raised | `Boon of Irresistible Offense (Dexterity)`; the builder takes it from the boon's point |

A feature whose option is not named works as far as it can without it, and the rest is your table's, as before.

*Screenshot pending — Character editor (D&D 5e example).*

The sheet is split into sections depending on the system. Take your time — you can save partial work and come back. The header shows the last time you saved.

**A few things to know:**
- Click **Save** regularly. There's no auto-save and no keyboard shortcut — the header shows the time of your last save
- Leaving with unsaved changes asks you to confirm first, whether you use the back arrow or close the tab. Confirm and those changes are gone
- **Export** in the editor's header saves a local JSON backup of your character

### Step 3: Add a Profile Image (Optional)

Want your token on the map to look like your character? The sheet editor has a token image: pick a picture, and it is uploaded when you save and becomes your token's art when your DM places you on the map.

### Step 4: Assign to Your Campaign

Once your character is created, you'll need to assign them to your campaign so the DM can see them in the roster and place their token on the map.

From the **Characters** page:
1. Find your character card
2. Open the card's menu (**⋮**) and choose **Assign to Campaign**
3. Select the campaign you want to assign them to

*GIF pending — Assigning a character to a campaign.*

Your DM will see the character in the campaign roster and can place your token on the map.

---

## The Campaign Page

Click your campaign from the dashboard to enter it. This is where the action happens.

*Screenshot pending — Full campaign page with labeled sections.*

The page has three main areas:

### Left Sidebar — Campaign Info
- Campaign name and description at the top
- The **Campaign Roster** showing all players and their characters
- A small dot beside each person shows whether they're **in session** right now — green if they're connected, grey if not. Handy for telling "thinking" apart from "their internet fell over"
- A character with hit points on its sheet shows a bar on its card, with the current and maximum beside it. On your own character you also get a row of buttons to change them: **−5**, **−** (one down), **+** (one up) and **+5**. Your DM has them on every character. The minus buttons are damage, so in D&D 5e and Pathfinder 2e your temporary hit points go first
- Click a character to read its sheet. Right-click one for a menu: **View Character Sheet** for anyone's character, and for your own **Roll...**, **Edit Character Sheet** and **Remove from Campaign**, which takes the character out of the campaign and keeps it in your library
- If you're curious about your fellow adventurers, it's all here

### Center — The Map
This is the battle map. During a session, you'll see your token here and can move it: click it to pick it up, then click where it should go ([Moving Your Token](#moving-your-token)). The toolbar at its top left zooms and fits the view, and you move the view by dragging an empty part of the map ([Moving Around the Map](USER_GUIDE.md#moving-around-the-map)).

### Right Sidebar — Your Tools
A tabbed panel — click a tab to switch between:
- **Chat** — Talk to everyone (an unread badge shows on the tab when messages arrive while you're on another tab)
- **Dice** — Roll your dice
- **Initiative** — See the turn order during combat
- **Notes** — Your own private notes (see [Your Own Notes](#your-own-notes))
- **Session** — The vibe and past sessions (the Live / Paused badge is in the header)

You can also drag the divider to resize the sidebar, or collapse it to give the map more room.

### The Header Bar
The top bar shows:
- Campaign name, a **Live** or **Paused** badge while a session is running or paused, and the current vibe
- Connection indicator — a dot that goes green when you're connected
- A **book icon** — the rulebooks and handouts your DM has shared with this campaign
- Navigation controls

*Screenshot pending — Campaign header with status indicators.*

### Rulebooks and Handouts

Press the **book icon** in the header to see what your DM has shared with the campaign: a rulebook, a page of house rules, a handout for the scene. **Read** opens it in a full-screen reader over the map, and the arrow beside it opens it in a new browser tab, handy for keeping the rules up on a second screen while you play. Only Firefox on a computer shows a PDF inside the reader. In Chrome, Edge, Safari and on a phone the reader offers **Open this PDF in a new tab** instead, as the arrow does.

You can read everything on that list and nothing that is not on it. Sharing is the DM's to do, so if a rulebook you expected is missing, ask them. If your DM edits a shared document, you see the new text the next time you open it.

You can keep documents of your own too, from **Documents** on your dashboard: upload a PDF, or write text or Markdown notes and edit them later. Those are yours alone unless a DM shares one with a campaign.

### Looking a Rule Up

Press the **scales icon** in the header for the **Rules of play**: how the game is played and the rules glossary of the D&D System Reference Document 5.2.1, word for word. Type in the search box to find a rule (**opportunity attack**, **prone**, **cover**, **falling**); headings that match come first, then every rule that mentions the words, with the sentence they are in. Without a search you go through the headings, and opening one shows everything set under it, so **Combat** reads as the whole section. The icon is there in a campaign set to D&D 5e or to no system.

### Connection Status

When you first load the campaign page, CozyVTT connects to the live session. Look for the **connection indicator** in the header — it turns green when you're successfully connected. If you see a loading spinner, just wait a moment.

If you lose connection (WiFi hiccup, a server restart), CozyVTT keeps trying to reconnect by itself for as long as it takes: every few seconds at first, then every 30 seconds, and at once when you come back to the tab. The indicator shows **Connecting...** while it tries. When it shows **Disconnected** or **Connection Error** in red, the **Retry** button beside it tries straight away.

### If your DM hands you the game

A campaign has one DM, but that can be passed on — when a DM steps back, hands
over to a co-DM, or wants someone else to run a session. If it is passed to you,
your screen changes on the spot: you do not need to reload, and nothing about
your character changes. You keep it, and you can still play it.

What you gain is the DM's side of the campaign — the map, token, creature and
settings controls appear in the top bar, and the campaign's roster shows you as
the Dungeon Master. The person who handed it over becomes an ordinary player.

**Handing it back** is the same action in reverse: **Campaign Settings →
Members**, then the crown beside their name. If the campaign was originally
theirs they can also take it back themselves, so nobody is ever stranded.

If this happens unexpectedly, it is worth asking your DM — it is a deliberate
action somebody took, not something that happens on its own.

---

## Chat and Dice

Chat and dice are your two most-used tools. They each have their own tab in the right sidebar, one click apart during a session.

### The Chat Panel

*Screenshot pending — Chat panel with a few messages.*

Type your message in the input box at the bottom and press **Enter** to send. Your display name appears next to your messages.

Chat is for everything: in-character dialogue, out-of-character coordination, questions for the DM, celebrations when you roll a nat 20.

**Chat tips:**
- **System messages** (gray, slightly different style) announce session events like a session starting, pausing or ending
- **Dice results** appear in the **Dice** panel, the tab beside chat, not in the conversation itself
- Scroll up to read the history — the full session log is preserved
- A message that doesn't get through, because the connection dropped or the chat cooldown is still running, is marked **Not sent**. **Retry** sends it again, and a message that did get through after all is not posted twice if you retry within ten minutes; **Discard** removes it

### The Dice Roller

*Screenshot pending — Dice roller panel.*

Under **Quick Roll**, click **d4**, **d6**, **d8**, **d10**, **d12**, **d20** or **d100** to roll that die. **Adv** and **Dis** roll a d20 with advantage or disadvantage, and **4d6kh3** rolls four d6 and keeps the highest three. Your result appears in the **Dice** panel immediately, where everyone at the table can see it. A roll you make from your sheet, the roster or the map's **Roll...** menu lands there too; if one doesn't go through, a message says why.

**Rolling custom expressions:**
Type directly into the expression input and press **Enter** or **Roll**. The optional **Character** and **Purpose** boxes under it put a name and a note on the roll for everyone to read, such as "Goblin" and "Scimitar damage", and the circular-arrow button beside **Roll** (**Clear all fields**) empties all the boxes. Supported notation:

| Expression | What it does |
|-----------|-------------|
| `d20` | One d20 |
| `2d6` | Two d6s, summed |
| `d100` | Percentile roll |
| `1d20+5` | d20 plus 5 |
| `2d6-1` | 2d6 minus 1 |
| `4d6kh3` | Four d6s, keep highest three |
| `4d6kl3` | Four d6s, keep lowest three |
| `4d6dl1` | Four d6s, drop the lowest one |

One roll can hold up to 100 dice in all, dice of up to 1,000 sides, and numbers up to 9,999, and the expression can be 200 characters long. Its total must stay within about 2.1 billion either way, however the dice land, and it can never divide by something that could be zero, so `1d20/0` and `9999*9999*9999` are refused. Spaces are fine around `+`, `-`, `*` and `/`, but two terms need an operator between them: `1d20 5` is refused, where `1d20+5` is meant. Anything over those limits is refused with a message saying which, and a roll made while the session is paused follows exactly the same rules.

*GIF pending — Typing a dice expression and seeing the result in the Dice panel.*

**Saved rolls.** Some rolls aren't on your character sheet and never will be — a
homebrew subsystem your table invented, a recurring `2d6+3` for a house rule,
`4d6kh3` for rolling up a new character, an attack the sheet can't describe.
Rather than retyping those every session, save them: press **Saved** under the
dice buttons, give the roll a name and an expression, and it becomes a button of
its own. Click it and it rolls, with its name as the roll's purpose, so the
**Dice** panel shows "Longsword" and not just `1d20+5`. Whatever is in the
**Character** box goes with it, as for a typed roll.

If you have just typed something into the expression box, opening **Saved**
carries it across, so naming it is the only thing left to do.

Your list of saved rolls is **yours alone** — not even your DM can see it, only
the name of one you roll — and saved rolls stay
with the campaign you made them in, so one table's homebrew doesn't clutter
another game. You can rename, edit or delete them from the same **Saved** button,
and you can keep up to 50 per campaign. If an expression can't be rolled, CozyVTT
says so when you save it rather than letting you find out later with a button
that never works.

**Why everyone saw my roll:** Dice results are public by default — everyone sees what you rolled unless you tick **Secret Roll** first (see *Secret rolls* below). When your DM rolls secretly, nothing reaches you at all, not even a notice that they rolled.

**Your roll history sticks around.** The panel reads like the chat beside it — a running list, oldest at the top, newest at the bottom — so you can see several rolls at once instead of stepping through them one at a time. It's kept on the server, so refreshing the page, closing the tab and coming back, or losing your connection for a minute won't wipe it. Only the DM can clear it.

**Secret rolls.** Tick **Secret Roll** and your result is hidden from the other players. It still appears in your own list, marked as secret, so you can look back at it. **Your DM can see it too** — that is deliberate, so they can settle a dispute about what was actually rolled. If you would rather not have your secret rolls cluttering the list, the **Secret** button at the top of the panel, which appears once the list holds a secret roll, hides them; that only changes your own view, and nobody else's rolls are affected either way.

Nobody else's secret rolls ever reach you. Not hidden in the page — never sent to your browser at all.

One thing to know: if the DM has **paused** the session, your rolls from the **Dice** tab are worked out in your own browser and aren't sent anywhere. Handy for messing about between scenes, but those rolls vanish if you refresh. A roll from your sheet, the roster or the map's **Roll...** menu still goes to the table as usual.

---

## Moving Your Token

When the DM has placed your character's token on the map, you can move it: click the token to pick it up, move the pointer to where you want it, and click that square to put it down. Letting go of the mouse button does not put it down, so there is no need to hold it. Right-click, press **Esc**, or move the pointer off the map, to put the token back where it was. You can't move it while the session is paused or has ended.

*GIF pending — Picking up a player token and placing it across the map.*

Your movement is visible to everyone in real time — your party can watch you creep around the corner (or run straight into danger).

**Turning your token.** To show which way you're facing, right-click your token and choose **Rotate Left** or **Rotate Right**: each turns it 45 degrees, and the menu stays open so you can keep turning. Everyone sees it turn. You can turn any token the DM has made yours to control.

**When you can't move your token:**
- If the session is **Paused**, token movement is disabled until the DM resumes. If the DM pauses while you are holding your token, it goes back to where it was
- If your token hasn't been placed by the DM yet, it won't appear on the map
- If the DM has handed control of your character's token to someone else, or to nobody, it is not yours to move until they set you as its controller in **Edit Token**
- If the DM has ended the session (status shows "Inactive"), movement is disabled until the next one starts

*Screenshot pending — Paused session banner blocking movement.*

If your token is missing or in the wrong place, just let your DM know in chat — they can adjust it.

### Two creatures can't stand in the same square

Try to finish a move on a square somebody is already standing in and the move is refused, with a note saying who is in the way. That matches the rules: you can move *past* another creature, but you can't end your move on top of one.

A creature at **zero hit points** is the exception. It's drawn faded to show it's down, and you can move onto its square — the body stays there marking where it fell without getting in the way of the fight. That only works when you can see its hit points: another player's character, or a creature whose HP bar the DM has turned on. A creature whose hit points the DM keeps hidden looks standing to you until the DM removes it.

If your token ends up underneath another one anyway — your DM can place tokens wherever they like — clicking the square still picks up **your** token, not the one drawn over it. You can always get your own token back.

### The tactical view

When your DM is using a map without fog of war or dynamic lighting, a **Tactical view** button appears at the top of the map. It shows the same map from an angle, with raised ground drawn as raised tiles, the way tactical role-playing games do. **Top-down view** takes you back. The choice is yours alone; nobody else's view changes.

- **Turn the view** a quarter turn at a time with the two arrow buttons or the **Q** and **E** keys, so nothing stays hidden behind a tall tile.
- **Zoom** with the mouse wheel, **drag** to pan, and use the frame button to fit the whole map back on screen.
- **Move your token** exactly as in the top-down view: click it to pick it up, click a square to put it down, or press **Esc** to put it back.
- The bottom-left corner shows the square under your pointer and its height.
- If a token has a speed, pointing at it or picking it up tints the squares it can reach this turn in blue, and the hint counts the feet to the square you are pointing at and warns of a fall. Stepping off a drop of 10 feet or more is a fall: the VTT rolls the damage (1d6 for every 10 feet), takes it from your hit points and leaves you **Prone**. You can still put your token down outside them, on a square tinted amber; your DM decides whether that stands.

- Carry your token over another one, without putting it down, to measure: a line joins the two and the hint gives the distance from where your token stands and the cover the other has, such as "30 ft to Ogre, half cover (+2 AC)". **Esc** puts your token back.

**Attacking.** While you carry your token, right-click a creature to attack it. Choose one of the attacks from your character sheet, or a cantrip or prepared spell that makes a spell attack, and the VTT checks the reach or range and the cover, rolls the attack, and on a hit rolls the damage and takes it from the target's hit points. The result appears on screen and in the dice log. Your token stays where it stood. Spells that call for a saving throw work the same way: the VTT rolls the target's save and applies the damage. A spell with an area, such as Fireball, is aimed at the creature you right-clicked: the menu tints the squares it covers and names everyone it catches, allies included. A spell of level 1 or higher asks which spell slot to cast it with, and marks that slot as used on your sheet. **Roll with** lets you add Advantage or Disadvantage when your DM says you have it.

The ruler and spell areas are in the top-down view only for now. If the DM switches fog or lighting on while you are in the tactical view, the map goes back to the top-down view by itself.

## Your Own Notes

The **Notes** tab is yours alone. Keep up to 200 notes for a campaign — a plan for next session, what you've worked out about the villain, who owes whom money.

**Nobody else can read them.** Not the other players, and not your DM. That's enforced by the server, not just hidden from view.

**Write in Markdown.** A `#` makes a heading, `**bold**` makes bold, a `-` starts a list, and `[text](https://…)` makes a link. The eye button switches to a preview so you can see it laid out; the pencil switches back to editing.

Notes save themselves a moment after you stop typing — there's no Save button to forget. Pick between them with the dropdown at the top, and the **+** button starts a new one.

A single note can hold about fifty pages of text, so a long campaign journal is fine. If you paste in something enormous the counter under the note turns red and it won't save until you trim it.

**If you are removed from the campaign,** an open campaign page says "You were removed from this campaign." and takes you to your dashboard (if a character sheet there has unsaved changes, it stays open so you can save them first). Your notes and saved rolls for it are not deleted, and you can still read them. They appear on your dashboard under **Notes From Campaigns You Have Left**: press **Open** beside the campaign to read each note and see your saved rolls, and **Download** in that window to save them all as one Markdown file (plain text you can open in any text editor). The download fetches all the notes in one go, so with many long notes it can take a few seconds. It can be used 60 times an hour; past that it says how many minutes to wait. You can no longer change them. If you are invited back, they are in the campaign's **Notes** tab and **Saved** list again. If the campaign is deleted, they are deleted with it, so download anything you want to keep.

### Catching up on last time

The **Session** tab has a **Past Sessions** list. When your DM ends a session they can write a few lines about what happened, and those notes appear here — newest first, with the date and how long you played. It's the place to look when you've forgotten whose idea the rope was.

If a session shows no notes, your DM simply didn't write any that night.

### Pointing at a token

Hover any token and a card appears in the bottom-left with a large view of its picture, its **HP**, any **conditions** it has, and its **Initiative** if it is in the current fight. It stays useful while you are holding a token: the card follows the square under your cursor, so you can see who is already standing where you are about to land.

You will only ever see what you are meant to. Another player's hit points come from their character sheet, which you can already read. A creature's are the DM's to reveal, and appear only once they turn its HP bar on. A grey token with a question mark is something you can see but cannot make out: the DM has obscured it, and your browser is not sent its name, picture, conditions, hit points or who controls it until they reveal it. And a token standing in unrevealed fog tells you nothing at all — no name, no picture, nothing.

### Why parts of the map are dark

If your DM uses **fog of war**, most of the map starts hidden. It's how your DM keeps a dungeon from being a spoiler — you see a room when you get there, not before.

Areas open up as you explore. If your DM is using **dynamic lighting** as well, what you can see also depends on where your character is standing, which walls are in the way, and what is lit, so the view shifts as you move. Anything in bright light shows clearly. Dim light, and the dark within your character's darkvision, show half-dark. Beyond that is black, but the square you stand on is always visible, so you always know where you are. If your DM keeps **Remember Explored Areas** on for the map, places your character has already seen stay on your map, greyed and darkened, until you can see them again, so a corridor you have walked is not pitch black behind you. A light only shows you something you could actually see — a lamp burning inside a closed room tells you nothing from outside it, and whatever is in there stays hidden until you can see in.

Two things worth knowing:

- **Creatures standing in hidden areas are invisible to you** — including their tokens, and including their turn marker during combat. If the initiative tracker shows a creature you can't find on the map, that's deliberate. Something is out there. A creature the DM has hidden is not listed at all until they reveal it, and neither is one on a map the DM hasn't switched to, or on the other plane when your DM uses the spirit realm.
- **You can't reveal fog yourself.** Only the DM can, so there's nothing you can accidentally break by moving around.
- **You open and close the doors you can see.** Click a door to open or close it, or right-click it for **Open Door** or **Close Door**. With dynamic lighting on, that means a door your character can see: one in the dark, or behind a wall, can't be clicked until you can see it. With fog of war on, it means a door beside a square the DM has revealed to you. A locked door looks like any closed door until you try it, and then you are told it is locked.

### Sound and weather on the map

Your DM can start an ambient track and lay weather over the map: rain, mist, drifting leaves, sparkles, snow or wind. Both arrive on their own when your DM sets them, and stop when your DM stops them; there is nothing for you to turn on. The time of day can carry its own music too, which changes when the DM changes the vibe.

If you hear nothing, check your browser has not blocked sound for the tab. Most browsers refuse to play audio until you have clicked something on the page, so clicking anywhere in the campaign usually starts it.

---

## Measuring and Spell Areas

Two tools in the toolbar above the map answer "can I actually reach that?" before you commit to a turn. Both are private — they draw on your screen only, so nobody sees you working out whether the fireball catches your own party.

**Ruler** (the ruler icon) — measures from **your own token**, so there's nothing to click: turn it on and move the cursor, and the distance in feet follows, using the map's scale and its diagonal rule. If your DM hasn't placed your token on the map yet, the ruler has nothing to measure from and won't draw.

**AoE Shape** (the lightning icon) — draws a spell area. Pick **Circle**, **Cone**, **Line** or **Cube**, set the size in feet or use one of the presets, and move the cursor to position it. A cone has your game's shape: in D&D 5e as wide at its far end as it is long, in Pathfinder 2e a quarter circle.

For a cone or a line, **click your own token first**. That square becomes the pivot, and moving the cursor swings the shape around it — the point it comes out of slides around the square's edge to follow your aim, so it always leaves on the side you're pointing and never cuts back across you. Keep turning until you can see what the attack catches.

For something you cast at a distance rather than from yourself — a wall of fire, say — hold **Alt** while clicking. That drops the grid snapping and pins the shape exactly where you clicked, and it turns about that point instead.

Press **Esc** to drop the placement, and again to put the tool away.

Shapes cover whole squares wherever the grid allows it. A cone's spreading edges are at an angle so they'll still clip across squares — that's the shape, not a bug. Judge the edge cases the way you would at the table, and if it matters, ask your DM.

---

## The Initiative Tracker

The **Initiative** tab in the right sidebar shows the turn order. As the DM adds combatants they appear there, and when the DM clicks **Start Combat** the first one's turn begins.

*Screenshot pending — Initiative tracker during combat.*

You'll see:
- **The combatants in the fight**, in order, highest initiative first. A creature isn't listed while the DM has it hidden, while it stands on a map the DM hasn't switched to, or while it is on the other plane when your DM uses the spirit realm; one that is merely out of your sight, in the dark or under fog, is listed
- **Current turn** highlighted
- **HP** for a creature once the DM has turned its HP bar on, and for any creature token you control; it follows the token as the DM changes it. Your own character's hit points are on your sheet and roster card, not in the tracker

When it's your turn, your name is highlighted. Describe your actions in chat and move your token on the map.

**Sheets and rolls from the tracker.** Right-click a character's name in the tracker and choose **View Character Sheet** to read their sheet, or, on your own character, **Roll...** for the same rolls as right-clicking your token on the map. Double-clicking a character's name opens their sheet straight away. From the keyboard, press **Tab** until the name has the focus and press **Enter** for the menu. Creatures have nothing to open here, and neither does a character whose token is on a map the DM hasn't switched to.

### Your turn

During combat a bar under the map shows the turn of whoever is acting: the movement they have left, and whether their action, bonus action and reaction are spent. When it is **your** token's turn the bar is yours to use:

- Your **movement** goes down by itself as you move your token in the tactical view.
- When you take the Attack action the bar counts your attacks (**Attack 1 of 2** with Extra Attack), and the VTT stops you at the number your features give you.
- **Features** lists what your character can do with a Bonus Action or a Reaction, with the rule of each; **Use** marks the bonus action or reaction as spent.
- At 0 hit points, on your turn, the bar shows **Death save**: the VTT rolls it and marks the result on your sheet. A 20 puts you back up with 1 hit point.
- Pick your **action** from the list. **Dash** adds your speed to your movement for the turn. **Dodge** makes you dodge until your next turn starts: attacks the VTT rolls against you have Disadvantage and your Dexterity saving throws have Advantage, the bar and the initiative tracker say **Dodging**, and you lose it while you are Incapacitated or your Speed is 0. Picking another action instead takes the Dodge back.
- **Weapons.** In your sheet's **Edit** view, under Attacks, **Add a weapon** lists the 38 weapons of the D&D reference document. Choosing one adds an attack filled in from your sheet: Strength for a melee weapon, Dexterity for a ranged one, the better of the two for a Finesse weapon, your Proficiency Bonus if your Weapons proficiencies cover it ("Simple and Martial weapons", "Martial weapons that have the Finesse or Light property", or the weapon by name), and its properties and mastery. A Heavy weapon in the hands of a character under Strength 13 (Dexterity 13 for a ranged one) is rolled with Disadvantage.
- **Weapon masteries.** If your character has Weapon Mastery, tick **Uses its mastery** on each weapon you chose. The VTT then applies **Topple** (on a hit the target makes a Constitution save against 8 + your attack's modifier + your Proficiency Bonus, or falls Prone), **Push** (on a hit a Large or smaller target is pushed 10 feet away) and **Graze** (on a miss the target still takes damage equal to your attack's modifier), and says so in the log. In a fight the VTT also keeps **Sap** (the target's next attack roll has Disadvantage, until your next turn starts), **Slow** (its Speed is 10 feet less, until your next turn starts) and **Vex** (your next attack roll against it has Advantage, until the end of your next turn); the initiative tracker shows Sapped, Slowed or Vexed on the creature. Under a weapon in the attack menu you may also find **Cleave** (after a hit with it this turn, attack a creature within 5 feet of the first) and **Light extra attack** (after the Attack action with another Light weapon; a Bonus Action, or part of the action if one of them uses Nick). Each is once a turn and deals the weapon's damage without your ability modifier, unless you have the Two-Weapon Fighting style for the Light attack. The server refuses one the turn does not allow, and says why.
- **Darkness.** On a map with lighting on, the VTT works out whether you and your target can see each other, as the map draws it: walls, lights, Global Illumination and darkvision (your token's sight radius). Attacking a creature in darkness you cannot see into has Disadvantage; attacking one that cannot see you has Advantage; both together cancel out. Dim light does not change an attack. A creature that cannot see you in the dark is not offered an Opportunity Attack when you leave its reach.
- **Second Wind and Action Surge.** A Fighter's turn bar counts their uses. **Second Wind** in the Features panel rolls 1d10 + your level on the server, heals you and spends your Bonus Action; **Action Surge** gives you one more action (not the Magic action), once a turn. Uses come back when you rest: right-click your character in the roster and choose **Finish short rest** (one Second Wind and your Action Surge back), or your DM gives a **Long rest** (all of them). A Barbarian's turn bar has **Rage (n/m)**: a Bonus Action that gives Resistance to Bludgeoning, Piercing and Slashing damage, adds your Rage Damage to Strength attacks and gives Advantage on Strength checks and saves, and stops you casting spells. It lasts to the end of your next turn and every attack you make on your turn keeps it going; **End Rage** ends it. The tracker shows **Raging**.
- **Other classes' features with uses.** The turn bar also counts, from your class table and level: **Bardic Inspiration** (your Charisma modifier, at least 1; a Bonus Action: pick another creature within 60 feet with the **Bardic Inspiration** button, and the server keeps your die on it for an hour. When it fails an attack roll, a save or a check, its player is asked whether to roll the die and add it, which can turn the failure into a success), **Channel Divinity** (Cleric, Paladin), **Wild Shape** (Druid; a Bonus Action), **Focus Points** (Monk), **Sorcery Points** (Sorcerer) and **Favored Enemy** (Ranger: Hunter's Mark without a slot). A click spends one use, or one point; what it does is still yours and your DM's to apply. Rests give back what each feature says: a Short Rest one Channel Divinity and one Wild Shape, all Focus Points, and all Bardic Inspiration from Bard level 5; a Long Rest everything.
- **Lay on Hands.** A Paladin's turn bar has **Lay on Hands (left/pool)**, a pool of five times your Paladin level. Pick the creature you touch (yourself or someone within 5 feet) and the Hit Points, then **Heal**: the server restores them from the pool, never more than the creature is missing, and spends your Bonus Action. **Cure Poisoned** spends 5 points to end that condition instead. The pool comes back on a Long Rest.
- **Help.** In the attack menu (right-click a creature while holding your token) **Help against it** takes the Help action: the creature, within 5 feet of you, is distracted, and the next attack roll one of your allies makes against it has Advantage until your next turn starts. The tracker shows it as **Distracted**. Helping with an ability check is your DM's to apply.
- **Ready.** In the attack menu, write the trigger ("when it comes through the door") and press **Ready** under one of your attacks: it spends your action. When the trigger comes, the turn bar shows **Readied: you on the creature**; press it to make the attack with your reaction. It lasts until your next turn starts. Readying a spell or a move is your DM's to run.
- **Your species.** The VTT reads the species on your sheet. A token placed for your character sees in the dark as far as your Darkvision (60 feet, 120 for a Dwarf or an Orc). A Dwarf resists Poison damage; a Dragonborn resists its ancestry's damage and a Tiefling its legacy's when the sheet names the choice in parentheses: **Dragonborn (Red)**, **Tiefling (Infernal)**. A Halfling's Luck rolls a 1 on the d20 again for attacks, saves, checks and death saves. An Orc's Relentless Endurance keeps it at 1 Hit Point the first time it would drop to 0 without being killed outright, and comes back on a Long Rest.
- **Armor Class.** On the sheet's Combat tab, **From equipment** under Armor Class works it out from the armor and Shield you have equipped in your inventory (named as the reference document names them: Chain Mail, Studded Leather Armor, Shield…), your Dexterity, a Barbarian's or Monk's Unarmored Defense, and the Defense fighting style; the line under it says how. A character built in the VTT starts with Unarmored Defense counted.
- **Evasion and Danger Sense.** When a sheet lists Evasion (Rogue or Monk 7), a Dexterity saving throw the VTT rolls for half damage deals none on a success and half on a failure; when it lists Danger Sense (Barbarian 2), that Dexterity save is rolled with Advantage. Neither works while you are Incapacitated. The log marks the damage "(Evasion)".
- **Reckless Attack.** A Barbarian whose sheet lists Reckless Attack sees **Attack recklessly** in the attack menu. Tick it with your first attack roll of your turn: until your next turn, your attacks using Strength have Advantage, and so do attacks against you. The tracker shows you as Reckless.
- **Uncanny Dodge.** When an attack from an attacker you can see hits your Rogue, the VTT stops and asks you, with the damage it is about to deal: **Uncanny Dodge** halves it (round down) and spends your reaction; **No reaction** takes it all. You have 30 seconds to answer; no answer is no reaction. You are not asked while Blinded or Incapacitated, against an Invisible attacker or one in darkness you cannot see into, or once your reaction is spent.
- **Reaction spells.** Four spells cast as a Reaction are asked of you when their trigger comes, if you have the spell prepared, a spell slot for it and your reaction, and can act (not while raging or in a Wild Shape form). The slot and your reaction are spent only when you say yes. **Shield**: when an attack roll hits you and +5 to your Armor Class would make it a miss, you are asked before the damage is shown; a yes turns the hit into a miss and keeps the +5 until the start of your next turn (the tracker shows **Shield (+5 AC)**). You are not asked when the roll would hit anyway. You are also asked when Magic Missile is cast at you: a yes means its darts deal you no damage, and a Shield already up stops them without asking. **Counterspell**: when a creature on the other side that you can see within 60 feet casts a spell from its sheet, you are asked; the caster makes a Constitution save against your spell save DC, and on a failure the spell does nothing (its action is spent, its slot is not). **Hellish Rebuke**: after a creature you can see within 60 feet damages you, you are asked which slot to cast it with; it makes a Dexterity save, taking 2d10 Fire damage (1d10 more for each slot level above 1) or half on a success. **Feather Fall**: when you fall, or a creature on your side that you can see within 60 feet falls, you are asked before the damage; a yes means no damage and no Prone. Shield, Counterspell and Feather Fall use the lowest slot you have left for them. Other uses are yours to run by hand: Counterspell against a spell the VTT does not resolve or a monster's spell, Feather Fall on several fallers at once.
- **Divine Smite.** When your Paladin (Divine Smite prepared, or Paladin’s Smite on the sheet) hits with a melee weapon or an Unarmed Strike on your turn, with your Bonus Action left, you are asked, knowing whether it was a Critical Hit, which slot to smite with: 2d8 Radiant, 1d8 more for each slot level above 1 and against a Fiend or Undead, doubled on a Critical Hit. The slot and your Bonus Action are spent then; **No reaction** spends nothing.
- **Deflect Attacks.** When a Bludgeoning, Piercing or Slashing hit lands on your Monk, you are asked the same way: **Deflect Attacks** takes 1d10 + your Dexterity modifier + your Monk level off the damage and spends your reaction. A character with Uncanny Dodge too is offered both. Redirecting the attack with a Focus Point is asked next when no damage is left (see **More Monk features**).
- **More Monk features.** When they are on your sheet's features: after a **Deflect Attacks** that leaves no damage, with a Focus Point left and the attacker in sight within 5 feet (60 feet for a ranged attack), you are asked again: **Redirect (1 Focus Point)** makes the attacker roll a Dexterity save or take two Martial Arts dice + your Dexterity modifier of the attack's damage type. Redirecting at another creature is yours and the DM's. With **Deflect Energy** you are asked after a hit of any damage type. With **Open Hand Technique**, each hit of a Flurry of Blows strike asks you for **Addle** (the target makes no Opportunity Attacks until its next turn), **Push** (a Strength save or pushed 15 feet) or **Topple** (a Dexterity save or Prone). **Slow Fall** is asked when a fall would hurt you: your reaction takes five times your Monk level off. **Wholeness of Body** in the Features panel is a Bonus Action that heals your Martial Arts die + Wisdom modifier, as many times as your Wisdom modifier until a Long Rest. **Self-Restoration** ends Charmed, Frightened or Poisoned on your token as your turn ends, asking which when you have more than one. **Disciplined Survivor** is asked when a save the VTT rolls for you fails: a Focus Point rolls it again, and the new roll stands. **Heightened Focus** gives Flurry of Blows a third strike and Patient Defense with a Focus Point two Martial Arts dice of Temporary Hit Points.
- **Indomitable.** When a saving throw the VTT rolls for your Fighter (level 9 or more) fails, you are asked, with the roll: **Indomitable** rolls it again with your Fighter level added, and the new roll stands; the use (one, two from 13, three from 17, back on a Long Rest) comes off your sheet.
- **More of the Bard.** *Cutting Words* (College of Lore, on your sheet's features): when an enemy you can see within 60 feet hits with an attack the VTT rolls, or succeeds on a check rolled against a DC, you are asked. For an attack the first question comes with the attack roll, before its damage is shown: **Cutting Words (attack roll)** takes your Bardic Inspiration die off the roll, which may turn the hit into a miss. If you decline, a second question shows the damage: **Cutting Words (damage)** takes the die off the damage roll instead. You can take only one of the two. On a check there is one question. Taking it spends a use of Bardic Inspiration and your Reaction, even when the roll still succeeds. *Peerless Skill* (Lore 14): when your own attack roll or check fails, you are asked whether to add your die; the use is spent only if that turns it into a success. *Countercharm* (Bard 7): when you or an ally within 30 feet fails a save against an effect that applies Charmed or Frightened, you are asked; your Reaction has the save rolled again with Advantage. *Font of Inspiration* (Bard 5): with a use expended, pick a spell slot next to the Bardic Inspiration button and press **Font of Inspiration** to trade it for one use, no action needed. *Superior Inspiration* (Bard 18): rolling Initiative brings you back to two uses if you had fewer. Cutting Words against the damage of a spell or effect that calls for a save, Words of Creation's second target, Expertise and the spells of Magical Secrets and Magical Discoveries are yours to apply or to write on the sheet.
- **Several features on one roll.** When you and others answer the same roll, the server asks each in turn and each works on the roll as it then stands. A reaction you spent on the roll (Shield, Countercharm, Cutting Words) is not asked for again on it. Peerless Skill and Tactical Mind keep their use when an enemy's Shield or Cutting Words turns your success back into a failure.
- **Tactical Mind.** When an ability check the VTT rolls for your Fighter fails against a DC, and Second Wind has a use left, you are asked: **Tactical Mind** adds 1d10. If that turns it into a success a use of Second Wind is spent; if it still fails, nothing is.
- **A Fighter's always-on features.** The VTT applies these when your sheet lists them, with nothing to click. **Improved Critical** (Champion): a hit with a weapon or an Unarmed Strike is a Critical Hit on a 19 or 20, and on an 18 with **Superior Critical**; an 18 or 19 that doesn't reach the Armor Class still misses. **Remarkable Athlete** (Champion): Initiative and Strength (Athletics) checks are rolled with Advantage; the move after a Critical Hit is yours to make. **Dueling**: +2 damage with a Melee weapon that isn't Two-Handed while no other weapon in your inventory is marked equipped, so don't also write the 2 into the weapon's damage, and unequip your spare weapons; if you swing a Versatile weapon with both hands, tell your DM. **Studied Attacks** (level 13): after your attack roll misses a creature, your next attack roll against it has Advantage, until the end of your next turn; the tracker shows the creature as **Studied**. **Survivor** (Champion 18): your death saves are rolled with Advantage and an 18 or 19 counts as a 20, and at the start of your turn in a fight, while you are Bloodied and above 0 hit points, you regain 5 + your Constitution modifier. Tactical Shift, Tactical Master, Protection and Interception are yours and your DM's to run.
- **Brutal Strike.** A Barbarian whose sheet lists Brutal Strike picks an effect under **Brutal Strike** in the attack menu, once on a turn you attack recklessly, for a Strength attack without Disadvantage. The roll gives up its Advantage; a hit deals an extra 1d10 of the weapon's type (2d10 from level 17) and a **Forceful Blow** (the target is pushed 15 ft straight away) or a **Hamstring Blow** (its Speed is 15 ft lower until your next turn). Moving toward the target after a Forceful Blow, and the level 13 effects, are yours to play out.
- **More Barbarian features.** These work when your sheet lists the feature by name. While you rage, **Extend Rage** in the turn bar spends your Bonus Action to keep the Rage to the end of your next turn (an attack roll, or a save you force, on your turn does the same); with **Persistent Rage** a Rage lasts 10 minutes by itself and **Regain Rages** gives every use back once until a Long Rest (the rules have it when you roll Initiative). **Relentless Rage**: when damage would drop you to 0 Hit Points while raging without killing you outright, you are asked; taking it rolls a Constitution save (DC 10, 5 higher each time until a Short or Long Rest) and a success leaves you at twice your Barbarian level in Hit Points. **Primal Knowledge**: while raging, an Acrobatics, Intimidation, Perception, Stealth or Survival check the VTT rolls uses Strength when that is no worse for you. **Indomitable Might**: a Strength check or failed Strength save that totals less than your Strength score uses the score.
- **Path of the Berserker.** **Frenzy**: on a turn you attack recklessly while raging, your first Strength-based hit adds as many d6s as your Rage Damage bonus, shown as "Frenzy (2d6)" in the log. **Mindless Rage**: entering a Rage takes the Charmed and Frightened conditions off your token, and effects the VTT resolves do not put them on you while you rage. **Retaliation**: when a creature within 5 feet damages you and your reaction is unspent, you are asked; answer **Retaliation** and the turn bar offers **Retaliation: you on it**, one melee attack made like an Opportunity Attack. **Intimidating Presence** is in your attack menu as a Bonus Action: pick the creatures within 30 feet; each makes a Wisdom save (DC 8 + your Strength modifier + Proficiency Bonus) or is Frightened, saving again at the end of each of its turns. After its one use it is listed as **Intimidating Presence (a use of Rage)** and costs a use of Rage.
- **Cunning Strike.** A Rogue whose sheet lists Cunning Strike picks an effect under **Cunning Strike** in the attack menu. If the attack deals Sneak Attack, 1d6 of it is forgone before the roll for the effect: **Poison** (with a Poisoner’s Kit in your inventory: a Constitution save or Poisoned, saved against again at the end of each of its turns), **Trip** (a Large or smaller target’s Dexterity save or Prone) or **Withdraw** (you may move half your Speed without provoking Opportunity Attacks; the move is yours to make). Saves are against 8 + your Dexterity modifier + Proficiency Bonus.
- **Improved Cunning Strike and Devious Strikes.** With Improved Cunning Strike on your sheet (Rogue 11) a **Second effect** appears under Cunning Strike: two different effects on one Sneak Attack, paying the dice of each. Devious Strikes (Rogue 14) adds **Daze** (2d6: a Constitution save, or on its next turn the target only moves, or takes an action, or a Bonus Action; the table holds it to that), **Knock Out** (6d6: a Constitution save or Unconscious for 1 minute, saved against again at the end of each of its turns, and ended by any damage it takes) and **Obscure** (3d6: a Dexterity save or Blinded until the end of its next turn). An effect is refused when your Sneak Attack has too few dice to pay for it.
- **Steady Aim.** A Rogue from level 3 has **Steady Aim** on the turn bar, a Bonus Action offered only while you have not moved this turn: your next attack roll this turn has Advantage, and your Speed is 0 until the turn ends (the bar shows no movement left).
- **Reliable Talent.** With Reliable Talent on your sheet (Rogue 7), a check with a skill your sheet marks proficient treats a d20 of 9 or lower as a 10; the roll says so. Checks with a tool are rolled at the table, where the same holds.
- **Elusive.** With Elusive on your sheet (Rogue 18), no attack roll against you has Advantage unless you are Incapacitated; the attack's reasons say so.
- **Stroke of Luck.** A level 20 Rogue that misses with an attack roll, fails a check that has a DC, or fails a saving throw against an action is asked, with the roll: **Stroke of Luck** turns the d20 into a 20 (a Critical Hit on an attack). Once, back on a Short or Long Rest; declining spends nothing.
- **Thief.** With Fast Hands on your sheet the turn bar has **Fast Hands: Sleight of Hand**, the check as a Bonus Action (the DM reads the total); Utilize or a magic item as a Bonus Action is ticked by hand. With Supreme Sneak, **Stealth Attack** (1d6) is a Cunning Strike option while you have the Invisible condition from hiding: the attack does not end it if you end the turn behind Three-Quarters or Total Cover, which the table judges. Second-Story Work, Use Magic Device and Thief's Reflexes are run at the table. Slippery Mind is on your sheet: mark the Wisdom and Charisma saves proficient.
- **Stunning Strike.** When your Monk hits with a Monk weapon (a Simple Melee weapon, or a Martial Melee one with Light) or an Unarmed Strike, once a turn, with a Focus Point left, you are asked. Taking it spends the point, and the target makes a Constitution save against 8 + your Wisdom modifier + Proficiency Bonus: on a failure it is Stunned until the start of your next turn; on a success its Speed is halved until then and the next attack roll against it has Advantage.
- **Aura of Protection.** A Paladin whose sheet lists Aura of Protection adds its Charisma modifier (at least +1) to the saving throws the VTT rolls for itself and for its allies within 10 feet, while it can act and has Hit Points; the log says whose aura it was. A creature in two auras gains from the best one.
- **A Paladin's other features.** **Sacred Weapon** (Oath of Devotion): tick it in the attack menu as you attack with a melee weapon on your turn. It spends a use of Channel Divinity, and for 10 minutes that weapon adds your Charisma modifier (at least +1) to its attack rolls; tick **Radiant damage** for a hit with it to deal Radiant instead of the weapon's own type. The weapon's light is yours to describe. **Radiant Strikes** adds 1d8 Radiant to every hit with a melee weapon or an Unarmed Strike. **Paladin's Smite**: from Paladin level 2, the Divine Smite question also offers **Divine Smite (no slot)** once until a Long Rest, cast as with a level 1 slot. **Abjure Foes** is among your actions while a use of Channel Divinity is left: aim it at one creature and tick the others within 60 feet, up to your Charisma modifier in all; each makes a Wisdom save against your spell save DC or is Frightened for 1 minute, or until it takes damage. **Aura of Courage** and **Aura of Devotion** keep the Frightened and Charmed conditions the VTT would apply off you and your allies in your aura, and a Frightened creature standing in the aura attacks and makes checks without the Disadvantage. **Aura Expansion** makes the aura 30 feet. With **Restoring Touch**, Lay on Hands has a **Cure** button for Blinded, Charmed, Deafened, Frightened, Paralyzed and Stunned too, 5 points each.
- **Hunter's Mark.** A Ranger with Hunter's Mark ready picks a creature and clicks **Hunter's Mark** in the attack menu (a Bonus Action on your turn, with Concentration): your attack hits on it deal an extra 1d6 Force damage until your concentration ends. Spend the slot or the use of Favored Enemy as you cast it; moving the mark to a new creature is clicking it again on that one.
- **Ranger and Hunter features.** At the levels that give them, your Hunter's Mark rolls a d10 (Foe Slayer), you attack the marked creature with Advantage (Precise Hunter) and damage does not break your concentration on it (Relentless Hunter). The turn bar shows **Tireless** (a Magic action: 1d8 + Wisdom Temporary Hit Points) and **Nature's Veil** (a Bonus Action: Invisible until the end of your next turn), each with as many uses as your Wisdom modifier until a Long Rest; Tireless also takes a level of Exhaustion off when you finish a Short Rest. As a Hunter, marking a creature tells you its Immunities, Resistances and Vulnerabilities (Hunter's Lore). Hunter's Prey and Defensive Tactics work once your sheet names the option you chose (see [Feature options](#feature-options)): **Colossus Slayer** (1d8 more, once per turn, on a weapon hit against a creature missing Hit Points), **Horde Breaker** (a button under each weapon in the attack menu: after attacking with it, one more attack on a different creature within 5 feet of the first, once on each of your turns), **Escape the Horde** or **Multiattack Defense** (the Disadvantage is applied to the attacker's roll). From level 11 you are asked, once per turn after damaging the marked creature, which nearby creature takes the mark's die as well; from level 15 you are asked after taking damage whether to spend your reaction to resist one of its types until the turn ends.
- **Divine Spark.** A Cleric (level 2 or more) with a use of Channel Divinity left finds **Divine Spark (healing)**, **(Radiant)** and **(Necrotic)** among its actions in the attack menu: against another creature within 30 feet, 1d8 + your Wisdom modifier (2d8 from level 7, 3d8 from 13, 4d8 from 18) restored as Hit Points, or dealt as damage with a Constitution save against your spell save DC for half. It is a Magic action, and spends the use.
- **Turn Undead.** A Cleric with a use of Channel Divinity left has **Turn Undead** among its actions: aim it at the Undead of your choice within 30 feet (an area, or one creature). Each makes a Wisdom save against your spell save DC, or is Frightened and Incapacitated for 1 minute, or until it takes damage. It is a Magic action, and spends the use.
- **Cleric features and the Life Domain.** From level 5, **Sear Undead** adds to Turn Undead: your Wisdom modifier in d8s (at least one) of Radiant damage to each Undead that fails, which does not end the effect. With the Life Domain's features on your sheet, a healing spell you cast with a slot restores 2 + the slot's level more (**Disciple of Life**), you regain as much yourself when you heal someone else (**Blessed Healer**, level 6), and from level 17 your healing dice count as their highest number (**Supreme Healing**). **Preserve Life** is a button in the turn bar while you have a use of Channel Divinity: give each Bloodied creature within 30 feet (you can be one) its share of five times your Cleric level; no one is restored above half its Hit Point maximum. It is a Magic action. For **Blessed Strikes** (level 7), your sheet names the option you took, Divine Strike or Potent Spellcasting (see [Feature options](#feature-options)). With Divine Strike you are asked after a hit with a weapon, once on each of your turns, whether to add 1d8 Radiant or Necrotic damage (2d8 from level 14). With Potent Spellcasting your Cleric cantrips add your Wisdom modifier to their damage; the Temporary Hit Points it gives from level 14 are yours and your DM's to apply, as are Divine Order and Divine Intervention.
- **Wild Shape.** A Druid (level 2 or more) picks a Beast on the turn bar and clicks **Wild Shape**: a Bonus Action and a use of Wild Shape. The forms offered are the reference document's Beasts your level allows (Challenge Rating 1/4 without a Fly Speed from level 2, 1/2 from 4, 1 with flying from 8). You gain Temporary Hit Points equal to your Druid level; the Beast's attacks, Armor Class and Strength, Dexterity and Constitution become yours (a physical save uses the better of yours and the Beast's), and you keep your own Hit Points. You cannot cast spells in the form. **Leave … form** ends it, also a Bonus Action. Which four forms you know is yours and the DM's to keep.
- **Eldritch Blast and invocations.** Eldritch Blast makes two beams at level 5, three at 11 and four at 17: **All N beams** in the attack menu fires them all at the target, a roll each; the row fires one, for beams at different creatures. **Agonizing Blast** on the sheet ("Agonizing Blast (Eldritch Blast)", or the cantrip of your choice in brackets) adds your Charisma modifier to that cantrip's damage. With **Repelling Blast**, a hit asks you whether to push a Large or smaller target 10 feet straight away.
- **Warlock features and the Fiend Patron.** Finishing a Short Rest gives your Pact Magic slots back, and **Magical Cunning: regain Pact Magic slots** on your roster entry performs the 1-minute rite (half your slots, rounded up; all of them at level 20; once until a Long Rest, not in the middle of a fight). Name your pact weapon in the invocation on your sheet (see [Feature options](#feature-options)), or put "Pact" in the attack's own name: the attack menu then offers **Pact weapon deals** Necrotic, Psychic or Radiant, Thirsting Blade and Devouring Blade give it two and three attacks in the Attack action, and after a hit you are asked about **Eldritch Smite** (a Pact Magic slot: 1d8 Force plus 1d8 per slot level, with or without knocking a Huge or smaller target Prone) and **Lifedrinker** (1d6 of the type you pick, then whether to spend a Hit Point Die to heal), once a turn each. Write the Charisma numbers in that attack's bonus and damage yourself. **Fiendish Vigor** on the turn bar is False Life for 12 Temporary Hit Points, your action. With the Fiend Patron's features on your sheet: **Dark One's Blessing** gives you Temporary Hit Points (Charisma modifier + level) when you drop an enemy, or anyone drops one within 10 feet of you; you are asked about **Dark One's Own Luck** (+1d10) after a failed save or check, and after any check rolled with no DC; **Fiendish Resilience** gives Resistance to the type its name gives (see [Feature options](#feature-options); change it there after a rest); and after a hit with any attack roll you are asked about **Hurl Through Hell**, once a turn: a Charisma save against your spell save DC or 8d10 Psychic damage (none to a Fiend) and Incapacitated until the end of your next turn, once until a Long Rest or again for a Pact Magic slot. A token made from a sheet with Devil's Sight sees 120 feet in darkness. Contact Patron, Mystic Arcanum, the other invocations' free spells, and Dark One's Own Luck on death saves and Concentration saves are yours and the DM's to run.
- **Arcane Recovery.** A Wizard finishing a Short Rest picks **Finish short rest, with Arcane or Natural Recovery…** on its roster entry and chooses the expended slots to recover: a combined level of no more than half your Wizard level (rounded up), none of level 6 or higher. It works once until a Long Rest; the server says what came back, or why not.
- **A Druid's other features.** **Land's Aid** (Circle of the Land, level 3; your sheet must list it) is in the attack menu while a use of Wild Shape is left: tick the creatures in its 10-foot-radius Sphere that make the Constitution save (2d6 Necrotic, half on a success; 3d6 at level 10, 4d6 at 14), pick the one creature that regains the same dice of Hit Points, and click **Use Land's Aid**: a Magic action and a use of Wild Shape. **Land's Aid (healing only)** just restores the Hit Points to the creature the menu is on. **Elemental Fury** (level 7) is read from your sheet: the option, **Primal Strike** or **Potent Spellcasting**, in the feature's name (see [Feature options](#feature-options)). With Primal Strike, once on each of your turns when you hit with a weapon or a Beast form's attack you are asked which of Cold, Fire, Lightning or Thunder to add 1d8 of (2d8 from level 15), or to pass. With Potent Spellcasting your Wisdom modifier is added to the damage of your Druid cantrips, and from level 15 those with a range of 10 feet or more reach 300 feet farther. Beside Wild Shape on the turn bar, a menu holds **Wild Companion** (a Magic action; a use of Wild Shape or a spell slot casts Find Familiar, and you place the familiar yourselves) and from level 5 **Wild Resurgence** (no action: a spell slot for a use of Wild Shape when none is left, once on each of your turns; or a use for a level 1 slot you have expended, once until a Long Rest). **Natural Recovery** (Land 6) recovers slots as a Short Rest ends, from the same roster entry and by the same rule as Arcane Recovery, with your Druid level. **Nature's Ward** (Land 10) keeps the Poisoned condition off you and gives the Resistance of your land when the sheet names it (see [Feature options](#feature-options)) (Arid Fire, Polar Cold, Temperate Lightning, Tropical Poison). From level 18 (Beast Spells) your spells stay in the attack menu in a Wild Shape form.
- **Metamagic.** A Sorcerer whose sheet lists Careful, Distant, Heightened or Quickened Spell picks one under **Metamagic** in the attack menu as it casts, spending Sorcery Points: **Careful Spell** (1) makes the other creatures the area catches (up to your Charisma modifier) succeed on their save and take no damage where they would take half; **Heightened Spell** (2) gives the creature you opened the menu on Disadvantage on its save; **Distant Spell** (1) doubles the range (Touch becomes 30 feet); **Quickened Spell** (2) casts an action spell as a Bonus Action. **Seeking Spell** and **Empowered Spell** are asked after the roll, as the rules have it: when your spell attack misses, the table asks whether to spend 1 Sorcery Point to reroll the d20 (the new roll stands); when your spell's damage is rolled, it asks whether to spend 1 to reroll up to your Charisma modifier of the lowest damage dice (at least one).
- **A Sorcerer's own magic.** The turn bar gives a Sorcerer two more controls. **Innate Sorcery** (a Bonus Action, twice until a Long Rest, during a fight): for 1 minute, counted as ten of your turns, the save DC of your spells is 1 higher and your spell attack rolls have Advantage; the VTT applies both. From Sorcerer level 7, with no use left, the same button spends 2 Sorcery Points instead (Sorcery Incarnate). **Font of Magic** opens a small panel: create a spell slot of level 1 to 5 from Sorcery Points (2, 3, 5, 6 or 7 points, a Bonus Action; a created slot vanishes on a Long Rest), or convert a spell slot into Sorcery Points equal to its level (no action, never above your maximum). **Transmuted Spell** (1) is in the attack menu's **Metamagic** list: pick the type your spell's Acid, Cold, Fire, Lightning, Poison or Thunder damage becomes. **Sorcerous Restoration** (level 5): pick **Finish short rest, with Sorcerous Restoration** on your roster entry to regain Sorcery Points, up to half your Sorcerer level, once until a Long Rest. **Draconic Sorcery**: a Sorcerer built in the VTT at level 3 or higher has Draconic Resilience's Hit Points and Armor Class (10 + Dexterity + Charisma without armor; the sheet editor's **From equipment** knows it too). For **Elemental Affinity**, the type is in the feature's name on your sheet (see [Feature options](#feature-options)): the VTT then gives you Resistance to it and adds your Charisma modifier to the damage of a spell of that type. Twinned, Extended and Subtle Spell, Dragon Wings and Arcane Apotheosis are yours and the DM's to apply; spend their points with the **Sorcery Points** button.
- **The Evoker.** A Wizard whose sheet lists the features gets them in the attack menu. **Sculpt Spells**: under an Evocation spell with an area, tick the creatures to spare, up to 1 + the level of the slot; they succeed on the save and take no damage. **Potent Cantrip** needs nothing from you: a cantrip that misses, or that its target saves against, still deals half its damage. **Empowered Evocation** adds your Intelligence modifier to the damage roll of a Wizard Evocation spell. **Overchannel** is a tick box: a Wizard spell cast with a slot of level 1 to 5 deals its maximum damage. The first use after a Long Rest is free; the menu shows what the next one will deal you (2d12 Necrotic for each level of the slot, then 3d12, and so on).
- **Magic Missile.** Cast it from the attack menu like any spell: it needs no roll, and every dart strikes the creature the menu is open on, each for 1d4 + 1 Force, with one more dart for each slot level above 1. The menu cannot yet divide the darts among several creatures; ask your DM to adjust Hit Points if you split them.
- **Feats in play.** A character built in the VTT with **Alert** has its Proficiency Bonus in its Initiative, and a Dwarf gets Dwarven Toughness's extra Hit Point a level. In an attack the VTT applies **Savage Attacker** (the weapon's damage rolled twice, the better kept, once a turn), **Archery** (+2 with a Ranged weapon; don't also add it to the sheet's attack bonus) and **Great Weapon Fighting** (a 1 or 2 on a damage die of a Two-Handed weapon counts as 3). The VTT finds them among your sheet's features, however they are written.
- **Heroic Inspiration.** Your DM gives it; you have it or you don't, never two. While your character holds it, the turn bar shows a **Heroic Inspiration** marker on your turn and your sheet says Inspiration: Yes. When the VTT rolls a d20 for you and you miss with an attack roll, fail a save or fail a check that has a DC, you are asked whether to expend it: the d20 is rolled again (with Advantage or Disadvantage, the lower of your two dice) and you must use the new roll, even if it is worse. On a failed save the question comes together with Indomitable or Disciplined Survivor, and you pick one. Rerolling a roll that succeeded, a damage die or any die rolled by hand is up to you: make the reroll, then click the marker to expend the inspiration. A **Human** gets it back at the end of every Long Rest (Resourceful), and a Champion with **Heroic Warrior** gains it at the start of each of its turns in a fight when it has none. If you gain it while you already have it, tell your DM who gets it instead.
- **Grappler and Epic Boons.** With the **Grappler** feat, once per turn when your Unarmed Strike hits as part of the Attack action on your turn, you are asked whether to use **Punch and Grab**: the target then also saves against your Grapple. Your attack rolls against a creature you grappled with an Unarmed Strike (or Punch and Grab) have Advantage while it stays Grappled; Fast Wrestler's free dragging is yours to count. **Boon of Combat Prowess**: when an attack roll still misses, you are asked whether Peerless Aim turns it into a hit, once until the start of your next turn. **Boon of Irresistible Offense**: your Bludgeoning, Piercing and Slashing damage ignores Resistance, and a 20 on the d20 of an attack roll adds damage equal to your Strength or Dexterity score, whichever is higher, or the one the feature's name gives (see [Feature options](#feature-options)). The Boons of Fate, Spell Recall, Dimensional Travel, the Night Spirit and Truesight, Alert's Initiative Swap, and what Magic Initiate, Skilled and an Ability Score Improvement add to your sheet are yours and your DM's to apply.
- **Conditions from monsters.** A monster's hit or your failed save against its effect can leave a condition on your token (Grappled, Prone, Poisoned, Frightened…), as the monster's stat block says; the log says so and how long it lasts. One that lasts until the start or end of a creature's next turn comes off by itself then; one you repeat the save against at the end of each of your turns is rolled for you as your turn ends, and comes off on a success; any other your DM takes off when it ends.
- **Areas aimed at a square.** In the tactical view, holding your token, right-click an empty square to aim an area there: the menu offers your area effects (Fireball, a breath), shows who stands in the area as you point at one, and casts it on them. The square must be within the spell's range.
- **Healing spells.** Cure Wounds, Healing Word, Mass Cure Wounds and Mass Healing Word are in the attack menu: right-click the creature you heal (yourself included) and pick the slot. The server rolls the dice plus your spellcasting modifier (your spell attack bonus less your Proficiency Bonus), heals the creature, spends the slot and your action, or your Bonus Action for Healing Word. Cure Wounds needs a touch (5 feet); the others their range. A Mass spell heals the one creature you picked; heal the others the same way or let your DM apply it.
- **Concentration.** A concentration spell the VTT casts for you (an attack or a save it rolls) makes you concentrate on it; for one you cast by hand (Bless, Haste…), pick it on the turn bar and press **Concentrate**. The bar and the tracker show **Concentrating**. When you take damage, the server rolls your Constitution save against DC 10 or half the damage (to 30) and says in the log whether you keep it; at 0 Hit Points, or when you start another, it ends. **End concentration** ends it yourself.
- **Cunning Action and a Monk's Focus.** A Rogue from level 2 has **Cunning: Dash**, **Cunning: Disengage** and **Cunning: Hide** on the turn bar, each a Bonus Action (Hide rolls Stealth against DC 15, as the Hide action). A Monk from level 2 has **Flurry of Blows** (a Focus Point: two Unarmed Strikes, made from the attack menu with **Flurry of Blows strike** under Unarmed Strike), **Patient Defense** (Disengage; **+1** spends a Focus Point to Dodge as well) and **Step of the Wind** (Dash; **+1** spends a Focus Point to Disengage as well). After a Disengage your movement this turn draws no Opportunity Attacks.
- **Sneak Attack.** A Rogue's attack with a Finesse or a Ranged weapon adds the Sneak Attack dice of the Rogue table at your level when it hits with Advantage, or when an ally of yours who is not Incapacitated stands within 5 feet of the target and the roll does not have Disadvantage. The VTT checks this, rolls the dice (doubled on a Critical Hit) and writes **Sneak Attack (3d6)** in the log; it happens once on each turn, yours or another's.
- **Unarmed Strike.** The attack menu (right-click a creature while holding your token) lists four more choices after your own attacks: **Unarmed Strike** for 1 plus your Strength modifier of damage, **Grapple**, **Shove: knock Prone** and **Shove: push 5 ft**. The last three make the target roll a Strength or Dexterity save (whichever it is better at) against 8 + your Strength modifier + your Proficiency Bonus; if it fails, the VTT marks it Grappled or Prone, or moves it a square away. They work on a creature within 5 feet that is no more than one size larger than you.
- **Checks.** **Check** on the bar rolls an ability check for your token on the server: pick a skill, a bare ability or the **Hide action**, type the DC if your DM gave one, choose Advantage or Disadvantage if you were granted it, and press **Roll**. The bonus comes from your sheet, being Poisoned or Frightened gives Disadvantage, and the result goes to the dice log ("17 vs DC 15: success", or just the total with no DC). The Hide action is Stealth against DC 15: on a success your token becomes Invisible and the log says what a search must roll to find you. The panel also shows your passive Perception.
- **Difficult Terrain.** Squares your DM marked as Difficult Terrain are tinted brown in the tactical view; every foot into one costs a foot more, and the reach and the hint count it.
- **Prone.** While your token is Prone it crawls: every foot costs a foot more, and the blue reach shrinks to match. **Stand up** on the bar gets you up for half your Speed, if you have that much movement left.
- **Conditions and movement.** Grappled, Paralyzed, Petrified, Restrained and Unconscious leave you no movement, and Exhausted takes 5 feet off your Speed.
- **Opportunity Attacks.** If you move out of a hostile creature's reach on your turn, the VTT offers that creature an Opportunity Attack; taking **Disengage** as your action first means your movement offers none. When a hostile creature walks out of your reach on its turn, a button appears on the bar, **Opportunity Attack: you on it**: press it to make one melee attack with your reaction (if you carry more than one melee weapon the bar asks which). The offer lasts until that creature's turn ends.
- Tick **Bonus action used** and **Reaction used** as you spend them.
- Press **End turn** when you are done.

While someone else is acting you still have a tick for your own token's reaction, which comes back at the start of your next turn. The bar keeps count for the table; it does not stop you doing anything, so the rules are still yours and the DM's to keep.

### Rolling Your Own Initiative

Once the DM has added your token to the tracker, you roll for yourself — you don't have to wait for the DM to do it for you. There are two ways, and they do the same thing:

- **In the tracker** — a dice icon 🎲 appears beside your own name. You'll only ever see it on your own row; you can't roll for other players or for the DM's monsters. Right-clicking your name there and choosing **Roll...** offers **Roll Initiative** too
- **On the map** — right-click your token, choose **Roll...**, and pick **Roll Initiative** at the top of the menu

Either way the result drops straight into the turn order and the roll appears in the **Dice** panel, so everyone can see what you got.

Roll once, before the DM clicks **Start Combat**: a second roll is refused, and once combat has started the dice icon and **Roll Initiative** are no longer offered to you. If your initiative needs changing, ask your DM. Your roll stays in the **Dice** panel after a reload. If your token's identity is obscured, the roll comes in under your token's name for you and as *Unknown creature* for everyone else; the history keeps it as *Unknown creature*, so that is how it reads after a reload.

**What you actually roll depends on your game system**, and it's worked out from your sheet:

| System | Initiative |
|---|---|
| **D&D 5e** | `d20 +` your Dexterity modifier, plus the **other bonus** box on your sheet |
| **Pathfinder 2e** | `d20 +` whichever stat the **Uses:** dropdown names — Perception unless your GM asks for something else |
| **Call of Cthulhu 7e** | Nothing is rolled. Investigators act in DEX order, so the button reads **Set Initiative** and takes your DEX |

**D&D 5e players — the "other bonus" box.** Your Dexterity is added automatically, but plenty of things add to initiative beyond it: the **Alert** feat's flat +5, a Bard's Jack of All Trades, subclasses that let you use a different ability. Put the total of those in **Initiative — other bonus** on the Combat tab and it's included every time; the box takes anything from -30 to +30. The Initiative number itself is worked out for you now, so there's nothing to keep in step by hand.

If something gives you **advantage** on initiative (a Sentinel Shield, say), that isn't handled automatically yet — roll `2d20kh1` in the dice panel and ask your DM to enter it.

### Levelling up (D&D 5e)

Change **Level** at the top of the editor and **Proficiency Bonus** moves with it: +2 at levels 1 to 4, +3 at 5 to 8, +4 at 9 to 12, +5 at 13 to 16 and +6 at 17 to 20. Every save, skill and spell number worked out from it follows. If your table uses a different bonus, type it in the box and it stays as you set it; the sheet shows what your level gives under the box, with a button to switch back to it.

### Bonuses the sheet can't work out (D&D 5e)

Every skill and saving throw is worked out for you from your ability scores, your proficiency bonus and the Prof and Exp boxes, so it keeps up as your character grows. Some things add to them that the sheet can't know about: a Bard's **Jack of All Trades**, a Paladin's **Aura of Protection**, a **Ring of Protection**, a feat. In **Edit**, under **Stats & Skills**, each skill and saving throw has a small box beside its total. Type the extra there, `1` for +1 or `-1` for a penalty, and the total, the sheet and the dice all include it.

A character from an earlier version may have totals that already include something like this. The first time you open such a character in the editor, the difference is put in the box for you, so every total stays exactly as it was. If one of those boxes holds a number you don't recognise, the total was out of step with your ability scores; change the box to `0` to use the worked-out total.

### Skills the sheet doesn't have (D&D 5e)

Thieves' tools, a musical instrument, a vehicle, or whatever your table invented — none of these are among the eighteen printed skills, but they roll the same way. Under **Stats & Skills** there's a **Your Own Skills** section: **+ Add Skill**, type the name, choose the ability it uses, and tick **Prof** (or **Exp** for expertise).

The bonus is worked out for you from that ability and your proficiency bonus, so it keeps up as your character grows — there's nothing to re-enter when you level. The **Other** box is for anything the maths can't know about, like a +1 set of tools.

Your own skills show up with the rest on your sheet and in the right-click roll menu, so rolling them is one click.

### Spending a hit die on a short rest (D&D 5e)

At the end of a short rest you can spend hit dice to get hit points back. Your pool is on the **Combat** tab — `3/5 d10` means you have five d10 hit dice and three of them are unspent.

**Click the pool to spend one.** It rolls a single die plus your Constitution modifier and puts the result in the roll history like any other roll, and the count goes down by one. You can also reach it by right-clicking your token and choosing **Roll...**, where it sits under **Hit Dice**. If the roll doesn't go through (the connection dropped, or too many rolls at once), a message says why and the die is not spent.

It rolls **one** die, not the whole pool — spending is one die at a time, and the rules let you decide whether to spend another after seeing each result. So click again if you want a second.

**Setting your pool up.** In **Edit**, each row is labelled: **Class**, **Die**, **Left** and **Max**. Put a single die under Die — `d10` for a fighter, `d6` for a wizard — and how many you have at your level under Max. Left is how many are unspent, and it reads `Left / Max` the same way the sheet shows `3/5`. You don't repeat the count in the Die box; that's what Max is for.

**A hit die that isn't a plain die.** If your game uses something else — a homebrew class whose hit die is `2d6`, or one with a flat bonus like `1d10+1` — type that in the die box and it rolls exactly as written, with your Constitution added on top. Anything the dice roller understands works here.

**Add the hit points yourself.** CozyVTT rolls the die and keeps count of what you have left, but it doesn't change your HP for you — use the **+** button on your roster card for the amount you rolled. (If your Constitution modifier is negative and the total comes out below zero, you regain nothing rather than losing hit points.)

Once the pool is empty the number stops being clickable. Your DM can also spend one on your behalf if you're not at the table, and it comes off your sheet the same way.

**Letting the VTT do it.** Right-click your character in the Campaign Roster and choose **Short rest: spend a Hit Die**: the server rolls one die from your pool, adds your Constitution modifier, puts the hit points on your sheet (at least 1, never above your maximum) and logs the roll. Choose it again for another die. It works for a pool of plain dice (`d10`); a homebrew die such as `2d6` is still rolled from the sheet as above.

**Getting them back.** A short rest is when you *spend* hit dice — it doesn't give any back. A **long rest** does, by the 2024 rules: all your lost hit points, **all** your spent hit dice and all your spell slots come back, temporary hit points end, and one level of exhaustion goes. Your DM gives it, from the same menu.

CozyVTT doesn't apply that for you yet. After a long rest, click **Edit** on your sheet and set the remaining number for each pool yourself — **Max** is there so you can see what you're counting back up towards.

### Weapons that do more than one thing

**Properties** — Finesse, Light, Thrown and the rest — are buttons on each weapon in the Combat tab. Tap the ones that apply and they appear as labels on your sheet.

The eleven buttons are the ones the rules name, not a limit. If your game has a property of its own, type it into **Add your own property** and it gets a label like any other. Your own properties show in amber while editing so you can tell them apart, and clicking one removes it.

**More than one damage roll.** A spear is 1d6 in one hand and 1d8 in two, and a spell may hit harder at higher levels. Use **Other Damage Rolls** to add each one with a note saying when it applies — "Two-handed", "At 5th level". Each gets its own line on your sheet that you can click to roll, so you're not doing arithmetic mid-fight.

If you already wrote a second damage die into a weapon's notes, it stays exactly as you typed it — nothing rewrites your sheet. Move it into its own row whenever you like and it becomes rollable.

**The option only appears once you're in the tracker.** If your token isn't in the turn order yet, there's nothing to roll for — ask your DM to add you. Rolling is how you take part in a fight you're already in; it isn't a way to add yourself to one.

Your DM can still roll for you (and re-roll, or type a value in by hand) — handy if you're away from the keyboard when combat kicks off.

**Watch the map, too.** Whoever's turn it is gets a pulsing gold ring around their token. That's the fastest way to tell which creature is acting when the DM has several of the same monster on the board — three identical wolves look alike in the list, but only one is ringed on the map.

If a creature is somewhere you haven't explored, you won't see a ring for it — the tracker will show its turn passing, but its position stays a mystery. A creature the DM has hidden isn't in your tracker at all, and neither is one on a map the DM hasn't switched to or on the other plane.

**Not sure which wolf is which?** Hover a name in the tracker and that creature's token lights up on the map with a thin white outline. It works the other way too — hover a token on the map and its row in the turn order tints. Hovering only points; it never selects or moves anything.

**Reading conditions on the map.** A creature under a condition carries small amber badges above its token, each a two-letter code — **PA** for Paralyzed, **PO** for Poisoned, **PR** for Prone, and so on. If it has more than four, the extras collapse into a grey **+N** badge. Hover the token and the panel in the bottom-left names every condition in full, so you can tell a Paralyzed enemy from a merely Poisoned one before deciding what to do about it.

### Pointing at the Map

Saying "no, the *other* door" never works. Instead, put your mouse where you mean and press **Tab**. A dot appears with rings radiating out of it, in your colour and labelled with your name, and everyone at the table sees it in the same spot for a couple of seconds.

A few things worth knowing:

- **Your mouse has to be over the map.** Tab does nothing if the cursor is over the chat panel or the sidebar.
- **Tab still works normally everywhere else.** If you're typing in chat, or you've tabbed your way to a button, Tab keeps moving between controls as usual — it only pings when you're not in the middle of something.
- **Anyone can ping**, players and DM alike. Your colour is assigned automatically and stays the same every session.
- Pings are just a gesture. They don't move anything, don't reveal anything, and vanish on their own.

If you ping repeatedly in quick succession, some will be quietly ignored — that's a spam guard, not a bug.

The DM controls when initiative advances — after your turn, they'll click **Next Turn** and the focus moves to the next combatant.

*Screenshot pending — Your name highlighted in the initiative order.*

**During combat tips:**
- Have your actions planned before your turn — it keeps things moving
- Check HP totals to gauge how the fight is going
- Use chat for action narration and out-of-character dice commentary

---

## The Vibe Tracker

The **Vibe Tracker**, in the **Session** tab, shows the time of day your DM has set for the scene: dawn, day, dusk and night unless your DM has named their own. When it changes, the whole map shifts colour to match over a few seconds, and the header shows the current one. If your DM edits or removes the current period, your view follows at once.

*Screenshot pending — Vibe tracker showing the current period.*

You don't control this — only the DM does. Just let it color your roleplaying.

---

## Managing Your Characters

### Your Character Library

The **Characters** page shows all your characters across every campaign and system. You can have up to 1,000 characters, copies included; past that, creating, copying or importing another says so, and deleting one you no longer need makes room.

*Screenshot pending — Characters page with multiple characters.*

**Things you can do from the Characters page:**

- **Click a character** — Open its sheet to read. **Edit** is on the sheet itself when you want to change something

The card's menu (**⋮**) holds the rest:

- **Edit Character** — Skip straight to the character editor
- **Copy/Duplicate** — Duplicate a character (handy for making variants or backups)
- **Assign to Campaign** — Add a character to a campaign. For a character already in one it reads **Reassign Campaign**, which moves it to another or unassigns it
- **Export as JSON** — Download your character as a JSON file (great for backups or sharing builds)
- **Delete Character** — Remove a character permanently (you'll be asked to confirm)

**Import**, at the top of the page, loads a previously exported character JSON.

### Editing Your Character

Clicking a character card opens its sheet to read; click **Edit** on the sheet to start changing it. **Edit Character** in the card's menu skips the reading step and goes straight to the Character Editor. Either way, make your changes and click **Save** — they take effect immediately.

If you leave the editor with changes you haven't saved, you'll be asked to confirm before they're discarded — whether you use the back arrow or close the tab. Once you've saved, backing out is silent; there's nothing left to lose. If you typed something while the save was still going through, the editor stays open with it instead of closing, and you save again. Simply opening a sheet and reading it never counts as a change.

Renaming a character on its sheet renames it everywhere: the card in your library, the editor's title bar, and your DM's roster all follow.

**If your character changes while you're editing it**, say your DM takes hit points with the **−** on your roster card, your save is refused so it can't put the old numbers back. You don't lose what you typed. The editor stays open and a box headed **This character has changed** lists your changes, already put onto the new version, which keeps the hit points your DM set. Press **Save my changes** to save them, or **Keep editing** to carry on without saving. If you both changed the same thing, the box shows your value and the newer one, and you pick which to keep before saving. A sheet you only have open to read on the campaign page follows changes by itself. One opened from the Characters page, or the Character Editor, does not update while it is open.

> **Tip:** Update your character after each session — update HP, spell slots, inventory, and anything that changed. Your DM will thank you.

### Exporting and Importing

**Export:** Choose **Export as JSON** in a character card's menu, or **Export** in the Character Editor's header, to download a `.json` file. This is a complete backup of your character data.

**Import:** Click **Import** on the Characters page and upload a previously exported JSON file. The character appears in your library.

> **Tip:** Export your character after every few sessions as a backup. It takes five seconds and could save you hours of re-entry if something goes wrong.

---

## Your Profile

Click your avatar (the round picture at the top right of the dashboard) to reach your **Profile & Settings** page.

*Screenshot pending — Profile page.*

### Setting Up Your Profile

**Display Name:** Click **Edit** beside **Profile Information** to change it, then **Save Changes**. This is what everyone else sees, and it can be 2 to 50 characters.

**Avatar:** Click your avatar (or the placeholder) to upload a profile picture, a JPEG, PNG or WebP image. Use the built-in crop tool to frame it:
- Drag the image to reposition
- Use the zoom slider to zoom in/out
- Click **Apply & Upload** when you're happy

A new avatar replaces the old one, and the old picture is deleted. **Remove Avatar**, under your avatar, takes it away and deletes the picture, and you are shown with the placeholder again.

*GIF pending — Avatar upload and crop.*

**Bio:** Add an optional bio of up to 500 characters, with the same **Edit** button. Great for introducing your character roster or your player persona.

### Security Settings

**Change Password:** In the Security section, enter your current password and your new password (twice), then click **Change Password**.

**Multi-Factor Authentication (MFA):** For extra security, press **Enable** beside **Two-Factor Authentication**. You'll need an authenticator app (Google Authenticator, Authy, 1Password, etc.). Enter your current password to begin, scan the QR code shown during setup, verify the code to confirm, and save the 10 backup codes somewhere safe. Turning MFA on signs out your other devices. The Profile page then shows how many backup codes you have left, and **Backup Codes** makes new ones.

*Screenshot pending — MFA setup with QR code.*

### Themes & Fonts

The **Appearance** section of your profile lets you pick the color theme and font *you* see across the app. 16 built-in themes (warm, cool, dark, neutral, vibrant) plus 8 open-source font families. There's also a **Custom** option for picking your own primary/accent/background/text colors. Your choice saves to your account and persists across logout/login — when you sign back in, your theme is restored.

---

## Quick Reference

### Dice Notation Cheat Sheet

| Roll | Notation |
|------|---------|
| Single d20 | `d20` or `1d20` |
| Two d6 | `2d6` |
| d20 with +5 bonus | `1d20+5` |
| 4d6 drop lowest (ability scores) | `4d6kh3` |
| Percentile | `d100` |
| Advantage (D&D) | `2d20kh1` (the **Adv** button) |
| Disadvantage (D&D) | `2d20kl1` (the **Dis** button) |

### Session Status Indicators

| Status | What it means |
|--------|--------------|
| Preparation | No session has been run yet — you can move your token |
| 🟢 Live | Session is active — you can move your token |
| 🟡 Paused | DM paused — token movement disabled, and your rolls from the Dice tab stay in your own browser: the DM and other players don't see them. Rolls from your sheet or a **Roll...** menu still reach the table |
| ⚫ Inactive | The last session has ended — token movement disabled |

The campaign card on the dashboard calls a **Live** campaign **Active**.

### Keyboard Shortcuts

| Action | Shortcut |
|--------|---------|
| Send chat message | Enter |
| New line in chat without sending | Shift + Enter |
| Ping the map | Tab (cursor over the map) |
| Place a spell area off the grid | Alt + click (AoE tool) |
| Drop a placement / close the tool | Esc |

### Common Questions

**My token isn't on the map.** Ask your DM to place it. They drag your character onto the map from the Campaign Roster.

**I can't move my token.** Check that the session isn't Paused or Inactive, and that the token is yours to move (your DM sets that in **Edit Token**).

**CozyVTT won't open on my tablet or old computer.** It needs Chrome or Edge 111, Firefox 128 or Safari 16.4 (iPadOS 16.4 on an iPad), or newer: Chrome, Edge and Safari from 2023, Firefox from 2024. An older browser may not load the app, or may draw parts of it wrongly, so update the browser or use another device.

**I lost connection.** CozyVTT reconnects by itself; **Retry** beside the connection indicator in the header tries at once. Your session state is saved on the server.

**Someone edited my character.** Only you and your campaign's DM can edit your characters. If you have concerns, speak with your platform administrator.

**I need to switch characters.** From the Characters page, unassign your current character from the campaign and assign the new one. Let your DM know so they can update the token.

**I forgot my password.** Use the **Forgot password?** link on the sign-in page if your instance sends email. Otherwise contact your platform administrator — they can reset it and give you a temporary login.

---

*For a complete feature walkthrough including asset management, see the [User Guide](USER_GUIDE.md).*

*Running your own campaign? Check out the [DM Guide](DM_GUIDE.md).*
