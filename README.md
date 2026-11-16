# Freezer Inventory

A browser app for personal −80°C and −20°C freezer inventories. No accounts, server database, or invitation setup is required.

Create a workbook with 8 × 8, 9 × 9, or 10 × 10 boxes, or open an existing freezer workbook. Add single vials or paste a batch, search all boxes, edit vial details, copy vials into empty positions, move vials, record partial volume use, take vials out, and return temporary withdrawals. Each change retains before/after history.

Workbooks are stored in IndexedDB in the current browser. Multiple workbooks can be kept separately. The app link shares the tool, not the records. Download Excel or a JSON backup before clearing browser data or switching computers. Opening a file reads it locally; it does not overwrite the source file. Download Excel to save an updated file.

Excel exports include a readable Sample log, the box maps, a Change log, and an internal history sheet that preserves full history when reopening the file in the app. Existing Freezer Quick Entry 10 × 10 templates can also be imported. Keep the internal history sheet if you edit an exported workbook in Excel. Edit the box sheets; the Sample log is a readable summary. On reopening, conflicting grid/table labels, missing sheets, and Sample-log changes that do not match the box sheets are flagged rather than silently ignored.

## Faster entry and retrieval

- **Daily note:** write one action per line, such as `Today I froze two vials of Sample 001 in box7 at B2 and B3, 100 µL each` or `Took out C1 and C2 from box7`. Common details work without commas. Exact positions, non-adjacent lists, ranges, numbered boxes, and starting positions are supported. A compact interpretation appears first; expand Review or edit details to correct fields directly. Unclear text is retained in Notes and requires review. The local parser does not use an external AI service; check the proposed positions before saving. Count mismatches, duplicate positions, and occupied destinations block the save. Decimal and scientific amounts are supported; total batch amounts need a per-vial value. Edited previews are saved separately for each workbook in this browser and restored after refresh, and positions are checked automatically after each edit or refresh. Valid entries show an enabled Save button with the vial count; blocking problems appear directly beside it. Discard draft clears both the note and its preview.
- **Scan a label:** choose a clear printed-label photo, correct the recognized text, and prepare an editable entry. Tesseract runs on the device; the first scan downloads its engine and English recognition data from public CDNs. Photos are not uploaded or retained in workbooks. Handwriting and curved labels may need manual correction.
- **Ask inventory:** find samples and locations, count vials, inspect low stock, sort by recorded freeze date, check expiry, see empty positions, and retrieve taken-out records. Answers use the current workbook's records and supported query patterns, not a general-purpose chatbot.
- **Undo last save:** reverses all lines saved together from a daily note, including take-outs and reused positions. It also reverses the most recent individual vial change.
- **Copy vial:** click an occupied position, choose Copy vial, adjust details and count, then review destination positions. New copies default to today's date and zero thaws. The original stays unchanged; Undo removes the new copies.

## Bringing an older inventory

Open an `.xlsx` workbook. App exports reopen directly. Other tabular inventories open a conversion wizard: check each sheet's header row, column mappings, freezer temperature, box dimensions, and position numbering; preview counts and review items; then open the converted copy. This currently supports tables with one row per occupied position, not arbitrary visual box-map layouts or merged lists of multiple vials in one cell.

Numeric positions such as 1–81 stay numeric. Unmapped columns, uncertain amounts, comments, identity qualifiers, and notes outside the table are retained with their source references. The converter blocks duplicate positions and rows that do not fit the selected box. Unknown dates and amounts remain unknown instead of being guessed. Existing workbooks remain separate, and the source file is never overwritten.

Version 1 backups remain readable. Version 2 adds box dimensions, numeric numbering, and import notes. Excel exports preserve these through visible metadata and the internal history sheet.

## Development

Use Node.js 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm dev
pnpm build
```

The production site is the `dist` directory. `base: './'` supports GitHub Pages project URLs. Select GitHub Actions as the publishing source in the repository's Pages settings. The included workflow tests, builds, and publishes changes from `main`.

No workbook, personal sample records, local app configuration, credentials, or backups belong in this repository.
