One primary button per screen, in `accent`; everything else is quiet.

- `.btn.btn-primary` is the screen's one filled action (Confirm booking, Save changes). `accent` fill, `on-accent` text, `accent-deep` on hover.
- `.btn.btn-outline` for the secondary action beside it (Decline, Save correction): `control` border, no fill.
- `.btn.btn-quiet` for navigation-like actions (Back, Keep it waiting, Remove): no border, `muted` text.
- `.btn.btn-danger` for the destructive confirm inside a panel (Send decline): `declined` text, `declined-bg` on hover. Never filled red.
- Height is `control` (32px), radius `radius-control`, label in `nav` (14/20 at 500), sentence case, never uppercase. Disabled is 55% opacity, no colour change.
- Press moves the button 1px down over `t-press`; hover changes colour over `t-hover`. No shadow, no gradient, no icon in a tinted square.
