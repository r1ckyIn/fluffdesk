Inputs, selects and text areas, all 32px tall with the label above in `label` `muted`.

- `<label class="field"><span>Label</span><input class="input"></label>`; `.select` and `.textarea` share the border (`control`), radius (`radius-control`) and ground (`sheet`). Focus is the 2px `focus` outline with the border turning `accent`.
- Placeholders are examples in `muted` ("Fully booked that morning"), never instructions.
- Numbers (`.num`) use tabular figures and `inputMode` decimal or numeric. Bilingual fields come as a pair, English then Chinese, in one `.form-row`.
- Validation messages come from the server's schema and are shown as text beside the save button in `declined`; fields are not outlined red.
