# Implementation plan: automated iOS build (`buildmobileios`)

**Status: implemented**, not yet exercised by a real tag push - see the "Validation before
merging" section at the bottom for what's still unverified until the first tag after this lands.

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
4. Set app version from the tag - same `jq '.expo.version = $v' app.json` step the Android job
   already does. **Open question:** should this be factored into a small shared script
   (`mobile/scripts/set-version.sh`) instead of duplicated inline in two jobs? Low priority, worth
   doing while adding the second copy rather than after a third shows up.
5. Exclude dev-client-only modules from the release build - the Android job does this via
   `expo.autolinking.android.exclude` in `package.json`; confirm during implementation whether the
   iOS autolinker honors an analogous `expo.autolinking.ios.exclude` key (Expo's autolinking
   plugin supports per-platform excludes) so `expo-dev-client`/`expo-dev-launcher`/
   `expo-dev-menu`/`expo-dev-menu-interface` don't get linked into a build meant to be re-signed
   and run standalone.
6. `npx expo prebuild --platform ios --clean` (`CI=1`, matching the Android job) - generates
   `mobile/ios/`, including running `pod install` as part of prebuild's autolinking step. No Ruby/
   CocoaPods setup step should be needed - GitHub's `macos-latest` image ships CocoaPods
   preinstalled - but confirm the prebuild log actually runs `pod install` successfully during
   implementation rather than assuming it.
7. Discover the generated workspace/scheme rather than hardcoding a name: `ls ios/*.xcworkspace`
   for the workspace, `xcodebuild -workspace <that> -list` to read the scheme name out of its
   output. (Expected to be `ezbeq` or `mobile`, derived from `app.json`'s `expo.name`/`slug`, but
   don't hardcode a guess into the workflow - derive it at run time so a future rename of either
   field can't silently break the job.)
8. Archive unsigned, for a real device:
   ```
   xcodebuild -workspace ios/<workspace> -scheme <scheme> -configuration Release \
     -sdk iphoneos -archivePath build/ezbeq-mobile.xcarchive \
     CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
     archive
   ```
   **Risk to verify during implementation:** `expo-notifications` is in `package.json`. If its
   config plugin writes a `aps-environment` push entitlement into the generated
   `ios/mobile/mobile.entitlements` even though the app only ever calls the *local*-notification
   APIs (see the Expo Go warning in `../README.md`), an unsigned archive could fail or silently
   drop that entitlement. Since the app doesn't use remote push at all (confirmed in
   `../README.md`'s "Backend compatibility" section), the fix if this happens is to confirm the
   plugin isn't requesting the push capability in the first place (check
   `ios/mobile/mobile.entitlements` after step 6, before assuming step 8 needs extra flags) -
   there's no legitimate reason this app's entitlements file should reference `aps-environment`.
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
- **Caching** (the `warm-mobile-android-cache.yaml` equivalent for iOS) - worth revisiting once
  this job's actual build time is known; Xcode/CocoaPods caching on `macos-latest` runners has
  different tradeoffs than Gradle's (notably much larger/slower-to-restore caches), not worth
  designing blind.
- **Updating `ios-sideloading.md`** - already written and already references the exact artifact
  filenames this plan produces; no changes needed there once this job exists, beyond removing its
  "no CI artifact" caveat under Path A.

## Validation before merging

1. Run the new job on a real tag push (or `workflow_dispatch` added temporarily for iteration) and
   confirm both artifacts upload.
2. Download `ezbeq-mobile-ios-unsigned.ipa` and sideload it via Path B (Sideloadly) or Path A
   (Xcode Organizer) from `ios-sideloading.md` end-to-end on a real device - confirm it installs,
   launches, and can reach a `bin/run-server-stub` backend, before considering this done. A build
   that merely "archives successfully" doesn't confirm the unsigned-archive trick actually produces
   an installable app - Apple's device-side install checks are stricter than xcodebuild's.
3. Time the job once it's green - decide whether a caching pass (see "out of scope" above) is worth
   adding based on the actual number, not a guess.
