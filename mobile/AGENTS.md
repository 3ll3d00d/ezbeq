# Mobile App Conventions

Cross-platform (iOS/Android, phone + tablet; Apple TV as a later fast-follow) mobile client for
ezbeq, reimplementing the web UI's main filter page (`ui/src/components/main/`). See the root
`AGENTS.md` for how this fits into the wider repo, and the design plan this was built from for the
full rationale.

## Tech Stack

- **Expo** (managed workflow) + **React Native**, TypeScript
- **React Navigation** (`@react-navigation/native` + native-stack) — not Expo Router, kept deliberately
  simple so a future `react-native-tvos` port has a well-trodden focus/navigation story to build on
- **React Native Paper** (MD3) as the base component library, with a small set of genuinely-native
  substitutions (slider, native menu, action sheet) wrapped behind `Adaptive*` components so call
  sites never branch on `Platform.OS` themselves
- **Jest** (`jest-expo` preset) + **@testing-library/react-native** for tests

## Development

```bash
cd mobile
npm install             # Install dependencies
npm start                # Expo dev server (scan the QR with Expo Go, or press i/a)
npm test                 # Run Jest unit tests
npm test -- --coverage   # Same, with the coverage report CI gates on
npm run typecheck        # tsc --noEmit
```

To exercise the app against a real backend, run `bin/run-server-stub` from the repo root (no
hardware required) and pair the app with `http://<host-LAN-IP>:9968`.

Run `npm test` (the full suite, unfiltered) and `npm run typecheck` before every push, and if the
change touches anything mirrored from `ui/src/components/main/`, run `ui/`'s suite too — see the
root `AGENTS.md`'s "Before pushing" section for why this matters here specifically (a narrowed test
run is how `f8c49c4` shipped a mobile-only regression that CI caught but nobody noticed for two
days).

## Coding Conventions

- Functional components with hooks; no class components
- Service layer (`src/services/`) mirrors `ui/src/services/` — when porting logic from there, keep
  method/function names identical so future diffs against the web source stay easy to reason about
- `@testing-library/react-native` v14's `render()` is **async** — always `await render(...)` (or use
  `await screen.findBy...`), unlike the synchronous Vitest/RTL calls used in `ui/`. Forgetting the
  `await` doesn't throw; it just makes every query on the result silently not a function
- Keep `Platform.OS` branching confined to the `Adaptive*` wrapper components (`src/components/common/`)
  rather than scattered through screens — this is also what keeps a future `Platform.isTV` branch a
  single-file change per component instead of an app-wide search

## Test setup gotchas

`jest.setup.js` wires up two mocks any test that renders through `NavigationContainer` needs:

- `react-native-gesture-handler/jestSetup` (required by `GestureHandlerRootView` in `App.tsx`)
- a spread-out `react-native-safe-area-context/jest/mock` — the upstream mock ships as a default
  export, but `react-navigation` consumes it via named imports (`SafeAreaProvider`,
  `useSafeAreaInsets`, ...), so mocking the module as `require('.../jest/mock')` verbatim leaves
  those undefined. Spread both `mock` and `mock.default` into the returned object (see
  `jest.setup.js`) rather than reverting to the single-line form from the library's own docs.

Both are already registered globally, so component tests don't need to repeat this - only
`App.test.tsx`-style tests that mount the full navigation tree exercise the failure mode above.

- **Prefer `userEvent` over `fireEvent` for anything that changes text then presses a button in
  the same test.** `fireEvent.changeText(...)` immediately followed by `fireEvent.press(...)`
  regularly fires the press against a still-stale render (e.g. a submit button that should now be
  enabled, but whose `disabled` prop hasn't caught up yet) - React 19's concurrent-mode updates
  aren't guaranteed flushed between two bare `fireEvent` calls the way earlier RN Testing Library
  usage assumed. `userEvent.setup()` + `await user.type(...)`/`await user.press(...)` wraps each
  step so state has actually propagated before the next interaction fires - see
  `src/screens/connect/ConnectScreen.test.tsx`. Plain `fireEvent` is still fine for a single
  isolated interaction (one press, one changeText) with no follow-up interaction that depends on
  its result.
- When typing into a field that already has a non-empty value (e.g. a default like `"8080"`),
  `user.type()` appends rather than replaces - call `await user.clear(field)` first.
- `toHaveTextContent(text)` defaults to an **exact full-text match**, unlike jest-dom's substring
  default on the web (`ui/`) - `toHaveTextContent('d1')` fails against `"{"d1":...}"` or
  `"hello d1"`. Pass `{exact: false}` as a second argument when asserting a substring (e.g.
  checking a `JSON.stringify()`-dumped debug `<Text>` in a context test) - see
  `src/context/DeviceStateContext.test.tsx`.
- **`act(callback)` from `@testing-library/react-native` always needs `await`, even for a
  synchronous callback.** Its implementation unconditionally wraps the callback as
  `async () => await callback()`, so `act(() => result.current.someSetter(x))` returns a promise
  whose state update hasn't necessarily committed yet by the next line - reading `result.current`
  right after gets a stale value (or `null`, if the update was a re-render triggered by
  `renderHook`'s own effect). `renderHook`'s returned `rerender` has the same issue - it's async
  too. Symptom if missed: `console.error` noise ("You called act(async () => ...) without await")
  plus assertions reading pre-update state. See `src/services/gains.test.ts`.
- Paper's `Banner` (and other components with a built-in show/hide animation) logs "An update to
  Animated(View) inside a test was not wrapped in act(...)" after the test body finishes, from its
  entry animation still ticking. Harmless noise, not a real failure - see
  `src/components/common/DeviceDisconnectedBanner.test.tsx`.
- **Multiple `<Portal>`-rendered components (e.g. two `Snackbar`s mounted at once) come back from
  `getAllByLabelText`/`getAllByRole` in *reverse* mount order**, not render order - Paper's
  `Portal.Host` prepends new entries rather than appending them. `index 0` is the most-recently-mounted
  portal's content, not the first one in your JSX. Confirmed by pressing each result and checking
  which component's callback actually fired, not by assumption - see
  `src/screens/main/MainScreen.integration.test.tsx`. Also, Paper's `Snackbar` only actually
  unmounts (returns `null`) after its exit animation's `Animated.timing(...).start()` completion
  callback fires; real timers under Jest don't reliably drive that to completion, so assert the
  dismiss handler's *effect* (e.g. a persisted AsyncStorage key) rather than waiting for the
  Snackbar's text to disappear from the tree.
