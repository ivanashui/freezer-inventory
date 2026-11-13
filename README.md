# Freezer Inventory

A browser app for personal −80°C and −20°C freezer inventories. No accounts, server database, or invitation setup is required.

Create a workbook with 10 × 10 boxes, or open a compatible freezer workbook. Add single vials or paste a batch, search all boxes, edit vial details, move vials, record partial volume use, take vials out, and return temporary withdrawals. Each change retains before/after history.

Workbooks are stored in IndexedDB in the current browser. Multiple workbooks can be kept separately. The app link shares the tool, not the records. Download Excel or a JSON backup before clearing browser data or switching computers. Opening a file reads it locally; it does not overwrite the source file. Download Excel to save an updated file.

Excel exports include a readable Sample log, the box maps, a Change log, and an internal history sheet that preserves full history when reopening the file in the app. Existing Freezer Quick Entry 10 × 10 templates can also be imported. Keep the internal history sheet if you edit an exported workbook in Excel.

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
