# Brand

- `fluffdesk-mark.svg`: the product mark, a comb with three teeth, drawn in `accent` on a `ground` tile with a 14/64 corner. The app draws the same shape inline in `currentColor` (components/Mark.tsx) so it can sit in the sidebar at 22px in `accent`. Never a letter in a black square; never the Eirlys snowdrop.
- `pearl.png`: the pearl ground, 640×400, three pale fields (`pearl-lilac`, `pearl-cyan`, `pearl-pink`) on `ground`, pre-rendered. Stretch it to the viewport (`center / 100% 100% no-repeat`) behind the frame on screens 900px and wider. Never replace it with a CSS radial gradient or a blur filter.
