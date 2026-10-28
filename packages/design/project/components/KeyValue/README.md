Facts about a booking as a two-column list: the label in `muted`, the value in `ink`.

- `<dl class="kv">` with a 160px label column (120px on the phone), rows on a 32px pitch divided by 1px `rule` lines; no line above the first row.
- Values that are numbers (contact, duration, quote) carry `.num` for tabular figures. A secondary note sits after the value in `muted` ("· Final price is assessed in store").
- Missing values print as an em dash, never blank, never "N/A".
- Two `kv` blocks side by side (`.two-col`) share one top edge; on the phone they stack.
