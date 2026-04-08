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
```

## Coding Conventions

- Functional components with hooks
- Material-UI components for UI elements
- Services layer (`src/services/`) for API calls
- Keep device-specific UI in dedicated subdirectories (e.g., `components/minidsp/`)
