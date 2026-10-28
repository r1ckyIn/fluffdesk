Free time slots to offer instead, as toggle chips; at most three can be pressed.

- `<button class="chip" aria-pressed>`: 28px tall, `radius-pill`, `control` border, `body` text with tabular figures. Pressed takes the `accent` fill and `on-accent` text; this is the one place `accent` fills a control other than the primary button, because a pressed chip is a selection.
- When three are pressed the rest go disabled rather than silently ignoring a fourth click. The requested slot itself is never offered.
- The chips sit under a day picker (prev / date / next) and above a `small` `muted` summary line of what is picked.
