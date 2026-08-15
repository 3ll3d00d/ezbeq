# Frontend Conventions

## Tech Stack

- **React** + **Material-UI (MUI)** — see `package.json` for exact versions
- **Vite** as build tool
- **Vitest** for unit tests
- **Yarn** as package manager

## Development

```bash
cd ui
yarn install            # Install Node dependencies
yarn dev                # Dev server with hot reload
yarn build              # Build production assets to ezbeq/ui/
yarn test:unit          # Run Vitest unit tests
yarn test:unit --run --coverage  # Same, with the coverage report CI gates on
```

## Coding Conventions

- Functional components with hooks
- Material-UI components for UI elements
- Services layer (`src/services/`) for API calls
- Keep device-specific UI in dedicated subdirectories (e.g., `components/minidsp/`)
- This repo is on **MUI v9**: `TextField`'s legacy `inputProps`/`InputProps` props are silently dropped (they land on the wrong DOM node and never reach the native `<input>`) — use `slotProps={{htmlInput: {...}}}` / `slotProps={{input: {...}}}` instead. If a `type="number"`/`inputMode`/`step` stops working after touching a `TextField`, check this first.
- Heavy, rarely-needed dependencies (e.g. `@mui/x-data-grid`) should be `React.lazy()`-loaded behind a `Suspense` boundary rather than imported eagerly — see `Catalogue` in `components/main/index.jsx`. If a lazy chunk renders unconditionally on first paint (not behind user interaction), also add a `modulepreload` hint for it in `vite.config.js` (see `preloadLazyChunk`) so it fetches in parallel with the main chunk instead of only being discovered after the main chunk executes.
