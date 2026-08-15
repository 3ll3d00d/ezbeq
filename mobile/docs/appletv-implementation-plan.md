# Implementation plan: Apple TV app

**Status: Phase 0/1 done, Phase 2 scaffolded, Phase 3 partially scaffolded** - see "Phase 0/1
findings" and "Phase 2/3 findings" below for what actually landed vs. what's still open. Everything
past Phase 1 that touches JS/TS was written and covered by `npm run typecheck` + `npm test`
(`Platform.isTV` mocked via `jest.spyOn(Platform, 'isTV', 'get')`, established in
`useTVBackHandler.test.ts` and reused throughout), but **nothing has been verified against a real
tvOS build or a real remote**: this and all prior work happened on a Linux box with no Xcode/macOS
available, so `expo prebuild --platform ios` and any actual simulator/device run are still
completely unexercised. Every UX call flagged below as "unverified" needs an actual Apple TV or
tvOS Simulator session before it can be treated as done, not just "type-checks and has a passing
Jest test for the props it produces."

This is the design record for turning the phone/tablet app (`mobile/`)
into a `tvOS` app, expanding on the one-paragraph note in [`../README.md`](../README.md)'s "Apple
TV" section. The sections below are kept in their original (mostly not-yet-landed) form as the
design rationale; where something has since actually landed or been resolved, the phase heading and
the "findings" sections above say so explicitly - don't assume a phase is untouched just because its
own body text still reads as a forward-looking plan.

## Why this is more than a config flag

The app was deliberately built (plain React Navigation, `Adaptive*` wrapper components, no
gesture-only interactions on the *primary* interaction paths) to make this tractable, but "tractable"
still means real work in four independent areas: the native toolchain (`react-native-tvos`), the
input model (touch → remote/focus engine), a couple of screens that assume hardware phones don't
have (camera for QR pairing) or interaction patterns tvOS's focus engine doesn't support (drag-based
sliders, pull-to-refresh), and a second CI/distribution pipeline (tvOS has no App Store sideloading
equivalent to Android's signed APK, and Apple's tooling only runs on macOS, same constraint as
[`ios-ci-automation-plan.md`](ios-ci-automation-plan.md) already dealt with for iOS).

## Phase 0: Spike (do this before committing to the plan below) — ✅ toolchain question resolved

The core compatibility question is resolved (see "Phase 0/1 findings" below); the four
cheap-spike bullets about `react-native-gesture-handler`/`reanimated`, `FlashList` focus scrolling,
the slider, and Paper's focus affordance are all still genuinely open - none of them can be
answered without a real `expo prebuild --platform ios` + tvOS Simulator/device session, which this
work never had access to.

The plan below assumes `react-native-tvos` and `@react-native-tvos/config-tv` support this app's
current `react-native@0.86.2` / `expo@~57.0.12`. **Confirm that before scoping the rest** - the
`react-native-tvos` fork tracks upstream RN releases with a lag, and `@react-native-tvos/config-tv`
tracks specific Expo SDK versions. If the fork hasn't caught up to RN 0.86.2 / Expo 57 yet, the
options are: wait, pin `mobile/` back to a version the fork does support (disruptive to the
phone/tablet app for a TV-only feature - avoid if at all possible), or vendor/patch the gap. Do not
proceed past this phase on an assumption.

Also spike, cheaply, before Phase 3's deeper per-component work:

- Does `react-native-gesture-handler` / `react-native-reanimated` (both native modules, already in
  `package.json`) build and run at all under `-sdk appletvos`? These are load-bearing for React
  Navigation's native-stack.
- Does `@shopify/flash-list` accept focus-driven scrolling (D-pad up/down moving through a long
  list) out of the box, or does it need `TVFocusGuideView`/manual `scrollToIndex` wiring? This
  drives how much rework `CatalogueList.tsx` needs.
- Does `@react-native-community/slider` render/respond to remote input on tvOS at all? (Likely
  answer: no meaningful drag gesture exists on a remote - see Phase 3's `GainRow` section
  regardless of what the spike finds, but confirm it doesn't crash before assuming a full
  replacement is needed.)
- Does `react-native-paper` (MD3 components: `Button`, `TextInput`, `Modal`/`Portal`, `Checkbox`,
  `RadioButton`, `Snackbar`, `Badge`) show any focus affordance on tvOS out of the box? Paper isn't
  TV-aware upstream; expect "no visible focus ring" as the baseline finding, which sets the size of
  Phase 2's focus-styling work.

## Phase 0/1 findings (confirmed 2026-08-15)

- `react-native-tvos@0.86.2-0` exists on npm and is an exact match for this app's
  `react-native@0.86.2` - tagged both `latest` and `0.86-stable`. `@react-native-tvos/config-tv`
  (latest `0.1.6`) has no pinned Expo SDK peer and lists Expo's own `brentvatne` as a maintainer -
  active, not abandoned.
- Landed: `package.json`'s `react-native` dependency is now
  `"npm:react-native-tvos@0.86.2-0"`, per the package's own documented alias-install convention.
  This alone was **not** sufficient - two follow-up fixes were needed before `npm install` produced
  a working tree:
  - Added an `"overrides"` block pinning `"react-native": "npm:react-native-tvos@0.86.2-0"` for the
    whole dependency graph. Without it, a clean install hard-fails (`ERESOLVE`): some transitive
    peer dependencies ask for the literal, unaliased `react-native` package name, and npm tries to
    install a second, real copy of React Native to satisfy them rather than accepting the alias.
  - Added `expo-modules-core` (pinned `~57.0.10`, matching what `expo` itself resolves to) as an
    **explicit top-level dependency**. Without this, `expo-modules-core` installs correctly but
    npm nests it under `node_modules/expo/node_modules/` instead of hoisting it to the top level -
    root cause: `expo-modules-core` peer-depends on `react-native: "*"`, and npm's alias resolver
    doesn't cleanly match that peer against a package whose internal `name` field is
    `react-native-tvos`, so it conservatively avoids hoisting. `jest-expo`'s test setup does a bare
    `require('expo-modules-core')` that only resolves via top-level hoisting, so every single test
    suite failed (`Cannot find module 'expo-modules-core'`) until this was added. Confirmed via a
    full `rm -rf node_modules && npm install` (not just an incremental install, which had been
    silently reusing a stale resolution) that this combination installs clean with no `ERESOLVE`
    warnings at all, and `npm test`/`npm run typecheck` both pass in full (298 tests, 34 suites).
  - **Unresolved, flagged rather than fixed:** even after both fixes, one real (non-aliased,
    non-tvos) copy of `react-native` still ends up nested at
    `node_modules/react-native/node_modules/react-native`, pulled in by the official
    `@react-native/virtualized-lists` package's own peer requirement. It doesn't affect Jest/`tsc`
    (nothing in the app or test code resolves `react-native` from that nested path), but two
    physical copies of React Native core sitting in the same tree is exactly the kind of thing that
    can break a native build (duplicate native module registration, symbol clashes) - `npm ls
    react-native` and a real `expo prebuild --platform ios` output need to be checked once a macOS
    environment is available, before assuming this is harmless. If it does turn out to matter, the
    fix is likely an explicit `"@react-native/virtualized-lists": "npm:@react-native-tvos/virtualized-lists@<matching version>"`
    override, but don't add that speculatively without confirming the problem is real first.
- Converted `app.json` → `app.config.ts` (`app.json` deleted). The `@react-native-tvos/config-tv`
  plugin is only added to the `plugins` array when `EXPO_TV=1`/`true` (its own README confirms this
  env var is how it's conventionally gated), via a new `npm run tvos` script
  (`EXPO_TV=1 expo run:ios`) alongside the existing `ios`/`android` scripts. `appleTVImages` is
  deliberately left unset in the plugin config - the plugin throws if that option is set with any
  path missing, and Phase 4's TV-specific icon/top-shelf art doesn't exist yet.
- **Still not attempted, blocking real verification of all of the above:** `EXPO_TV=1 npx expo
  prebuild --platform ios` has never actually been run - this requires macOS (Expo's iOS prebuild
  tooling, like the rest of the toolchain, only runs there). Everything from here on (Phase 2's
  `TVFocusGuideView`/focus-engine behavior, Phase 3's per-screen work, and the CocoaPods-level
  question above) needs that environment to move from "designed" to "confirmed working."

## Phase 2/3 findings (confirmed 2026-08-15)

- **`Pressable`'s focus styling needs no custom wrapper.** react-native-tvos type-augments
  `PressableStateCallbackType` with a real `focused: boolean` field (confirmed in
  `node_modules/react-native/types/public/ReactNativeTVTypes.d.ts`) and `ViewProps` already
  includes `hasTVPreferredFocus`/`isTVSelectable` directly - so `style={({ focused }) => [...]}` on
  a plain `Pressable` is the idiomatic mechanism, not a bespoke `Adaptive*` focus wrapper as
  originally guessed in Phase 2's plan. One real rough edge: the augmentation doesn't merge into
  the specific type `Pressable.d.ts`'s own `style` prop signature references, so the callback needs
  a narrow `as PressableProps['style']` cast (see `SlotCard.tsx`/`CatalogueRow.tsx`) - this is a
  type-only gap, `focused` is genuinely present at runtime on tvOS.
- **`BackHandler.addEventListener('hardwareBackPress', ...)` is the confirmed, correct mechanism**
  for the tvOS remote's Menu button - resolves Phase 2's open question #2 outright.
  `BackHandler.ios.js`'s own source (not a guess - read directly from `node_modules`) says so in a
  comment, and `@react-navigation/native`'s `useBackButton` already registers a listener on it
  inside `NavigationContainer`, so **screen-to-screen back navigation works with zero code from this
  app**. `useTVBackHandler` (new: `src/hooks/useTVBackHandler.ts`) only covers what
  `NavigationContainer` can't know about: `MainScreen`'s Settings/What's New/filter sheets, which
  are Paper `Modal`/`Portal` overlays, not real stack screens. It closes whichever of the three are
  open rather than picking one - see the hook's own comment for why picking "the top one" isn't
  safe to do blind.
- **Testing `Platform.isTV`-gated code**: `jest.spyOn(Platform, 'isTV', 'get').mockReturnValue(true)`
  works cleanly since `isTV` is a plain getter - this is now the established pattern, reused across
  every new/touched test file. Testing `BackHandler` itself is a separate wrinkle:
  `BackHandler.ios.js` decides once, at module-evaluation time (long before any test file's mocks
  run), whether `Platform.isTV` means "wire up a real subscription" or "export a permanent no-op
  stub" - so `Platform.isTV` toggled after import can't change which implementation already loaded.
  `jest.spyOn(BackHandler, 'addEventListener')` (spying on the real, already-loaded no-op-under-Jest
  function) sidesteps this and is enough to test what a hook/component does *with* the API, without
  re-verifying react-native-tvos's own implementation. A full `jest.mock('react-native', ...)`
  replacement was tried first and rejected - `jest.requireActual('react-native')` inside the mock
  factory bypasses jest-expo's own native-module mocking and blows up on a real `TurboModuleRegistry`
  lookup (`DevMenu`) that only jest-expo's controlled environment knows how to stub.
- **Paper's `Modal` keeps content mounted through its exit animation under Jest**, same as the
  already-documented `Snackbar` gotcha in `mobile/AGENTS.md` - a test that presses "close" and then
  asserts the sheet's text is gone will flake/fail even though the close handler fired correctly.
  Followed the same documented fix: assert the handler's effect (here, that
  `BackHandler.addEventListener` gets called only while a sheet is open) rather than the sheet's
  content disappearing from the tree.
- **Landed** (all typecheck+test-covered, all unverified against a real tvOS build - see the
  per-item notes for what's still a judgment call pending real-device confirmation):
  - `src/hooks/useTVBackHandler.ts` + wired into `MainScreen.tsx` for the three sheet overlays.
  - `MainScreen.tsx`: `showSplitView` forced `true` on `Platform.isTV` regardless of window size; a
    `Platform.isTV`-only refresh `IconButton` next to the search bar, since `CatalogueList`'s
    `RefreshControl` pull-to-refresh has no drag gesture on a remote.
  - `SlotCard.tsx`: split into two independently-focusable siblings (select area + clear button) on
    `Platform.isTV`, instead of the nested-Pressable structure the phone/tablet branch keeps
    unchanged - this was flagged in the original plan as needing "a real UX decision, not just a
    style tweak," and this is that decision, made without being able to see it rendered on an
    actual TV. Treat as a strong starting guess, not a confirmed-good layout.
  - `SlotsGrid.tsx`: `hasTVPreferredFocus` on the first slot card only, so the focus engine has
    somewhere sane to land on first render.
  - `CatalogueRow.tsx`: focus-ring style added unconditionally (inert off tvOS, since `focused` only
    ever becomes true from a real tvOS focus event).
  - `GainRow.tsx`: a `Platform.isTV`-only focus-based +/- stepper replaces the drag-only
    `@react-native-community/slider`, committing immediately per press (mirroring the slider's
    `onSlidingComplete`, since a button press has no in-progress "drag" state to report). The
    numeric exact-entry `TextInput` is unchanged and shared by both branches.
  - `RootNavigator.tsx` / `ConnectScreen.tsx`: the `ScanQr` route isn't registered and its launch
    button is hidden on `Platform.isTV` - a hard platform fact (no camera), not a judgment call.
- **Not started**: `TVFocusGuideView` containment (Phase 2 item 3 - deferred until a real device
  shows whether focus actually "escapes" `SlotsGrid`/`CatalogueList` without it, rather than adding
  it speculatively); the Connect-flow LAN discovery fast-follow; the filter-loaded-notification
  in/out-of-scope product decision; Phase 4 (icons/top-shelf art) and Phase 6 (CI/distribution),
  both still blocked on the same "needs macOS" wall as `expo prebuild` itself.

## Phase 1: Toolchain and prebuild config — ✅ done (see "Phase 0/1 findings" above)

1. Add `react-native-tvos` as an override/resolution for `react-native` (the two packages are
   drop-in replacements for each other at the same version, per upstream's own install
   instructions) and add `@react-native-tvos/config-tv` as a dev dependency.
2. Convert `mobile/app.json` to `mobile/app.config.ts` (a plain JSON config can't conditionally add
   the TV config plugin). Keep every existing key as-is; add the `config-tv` plugin to the
   `plugins` array, gated so a **phone/tablet** build stays unaffected - `config-tv` uses an
   `EXPO_TV` environment variable at prebuild time to decide whether to target `tvos`/`androidtv`,
   so no separate `app.json` fork is needed for phone vs. TV.
3. New root `expo-env.d.ts`/`.d.ts` changes are not expected; `Platform.isTV` is already part of
   `react-native`'s public `Platform` API, no new types needed.
4. New npm scripts in `package.json`: `tvos` (`EXPO_TV=1 expo run:ios --device` or equivalent -
   confirm the exact CLI invocation `config-tv`'s own docs specify once Phase 0 confirms the
   version in use) and `typecheck`/`test` stay platform-agnostic (Jest already runs against source,
   not a built binary).
5. `.gitignore` already excludes `ios/`/`android/` (both are `expo prebuild` output) - no change
   needed there; a `tvOS` prebuild reuses the same `ios/` directory path with a different scheme,
   per `config-tv`'s convention.
6. Confirm which Expo modules in `package.json` are no-ops vs. broken on tvOS and branch
   accordingly at prebuild time (`config-tv` supports per-module excludes similar to the existing
   `expo.autolinking.ios.exclude` pattern the iOS CI job already uses - see
   [`ios-ci-automation-plan.md`](ios-ci-automation-plan.md)):
   - `expo-camera` - no camera API on tvOS at all; exclude from the TV build rather than letting it
     fail at prebuild/runtime. (`ScanQrScreen` itself becomes phone/tablet-only, see Phase 3.)
   - `expo-notifications` - tvOS's notification model is materially different (no persistent
     per-app badge/tray the way iOS has); decide in Phase 3 whether the filter-loaded notification
     feature ships on TV at all before deciding whether to exclude the module outright.
   - `@react-native-community/netinfo`, `@react-native-async-storage/async-storage` - both have
     tvOS support upstream, no expected issue.

## Phase 2: Focus and input foundations — 🟡 mostly done, one item not started

This is the part with no phone/tablet analogue - build it before touching individual screens so
Phase 3 has something to build on rather than reinventing focus styling per component.

1. ~~**Focus-visible styling** via a `FocusableCard`/`useTVFocus` wrapper component.~~ **Done, but
   differently than planned** - turns out no wrapper is needed at all. `Pressable`'s own
   `style={({focused}) => ...}` callback (react-native-tvos type-augments it with a real `focused`
   field) and `ViewProps`'s built-in `hasTVPreferredFocus` cover this directly - see "Phase 2/3
   findings" above for the one type-only rough edge that requires a local cast. Landed in
   `SlotCard.tsx`/`CatalogueRow.tsx`.
2. ~~**Hardware back / Menu button.**~~ **Done** - `src/hooks/useTVBackHandler.ts`, confirmed to use
   `BackHandler` (not `TVEventHandler`) directly from react-native-tvos's own source, resolving what
   was an open question when this bullet was written. Covers `MainScreen`'s Settings/What's
   New/filter sheets; screen-to-screen back needed no code at all (React Navigation already wires
   this - see findings above). `MainScreen.tsx`'s phone-portrait `backSwipeGesture` itself doesn't
   need replacing on tvOS specifically - split view is now forced there (see Phase 3), so that
   single-column code path (the only one the swipe gesture applied to) never renders on tvOS at all.
3. **Focus containment for lists/grids** (`TVFocusGuideView`) - **not started**, deliberately: still
   waiting on the real-device signal this bullet always said it needed before adding it, which this
   work never had access to (see "Phase 2/3 findings" above).
4. **Initial focus** - **partially done**. `SlotsGrid.tsx` sets `hasTVPreferredFocus` on the first
   slot card. `ConnectScreen.tsx`'s host field does not yet - still open.

## Phase 3: Screen-by-screen adaptation — 🟡 partially done, see per-section status below

### Connect flow (no camera on tvOS) — 🟡 baseline done, fast-follow not started

`ScanQrScreen.tsx` (`expo-camera`-based) has no tvOS equivalent - Apple TV has no camera. Two
non-exclusive options, in order of value:

- **Baseline: manual entry works today.** `ConnectScreen.tsx`'s host/port form already works with
  no code changes beyond focus styling on its `TextInput`/`Button`/`SegmentedButtons` (Phase 2) -
  tvOS brings up its own on-screen keyboard for a focused `TextInput`. This alone is a complete,
  if tedious (typing an IP with a remote D-pad), pairing path. Ship this as the floor before
  building anything fancier.
- **Better: LAN discovery list.** Given every ezbeq server already exposes `GET /api/1/version` with
  no auth (see `ConnectScreen.tsx`'s `testConnection`), a discovery screen that mDNS/Bonjour-probes
  the LAN (or does a bounded parallel-probe sweep of the local subnet, if mDNS advertisement isn't
  already implemented server-side - confirm before assuming it exists) and lists reachable servers
  as focusable rows is a much better 10-foot UX than typing an IP with a D-pad. This is additive,
  not a replacement for manual entry (a server on a different subnet/VLAN still needs it) - treat
  as a fast-follow once the baseline ships, not a blocker.
- ✅ Done: `ScanQrScreen` isn't registered as a route (`RootNavigator.tsx`) and the "Scan QR code
  instead" button is hidden (`ConnectScreen.tsx`), both gated on `Platform.isTV`.
- **Not started**: the LAN-discovery fast-follow. Manual entry (the baseline) is fully functional
  today, so this remains a genuine "later" rather than a blocker.

### `MainScreen.tsx` — 🟡 mostly done, one item not started

- ✅ Split view is forced on `Platform.isTV` regardless of `useResponsiveLayout()`'s breakpoints -
  the phone-portrait single-column path (and its `backSwipeGesture`) now never renders on tvOS at
  all, which is what actually resolved the "replace `backSwipeGesture`" bullet this section
  originally called for, rather than a direct replacement of the gesture itself.
- ✅ An explicit `Platform.isTV`-only refresh `IconButton` next to the search bar replaces
  pull-to-refresh.
- **Not started**: TV-safe-area/overscan margins. `useSafeAreaInsets()` is still only fed through
  unchanged - nobody has checked whether `react-native-safe-area-context` already returns
  TV-appropriate insets on tvOS or whether a fixed minimum needs to be added, and that can only be
  checked on a real device/simulator.

### `SlotsGrid.tsx` / `SlotCard.tsx` — ✅ done, unverified on real hardware

- ✅ Focus-ring styling and `hasTVPreferredFocus` on the first slot, landed.
- ✅ The nested-clear-button problem has a landed decision: `SlotCard.tsx` splits into two
  independent `Pressable` siblings on `Platform.isTV` (select area + clear button) rather than the
  phone/tablet branch's nested structure. This is still exactly the kind of call this section said
  needed "an actual look at the rendered layout before picking one" - that look never happened (no
  macOS/device available), so treat this as a first guess to validate, not a settled design, once a
  real tvOS session is possible.

### `GainRow.tsx` (gain sliders) — ✅ done, unverified on real hardware

Landed as designed: a `Platform.isTV`-only focus-based +/- stepper, committing immediately per
press, with the existing numeric `TextInput` kept as the shared exact-entry fallback. Whether
`@react-native-community/slider` itself would have crashed or just been unusable on tvOS (the
original open question) is now moot - it's never rendered on `Platform.isTV` at all.

### Sheets/modals (`FilterSheet`, `SettingsSheet`, `WhatsNewSheet`) — 🟡 partially done

- ✅ Dismissal on the tvOS Menu button: `useTVBackHandler` in `MainScreen.tsx` closes whichever of
  the three is open.
- **Not started**: (a) moving focus into a sheet's first focusable element when it opens, and (b)
  returning focus to whatever opened it on close. Neither Paper's `Modal`/`Portal` behavior here nor
  whether react-native-tvos's focus engine already handles it automatically has been checked against
  a real build - both are still open exactly as originally written.

### Filter-loaded notification feature — ⬜ not started (product decision, not code)

Decide explicitly whether this ships on tvOS at all before doing any work on it - the underlying
use case (a persistent notification reminding you a filter is still loaded, so you remember to
clear it) is much less obviously useful on a TV a user is actively watching than on a phone in
their pocket. If out of scope for v1, exclude `expo-notifications` from the TV prebuild (Phase 1)
and hide `SettingsSheet`'s notification toggle behind `!Platform.isTV`, mirroring the existing
`filterNotificationSupported` gate that already hides it on Android+Expo Go for an unrelated reason
(see `src/services/filterNotification.ts`).

## Phase 4: Visual identity — ⬜ not started (blocked on real TV-specific art, not on macOS)

- **App icon.** tvOS icons are layered (front/middle/back, for the parallax "hover" effect on the
  home screen), a completely different asset format from the flat PNGs `assets/icon.png` /
  `android-icon-foreground.png` were derived from (see `../README.md`'s "App icon & splash screen"
  section for how those were sourced from `ui/public/android-chrome-512x512.png`). Whoever does
  this needs at least a foreground/background split of the existing brand mark, ideally three
  layers - budget real design time, this isn't a resize job.
- **Top shelf image.** tvOS additionally requires a "top shelf" wide-format image shown when the
  app is focused on the home screen - no phone/tablet equivalent exists to derive it from
  automatically; needs its own asset.
- **Typography/target sizing.** Paper's default MD3 sizing is tuned for touch targets (~48dp); TV
  content is typically read from ~10 feet away and needs larger text/target sizes for legibility,
  not just for focus-ring visibility. Scope this after Phase 3's per-screen pass shows which
  screens actually feel cramped on a real TV, rather than guessing sizes up front.

## Phase 5: Testing — 🟡 pattern established, applied to every landed component

- ✅ The `Platform.isTV` mock path is settled: `jest.spyOn(Platform, 'isTV', 'get').mockReturnValue(true)`,
  used in every test file touched so far (`useTVBackHandler.test.ts`, `SlotCard.test.tsx`,
  `GainRow.test.tsx`, `ConnectScreen.test.tsx`, `MainScreen.test.tsx`) - no separate `Adaptive*`
  component convention was needed (see Phase 2's item 1). Nothing in `jest.setup.js` itself needed
  to change. Applies automatically to future TV-only branches; no further setup work needed there.
- New focus-specific behavior (initial `hasTVPreferredFocus`, focus-ring class/style toggling) is
  awkward to assert meaningfully under `@testing-library/react-native` + `jest-expo` (no real focus
  engine in the test renderer) - keep automated coverage to "the right props are passed"
  (`hasTVPreferredFocus={true}` on the expected element) and treat actual focus-traversal
  correctness as a manual pass on a real Apple TV or the tvOS Simulator, not something CI verifies.
- `npm run typecheck` and `npm test` (full suite, unfiltered) still gate every push per the root
  `AGENTS.md`/`mobile/AGENTS.md` "Before pushing" conventions - no exception for TV-only changes.

## Phase 6: CI and distribution — ⬜ not started (needs macOS, same wall as `expo prebuild` itself)

Mirrors [`ios-ci-automation-plan.md`](ios-ci-automation-plan.md)'s reasoning almost exactly - same
`macos-latest`-runner constraint, same "no Apple account in CI" goal, same unsigned-archive
technique, just `-sdk appletvos` instead of `-sdk iphoneos`:

1. New `buildmobiletvos` job in `.github/workflows/create-app.yaml`, alongside `buildmobileios`:
   `EXPO_TV=1 npx expo prebuild --platform ios --clean`, then `xcodebuild ... -sdk appletvos
   CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" archive`, package an
   unsigned `.ipa`-equivalent (tvOS app bundles use the same `.app`-in-`Payload`/zip convention) and
   the `.xcarchive`, upload both as build artifacts.
2. New `publishmobiletvos` job mirroring `publishmobileios`, attaching both to the tag's GitHub
   Release.
3. **Distribution doc.** Unlike iOS, there's no Sideloadly-equivalent third-party tool commonly used
   for tvOS - realistic install paths for an unsigned/self-signed build are narrower: Xcode's
   Devices and Simulators window (`xcrun devicectl` / drag-and-drop an `.ipa`, Mac required, same as
   `ios-sideloading.md` Path A), or Apple Configurator 2 for supervised devices. Write
   `docs/appletv-sideloading.md` once Phase 0/6.1 confirm which paths actually work for an unsigned
   tvOS build specifically - don't assume iOS's three-path structure (`ios-sideloading.md`'s Paths
   A/B/C) carries over unchanged; the EU-only on-device path in particular is iPhone/iPad-specific
   (no equivalent regulatory carve-out exists for a device with no on-device app installer at all).
4. Update `../README.md`'s "Apple TV" section to link the new distribution doc and this plan, same
   pattern as the existing iOS section links `ios-sideloading.md` and `ios-ci-automation-plan.md`.

## Explicitly out of scope (for a first version)

- **tvOS top-shelf "featured content" API** (rotating banner content beyond the static top-shelf
  image) - a real content API, not a checkbox; no obvious use case for a device-control app like
  this one.
- **Siri Remote touchpad gestures beyond D-pad-equivalent navigation and `onLongPress`** (e.g.
  force-touch, custom swipe gestures on the touch surface) - the focus-engine model (Phase 2)
  covers everything the app actually needs.
- **`androidtv`/Fire TV**, even though `@react-native-tvos/config-tv` supports both TV targets
  together - Apple TV is the requested platform; Android TV is a separate scope decision with its
  own remote/focus quirks (input model is closer but not identical) and its own distribution story,
  better treated as its own future plan than bundled in here by default.
- **Deep-linking/universal-links parity with phone** - not part of the current phone/tablet app
  either, nothing new to design here.

## What's left (as of 2026-08-15)

Everything here needs a real macOS/Xcode environment to make progress on - that's the single
blocking constraint behind almost every item, not lack of design:

1. **`expo prebuild --platform ios` has never actually been run.** This is the root blocker for
   confirming *everything* below, not just Phase 6 - it's the only way to check the Phase 0 spike
   questions (gesture-handler/reanimated/FlashList/Paper focus behavior under `-sdk appletvos`),
   whether the leftover duplicate `react-native` copy (see "Phase 0/1 findings") actually matters,
   and whether any of Phase 2/3's landed code even runs without crashing.
2. **Phase 2 item 3**: `TVFocusGuideView` containment - not started, waiting on real-device signal.
3. **Phase 2 item 4**: `hasTVPreferredFocus` on `ConnectScreen`'s host field - not started.
4. **`MainScreen.tsx`**: TV-safe-area/overscan margins - not started.
5. **`SlotCard.tsx`'s two-Pressable split**: landed as a guess, not validated against a rendered
   layout on real hardware - highest-risk landed decision to re-check first.
6. **Sheets/modals**: focus-into-sheet-on-open and focus-return-on-close - not started.
7. **Filter-loaded notification feature**: still an open product decision (ship on tvOS or not),
   not a technical one - needs an answer before Phase 1's `expo-notifications` exclude question or
   `SettingsSheet`'s toggle-hiding can be resolved either way.
8. **LAN server discovery** (Connect flow fast-follow): not started; manual entry (done) is a
   complete pairing path on its own, so this can slip freely.
9. **Phase 4** (TV app icon/top-shelf art) and **Phase 6** (CI job + distribution doc): not started,
   both gated on the same macOS access as item 1.
