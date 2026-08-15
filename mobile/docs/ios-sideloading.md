# Installing ezbeq mobile on iOS/iPadOS without paying Apple

This is the iOS/iPadOS equivalent of the Android release APK (see "CI release signing (Android)"
in [`../README.md`](../README.md)) — a way to get a real, installed (not Expo-Go-hosted) build of
the app onto your own iPhone/iPad, using only a free Apple ID (no $99/year Developer Program
enrollment required).

**The full, actively-maintained walkthrough (which path to pick, one-time setup, the 7-day
resignature renewal, troubleshooting) is published at:**

**[ezbeq.readthedocs.io — Installing the Mobile App on iOS/iPadOS](https://ezbeq.readthedocs.io/en/latest/mobile-ios-sideloading/)**

This file is kept as a stub (rather than duplicating that content here) so there's a single source
of truth — see the built docs site rather than expecting this page to be kept in sync by hand. It
covers:

- Path 0: Expo Go (fastest, dev-only, not a real install)
- Path A: you have a Mac (Xcode)
- Path B: Windows only, no Mac (Sideloadly)
- Path C: EU-only, AltStore PAL, no computer at all
- Limitations and troubleshooting common to every path

Where the build comes from: every tag push builds the iOS app on a GitHub-hosted macOS runner
(the `buildmobileios` job in
[`../../.github/workflows/create-app.yaml`](../../.github/workflows/create-app.yaml)) and attaches
`ezbeq-mobile-ios-unsigned.ipa` and `ezbeq-mobile-ios.xcarchive.zip` to that tag's
[GitHub Release](https://github.com/3ll3d00d/ezbeq/releases) — see the published page linked above
for which of those two files each path needs. See
[`ios-ci-automation-plan.md`](ios-ci-automation-plan.md) for how that job is built.
