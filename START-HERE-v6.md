# Elite Boss Atlas v6 — Redesign & Logo Fix

This release fixes the incorrect extensionless `logo` file by supplying the correctly named:

- `logo.svg`
- `icon-192.png`
- `icon-512.png`
- `apple-touch-icon.png`

All logo and icon references now use the root of the repository, so no `assets/icons` folder is required.

## Upload to GitHub

1. Extract this ZIP.
2. Keep your existing live `config.js` because it contains your Supabase settings.
3. In GitHub choose **Add file → Upload files**.
4. Drag every item from inside this folder onto the upload page.
5. Commit directly to `main`.
6. Delete the old extensionless file named `logo` after `logo.svg` is visible.
7. Wait for Vercel to show **Ready**, then refresh with `Ctrl + F5`.

## Expected root files

```text
index.html
app.js
styles.css
config.js
manifest.webmanifest
sw.js
logo.svg
icon-192.png
icon-512.png
apple-touch-icon.png
assets/
```

No SQL migration is required.
