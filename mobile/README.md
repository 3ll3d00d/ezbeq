# ezbeq mobile

A cross-platform (iOS/Android, phone + tablet) mobile client for [ezbeq](../README.md), covering the
main BEQ filter page: search/browse the catalogue, inspect an entry, upload a filter to a device
slot, activate/clear slots, and adjust gain — kept live via the same WebSocket the web UI uses.

This is a companion app, not a replacement for the web UI — it talks to an existing ezbeq server
over your LAN; it doesn't run any device integration itself.

## Backend compatibility

Core functionality (catalogue browse/search, filter upload, slot activate/clear, gain control,
live WebSocket state) only needs the `/api/2/devices` + `/api/3/devices/{device}` PATCH API and the
WS catalogue protocol, both stable since mid-2023 - the same API the web UI (`ui/`) already
depends on, so any reasonably current server works. Two narrower version floors:

- The update-available/unsupported-Python banners need `/api/1/version` to return
  `updateAvailable`/`latestVersion`/`pythonSupported`/etc. (added in v2.10.0) - those fields are
  optional in the mobile types, so an older server simply omits them and the banners don't show.
- The What's New sheet needs `/api/1/whats-new` (added slightly before v2.10.0) - on a server
  without it, the request 404s and is silently ignored (see the comment above `getWhatsNew` in
  `MainScreen.tsx`), so the bell just never gets a badge rather than surfacing an error toast.

## Status

Early scaffold. See `AGENTS.md` for conventions and the repo's mobile design plan for the full
milestone breakdown.

## Running locally

You'll need a running ezbeq server to connect to first. From the repo root:

```bash
bin/run-server-stub   # no hardware required, binds 0.0.0.0:9968
```

Then start the mobile app:

```bash
npm install
npm start
```

Then either scan the QR code Expo prints with a physical device (Expo Go), or press `i`/`a` to
launch a simulator/emulator. Pair it with the server using either address, depending on which you
launched:

> **The persistent filter-loaded notification doesn't work in Expo Go on Android.**
> `expo-notifications` runs a push-token auto-registration side effect at *import* time, which
> throws on Android in Expo Go (SDK 53 dropped Expo Go's Android push support entirely). This app
> only uses local notifications, but merely importing the library still hits that same crash -
> `src/services/filterNotification.ts` avoids it by never importing `expo-notifications` at all on
> Android+Expo Go (`isFilterNotificationSupported()`), so the rest of the app (and Expo Go on
> iOS/everything else) is unaffected - the notification toggle just renders disabled there. To
> exercise that one feature on Android, use the **dev client** below instead of Expo Go.

- A physical device needs your machine's LAN IP (e.g. `http://192.168.1.23:9968`).
- The Android emulator can't reach `localhost` directly - use `10.0.2.2:9968` instead (see below).
- iOS Simulator can typically reach the host machine directly via `localhost:9968`.

If a physical device can't reach either the Metro dev server or the ezbeq server (Expo Go shows
"failed to download remote update", or pairing just times out) even though it's on the same Wi-Fi,
check for a host firewall blocking inbound LAN connections - e.g. on Linux with `firewalld` active
(`systemctl is-active firewalld`), open both ports: `sudo firewall-cmd --add-port=8081/tcp
--add-port=9968/tcp` (add `--permanent` to survive a reboot).

## Android emulator setup (command line)

If you don't already have an emulator (e.g. no Android Studio, or a headless dev box), this sets one
up entirely from the CLI. All paths below assume `$ANDROID_HOME` points at an existing Android SDK
checkout (Android Studio's SDK Manager writes its path to
`~/.config/Google/AndroidStudio*/options/android.sdk.path.xml` if you have it installed; otherwise
pick any empty directory).

**1. Install the command-line tools**, if `$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager` doesn't
already exist (the legacy `tools/bin/sdkmanager` some old SDK checkouts ship instead is unmaintained
and crashes under a modern JDK):

```bash
export ANDROID_HOME=~/Android/Sdk   # or wherever your SDK lives
curl -sL -o /tmp/cmdline-tools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
mkdir -p "$ANDROID_HOME/cmdline-tools" && cd "$ANDROID_HOME/cmdline-tools"
unzip -q /tmp/cmdline-tools.zip && mv cmdline-tools latest
```

**2. Accept licenses and install a platform, build-tools, and a system image** (swap version numbers
for whatever `sdkmanager --list` shows as current):

```bash
SDKMGR="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKMGR" --sdk_root="$ANDROID_HOME" --licenses
"$SDKMGR" --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "build-tools;36.1.0" \
  "platforms;android-36" \
  "system-images;android-36;google_apis_playstore;x86_64"
```

**3. Create an AVD** (`-k` must match a system image you just installed):

```bash
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
  -n ezbeq-36 -k "system-images;android-36;google_apis_playstore;x86_64" -d pixel_6
```

**4. Boot it headless** (drop `-no-window` to see it, e.g. over X11 forwarding):

```bash
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
emulator -avd ezbeq-36 -no-window -no-audio -gpu swiftshader_indirect &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
```

**5. Run the app** — `npm run android` (or `i`/`a` from `npm start`) detects the running emulator,
installs Expo Go on it automatically, and connects Metro to it. This covers everything except the
persistent filter-loaded notification (see the warning above) - for that, build the **dev client**
instead (next section):

```bash
cd mobile && npm run android
```

**6. Pair with a server** running on your host: the emulator can't reach `localhost` directly, so use
`10.0.2.2` (QEMU's alias for the host loopback) instead - e.g. host + port `10.0.2.2` / `9968` against
`bin/run-server-stub`.

If an SDK component you relied on gets removed later (e.g. via Android Studio's SDK Manager UI), an
AVD built against it fails to launch with `Missing system image ...` - `avdmanager list avd` will
call out exactly which AVD and image; reinstall the same `system-images;...` package via `sdkmanager`
or delete the AVD (`avdmanager delete avd -n <name>`) and create a fresh one against whatever's
still installed.

## Dev client build (Android, local)

Needed only to exercise the persistent filter-loaded notification (see the Expo Go warning above)
- everything else can still use plain Expo Go. This builds and installs a real native app (not
Expo Go) onto a connected device or emulator (`adb devices` must show one first).

**JDK 17 required, not whatever `java` currently resolves to.** React Native's own docs recommend
JDK 17 and warn that newer JDKs cause problems - concretely, JDK 24+ (so 24, 25, ...) trips a
Gradle bug where a JEP 472 "restricted method" warning from a worker process gets misreported as a
hard failure of the `configureCMakeDebug` task used by native modules like
`react-native-worklets`/`react-native-screens` (still open upstream:
[gradle/gradle#31625](https://github.com/gradle/gradle/issues/31625)). Confirmed on this repo: JDK
25 fails every time, JDK 17 builds clean. `--enable-native-access=ALL-UNNAMED` does **not** work
around it (that worker process doesn't inherit the Gradle daemon's `jvmargs`).

Point Gradle at JDK 17 globally (survives `expo prebuild` regenerating `android/`, which is
gitignored, so this can't live in the repo itself):

```bash
# install a JDK 17 first if you don't have one, then:
cat >> ~/.gradle/gradle.properties <<'EOF'
org.gradle.java.home=/path/to/jdk-17
EOF
```

Then build and install:

```bash
cd mobile
npx expo install expo-dev-client   # one-time, already in package.json - npm install covers it after that
npx expo run:android               # prebuild + Gradle build + install onto the connected device/emulator
```

First build takes several minutes (native compilation). `expo run:android` starts Metro itself; if
one's already running (e.g. from a previous `npm start`), it detects and reuses it. Pair the app
with your ezbeq server the same way as Expo Go (see addresses above) - the dev client's own
"Connect" screen for pointing it at Metro looks the same as Expo Go's.

## Testing

```bash
npm test         # Jest unit tests
npm run typecheck
```

CI runs both on every push/PR that touches `mobile/**` (`.github/workflows/test-mobile.yaml`).

## App icon & splash screen

`assets/icon.png`, `assets/android-icon-foreground.png`, `assets/android-icon-background.png`, and
`assets/splash-icon.png` are all derived from the web UI's existing brand icon
(`ui/public/android-chrome-512x512.png`) rather than a separate mobile-specific design, so the app
reads as the same product across web and mobile. See `app.json`'s `icon`/`android.adaptiveIcon`/
`expo-splash-screen` plugin config for how each is used. There's no Android 13+ themed
(`monochromeImage`) variant - the source art's background bevel doesn't cleanly separate into a
flat single-color silhouette, and a blank/undifferentiated one would be worse than none.

## EAS builds

`eas.json` defines three build profiles for internal testing (no store submission needed to try a
build on a real device):

- `development` - includes the dev client, for testing against native modules Expo Go can't run
  (cloud-build alternative to the local `expo run:android` flow above - no local Android SDK/JDK
  needed, just an Expo account and a device to install the resulting build on)
- `preview` - internal-distribution build (an installable `.apk` on Android), for handing a build
  to a tester without going through Expo Go
- `production` - store-ready, auto-incremented version

`app.json`'s `ios.bundleIdentifier`/`android.package` (`com.ezbeq.mobile`) are placeholders - swap
them for an identifier under a domain/account you control before submitting to the App Store or
Play Store. Building requires `eas login` and, on the first run, `eas init` to link the project to
an Expo account:

```bash
npx eas build --profile preview --platform android
```

## CI release signing (Android)

Every tag push builds and publishes a sideloadable, signed release APK as a GitHub Release asset
(`.github/workflows/create-app.yaml`'s `buildmobileandroid` job) - `expo prebuild` +
`gradlew assembleRelease`, the same steps as the local dev-client build above, run for all four
Android ABIs.

Signing uses a dedicated release keystore, not the shared React Native debug keystore every local
build falls back to (see the warning above `signingConfigs` in `mobile/plugins/
withAndroidReleaseSigning.js`) - a debug-keystore-signed build is fine for testing on your own
device, but every RN project's default debug key is the same well-known key, not something you'd
want signing a build handed out to other people. The keystore itself only exists in one place
outside GitHub's (write-only, unrecoverable) secrets store - see whoever generated it for the
backup location. Four repo secrets carry it into CI:

- `MOBILE_RELEASE_STORE_BASE64` - the keystore file, base64-encoded
- `MOBILE_RELEASE_STORE_PASSWORD` / `MOBILE_RELEASE_KEY_PASSWORD` - same value for both (PKCS12
  keystores don't support different store/key passwords)
- `MOBILE_RELEASE_KEY_ALIAS` - `ezbeq-mobile-release`

None of the four are readable back out once set (GitHub secrets are write-only) - losing the
keystore file itself means every future release has to switch signing keys, which breaks in-place
updates for anyone who installed a build signed with the old one (they'd need to uninstall and
reinstall rather than update).

## Installing on iOS/iPadOS

Unlike Android, a device-installable iOS build can't be handed out as a single signed file from
CI alone - Apple requires every install to be signed by an Apple ID on the installing machine, even
on the free tier. See **[Installing the Mobile App on iOS/iPadOS](https://ezbeq.readthedocs.io/en/latest/mobile-ios-sideloading/)**
(published docs; [`docs/ios-sideloading.md`](docs/ios-sideloading.md) is a stub pointing at the
same page) for the full, no-Apple-fee-required workflow (Mac + Xcode, Windows + Sideloadly, or an
EU-only on-device path), and [`docs/ios-ci-automation-plan.md`](docs/ios-ci-automation-plan.md) for
the design record of the CI job (`buildmobileios`) that produces the unsigned build artifacts those
paths sign locally.

## Apple TV

Not implemented yet. The app is architected (plain React Navigation, no gesture-only interactions,
`Adaptive*` wrapper components for the few `Platform.OS` branch points) so that adding
`react-native-tvos` later should only require `app.config.ts` plugin config
(`@react-native-tvos/config-tv`) and a tvOS entry point — no changes to the phone/tablet code itself.
See [`docs/appletv-implementation-plan.md`](docs/appletv-implementation-plan.md) for the full
phased implementation plan (toolchain, focus/remote input model, per-screen adaptation, CI/
distribution), which turned out to be more involved than that paragraph implies — a couple of
screens (camera-based QR pairing, the gain sliders) have no direct tvOS equivalent and need real
UX decisions, not just a config flag.
