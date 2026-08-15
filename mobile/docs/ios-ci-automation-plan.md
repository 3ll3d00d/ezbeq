# Implementation plan: automated iOS build (`buildmobileios`)

**Status: implemented and validated against a real tag push** (`2.11.7`, 2026-08-15 - both
`buildmobileios` and `publishmobileios` completed successfully, run
[31883975963](https://github.com/3ll3d00d/ezbeq/actions/runs/31883975963)). Kept below as the
design record for why the job is built the way it is; the "Validation before merging" section at
the bottom is now fully resolved rather than a list of what's still unverified.

Goal: add a CI job that produces the two unsigned artifacts [`ios-sideloading.md`](ios-sideloading.md)
already documents and links to (`ezbeq-mobile-ios-unsigned.ipa`, `ezbeq-mobile-ios.xcarchive.zip`),
on every tag push, with **no Apple account and no repo secrets involved** - mirroring
`buildmobileandroid` in [`../../.github/workflows/create-app.yaml`](../../.github/workflows/create-app.yaml)
as closely as the platforms allow. The sections below are kept as the design record for why the
job (`buildmobileios`/`publishmobileios`) is built the way it is; the values that were open
questions when this was written (workspace/scheme names, the autolinking exclude key, the
push-notification entitlement) have since been confirmed by actually running `expo prebuild
--platform ios` and are noted inline where they were resolved.

## Why this is possible without an Apple account

Code signing is checked by iOS at *install/launch* time, not by Xcode at *build* time. Building an
`.xcarchive` targeting a real device (`-sdk iphoneos`) with signing explicitly disabled
(`CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""`) produces a normal `.app`
binary that never asks Xcode for an account, a certificate, or a provisioning profile. This is the
same technique long used by other open-source projects that ship "unsigned IPA, sideload it
yourself" release assets. All the account-touching work (requesting a free-tier cert +
provisioning profile, actually signing) happens later, on the end user's own machine, which is
exactly what `ios-sideloading.md` Paths A/B/C already describe.

## New job: `buildmobileios`

Add alongside `buildmobileandroid` in `create-app.yaml` (same trigger - tag push, same
"no `needs: create_release`" reasoning: nothing in the build depends on the release existing).

**Runner:** `macos-latest` (GitHub-hosted; free for this public repo, no self-hosted runner
needed). This is the one unavoidable difference from the Android job - Apple's toolchain only runs
on macOS, full stop, independent of signing/payment questions.

**Steps, in order:**

1. `actions/checkout@v7`
2. `actions/setup-node@v7` (`node-version: lts/*`, `cache: npm`,
   `cache-dependency-path: mobile/package-lock.json`) - matches the Android job.
3. `npm ci` in `./mobile`.
4. Set app version from the tag. **Originally** the same `jq '.expo.version = $v' app.json` step
   the Android job used; **now** (2026-08-15) `echo "APP_VERSION=$v" >> "$GITHUB_ENV"` instead -
   the Apple TV work replaced `app.json` with `app.config.ts` (a `.ts` file, not jq-editable, needed
   to make the TV config plugin conditional), and `app.config.ts` reads `process.env.APP_VERSION`
   directly (falling back to a hardcoded default for local/dev builds) rather than having a value
   written into it. The **open question about a shared `mobile/scripts/set-version.sh`** is now
   moot rather than answered: the step shrank from a multi-line jq read/transform/write to a single
   `echo`, and a one-line duplicate across two jobs isn't worth a script indirection - revisit only
   if the step grows complex again, not because a third job (e.g. a future `buildmobiletvos`) shows
   up.
5. Exclude dev-client-only modules from the release build - the Android job does this via
   `expo.autolinking.android.exclude` in `package.json`. **Resolved**: yes, `expo.autolinking.ios.exclude`
   works, confirmed by actually running this job - `expo-modules-autolinking`'s iOS platform is
   internally named "apple" and falls back to reading an `"ios"` key from `package.json` when no
   `"apple"` key is present, so this does take effect, just via that fallback rather than being the
   primary key (see the `buildmobileios` job's own comment on this step for the exact source
   reference).
6. `npx expo prebuild --platform ios --clean` (`CI=1`, matching the Android job) - generates
   `mobile/ios/`, including running `pod install` as part of prebuild's autolinking step.
   **Resolved**: no separate Ruby/CocoaPods setup step was needed - `macos-latest` ships CocoaPods
   preinstalled and `pod install` runs cleanly as part of this step.
7. Discover the generated workspace/scheme rather than hardcoding a name. **Resolved, but not as
   originally planned**: `ls -d ios/*.xcworkspace` for the workspace (note `-d` - plain `ls` on a
   directory/bundle lists its *contents*, not its own name; this shipped once with the wrong value
   before being caught). The scheme is **not** read from `xcodebuild -workspace <workspace> -list`
   as this step originally proposed - that list includes every *other* shared scheme CocoaPods pulls
   in too (an autolinked Expo module can ship its own internal scheme), and one of those
   alphabetically preceded `ezbeq` and got built instead of the app on the first real attempt.
   Instead: the scheme is derived from the app's own `.xcodeproj` basename directly (Expo names the
   scheme identically to the project, confirmed by actually running `expo prebuild`), which has no
   such ambiguity.
8. Archive unsigned, for a real device:
   ```
   xcodebuild -workspace ios/<workspace> -scheme <scheme> -configuration Release \
     -sdk iphoneos -archivePath build/ezbeq-mobile.xcarchive \
     CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
     archive
   ```
   **Resolved, and the risk was real**: `expo-notifications`' config plugin does unconditionally
   write an `aps-environment` entitlement even though the app only ever uses local notifications -
   confirmed by actually running `expo prebuild` (it's the only entitlements file Expo generates for
   this app). Free-tier Personal Team signing doesn't support the Push Notifications capability, so
   rather than the "confirm it isn't requested" fallback this step originally described, the actual
   fix strips the entitlement outright with a dedicated step
   (`/usr/libexec/PlistBuddy -c "Delete :aps-environment" ...`) right after prebuild, before the
   archive step runs.
9. Package the unsigned `.ipa` from the archive's product, for Sideloadly/AltStore:
   ```
   mkdir -p Payload
   cp -r build/ezbeq-mobile.xcarchive/Products/Applications/*.app Payload/
   zip -r ezbeq-mobile-ios-unsigned.ipa Payload
   ```
10. Zip the `.xcarchive` itself for the Xcode Organizer path:
    ```
    zip -r ezbeq-mobile-ios.xcarchive.zip build/ezbeq-mobile.xcarchive
    ```
11. `actions/upload-artifact@v4` x2 (`retention-days: 1`, matching the Android job's short
    retention since `publishmobile*` jobs consume them immediately), one per file from steps 9/10.

## New job: `publishmobileios`

Mirrors `publishmobileandroid`: `needs: [create_release, buildmobileios]`, downloads both
artifacts, `gh release upload` both onto the tag's release
(`ezbeq-mobile-ios-unsigned.ipa#ezbeq-mobile-ios-unsigned.ipa`,
`ezbeq-mobile-ios.xcarchive.zip#ezbeq-mobile-ios.xcarchive.zip`), same `--repo` flag reasoning
(no checkout in that job).

## Explicitly out of scope

- **Any Apple account/credentials in CI** - the entire point of this design is that CI never
  touches Apple. Don't add `EXPO_TOKEN`/`eas credentials`/App Store Connect API keys here; that's a
  different, paid-account design (briefly mentioned as the *old* plan in `../README.md`'s history)
  that this replaces for the free-tier case.
- **EAS Build** - would also work and is simpler to wire up, but costs build minutes past its free
  tier and, more importantly, doesn't remove the Apple-account requirement for anything beyond a
  simulator build - the unsigned-`xcodebuild` approach here is what actually avoids needing an
  account anywhere in the pipeline.
- **Caching** (the `warm-mobile-android-cache.yaml` equivalent for iOS) - the actual build time is
  now known (~7m20s, see "Validation before merging" below) and doesn't justify it; Xcode/CocoaPods
  caching on `macos-latest` runners has different tradeoffs than Gradle's anyway (notably much
  larger/slower-to-restore caches), so this stays out of scope rather than being added speculatively.
- **Updating `ios-sideloading.md`** - already written and already references the exact artifact
  filenames this plan produces; no changes needed there once this job exists, beyond removing its
  "no CI artifact" caveat under Path A.

## Validation before merging

1. ✅ Ran the new job via a temporary `workflow_dispatch` trigger and confirmed both artifacts
   upload (see the now-removed scaffolding in git history).
2. ✅ Downloaded `ezbeq-mobile-ios-unsigned.ipa` and sideload-installed it on a real device -
   confirmed it installs and launches. Some network-level flakiness was observed connecting to a
   `bin/run-server-stub` backend, of unclear origin (server-side vs. device-side) - not a signing or
   build issue, so not a blocker for this job.
3. ✅ Timed against a real tag push (`2.11.7`, 2026-08-15): `buildmobileios` took ~7m20s end to end
   (`actions/checkout` through artifact upload). Not slow enough to justify the caching pass
   mentioned under "out of scope" above - revisit only if a future SDK bump or dependency growth
   pushes this meaningfully higher, not preemptively.
