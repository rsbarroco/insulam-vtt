# Insulam appearance

The Character Maker reference uses charcoal (#100e14), panel purple (#19161f),
antique gold (#c4a15a), ivory (#f3eada), Fraunces and Outfit. Its current interface
is dark; it does not expose a light/dark switch.

The VTT adds **Insulam — Night** and **Insulam — Day** to its existing theme picker,
and **Insulam (Fraunces + Outfit)** to the font picker. An administrator can choose
the installation defaults under Default Theme; individual profile preferences
continue to override those defaults. Existing theme IDs and fonts are preserved.
The light variant is a VTT alternative, not a claim that Character Maker has one.

Fonts are served locally with their SIL Open Font Licenses in
`frontend/src/assets/fonts/`. No third-party font requests are introduced.
The existing theme contrast suite checks both new palettes. The browser suite
checks dashboard and character actions and creation dialogs at 320, 360, 390 and
412 pixels in both palettes, including reloading the user's saved preference.

The tabletop still offers its existing small-screen notice. Fitting the navigation
and forms on a phone does not imply feature parity with a desktop tabletop.
