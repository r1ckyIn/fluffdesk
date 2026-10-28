A request in the queue: who, how long ago, which pet and service, the time and the quoted range.

- A `<button class="row" role="option">` so the whole row is the target. 72px minimum, 12px vertical padding, `space-5` sides on desktop (`space-4` on the phone). Rows are divided by a 1px `rule`; no zebra, no card per row.
- Line 1: `.who`, the customer's name at 14/20 600 in `ink`; `.when` right-aligned in `small` `muted`, as words ("9 min", "Yesterday").
- Line 2: `.what`, pet name · breed guess · service, in `muted`, one line with an ellipsis.
- Line 3: `.time`, requested time and quoted range, `muted`, tabular figures.
- Selected row: `aria-selected="true"` takes the `active` fill, the same tone as the active nav item. Hover takes `raised`. Neither is a saturated fill or a left bar; the focus ring is the `focus` outline and nothing else.
- Faded rows are never used for identity: a read row keeps its name in `ink`.
