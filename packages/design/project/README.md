# fluffdesk design system

fluffdesk is the booking agent for solo pet groomers in Sydney. Customers ask for a price from the
shop's Instagram, WhatsApp or website; the agent recognises the pet, quotes a range from the shop's
own price list, finds a slot and holds a booking. The groomer confirms or declines it from this app,
corrects the agent where it was wrong, and edits the price list and hours.

This system covers the groomer app and the customer chat page. It takes its colours and typefaces
from the Eirlys AI design spec (2026-10-21), because fluffdesk is an Eirlys product. Everything
else, how screens are composed and what is not allowed, follows tasteskill v2's app-screen rules,
style `framed-sheet`.

`tokens.json` is the only source of values. `dist/tokens.css` is generated from it
(`npm run build -w packages/design`); the web app imports that file and references tokens only.

## Content

- **Voice.** Plain, short, in the groomer's own words: "Waiting for you", "Confirmed", "Declined",
  "Suggested another time". No "Welcome back", no exclamation marks, no emoji.
- **Bilingual.** Every string exists in English and Chinese (`{ en, zh }`, the same shape as the shop
  config). English before Chinese in a font stack so Latin letters and digits fall to the Latin face.
  A space between Chinese and Latin runs. Chinese line height 1.7 for body text, 1.1 for titles; no
  negative letter-spacing on Chinese.
- **Numbers.** Tabular figures everywhere a number can change. Prices as a range with the currency
  once: `$85–110`. Times in the shop's timezone, 24-hour, `Tue 4 Nov, 10:00`. Zero prints as 0,
  missing as a grey dash.
- **Proof is never invented.** No sample reviews, no vanity totals; sample bookings for demos are
  labelled as samples.

## Colour

One brand hue, `accent #4b3f72`, kept under 5% of any screen: the primary button, the selected row,
the focus ring, the main data element. The chrome is the pearl ground and the sheet; depth is one tone
step, never a shadow. Status is the only other colour on the screen:

| status | text | fill | meaning |
| --- | --- | --- | --- |
| pending | `pending` | `pending-bg` | the agent held it; the groomer has not decided. The one thing to do. |
| confirmed | `confirmed` | `confirmed-bg` | the groomer said yes |
| declined | `declined` | `declined-bg` | the groomer said no (with or without another time) |

Text uses `ink` and `muted` only; both reach 4.5:1 on `ground`, `sheet` and `raised`. Nothing on the
screen is pure white or pure black. Not allowed: gradients, glows, resting shadows, orange, saturated
violet, icons in tinted squares, a dark sidebar.

### The pearl ground

The frame carries the Eirlys pearl image (three pale fields of lilac, cyan and pink on `ground`, a
pre-rendered PNG scaled to the viewport) when the viewport is 900px or wider; on the phone the frame
is flat `ground`. Never a CSS radial gradient or a blur filter in its place.

## Type

Two families, each with one job:

- **Figtree Variable** (with **Noto Sans SC Variable** for Chinese) sets everything people read and
  work in: body 14/20, labels 12/16 at 500, section titles 16/24 at 600, KPI values 24/28 at 400,
  tabular figures on every number. Weights 400, 500, 600; nothing heavier.
- **Fraunces Variable** (with **Noto Serif SC** for Chinese) appears twice: the wordmark at the top of
  the shell and the page title at 24/28, weight 400, `font-variation-settings: "SOFT" 100, "WONK" 0`,
  optical size following the font size. Never on a number, a label or a button.

Geist Mono from the Eirlys spec is not used in the app: an app screen has one grotesk and one
second face with one job, and Figtree's tabular figures do the mono's work.

App type is not display type: no title above 32px, no figure above 40px. Sentence case everywhere,
tracking 0; small uppercase letter-spaced labels are not used.

## Layout

- The `framed-sheet` shell: sidebar (228px, labelled, on `ground`) and top bar (48px, on `ground`,
  no rule between them) form one L-shaped frame; the work sits on a `sheet` inset 8px from the
  window's right and bottom edges, `radius-sheet` corners, 1px `border` edge, no shadow.
- One gutter, `space-5` (24px), for every row on desktop; `space-4` (16px) on the phone. Cards on the
  sheet use `radius-card`, a 1px `border` edge lighter than or equal to the sheet's, never heavier.
- Three levels only: frame, sheet, card. Nothing nests inside a card.
- The phone folds the sidebar into a bottom bar; the sheet fills the width with no inset.
- Rows 48px, controls 32px. Numbers right-aligned in columns.

## Motion

Eirlys easings: `bloom cubic-bezier(0.16, 1, 0.3, 1)` for things entering, `settle cubic-bezier(0.7, 0,
0.2, 1)` for things already on screen moving, `hover cubic-bezier(0.3, 0.7, 0.2, 1)` for colour and
opacity. Durations: press 140ms, hover 220ms, screen change 280ms. Transform and opacity only; every
move drops its travel under `prefers-reduced-motion`. Idle screens are still.

## Iconography

Plain line icons in the text colour, 16–18px, next to their label; never in a tinted circle or
square. The product mark is a simple monogram in `accent` drawn for fluffdesk (to be designed), never
a letter in a black square. The Eirlys wordmark and snowdrop mark are Eirlys's and do not appear in
fluffdesk.
