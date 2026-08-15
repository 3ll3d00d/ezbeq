# Installing ezbeq mobile on iOS/iPadOS without paying Apple

This is the iOS/iPadOS equivalent of the Android release APK (see "CI release signing (Android)"
in [`../README.md`](../README.md)) — a way to get a real, installed (not Expo-Go-hosted) build of
the app onto your own iPhone/iPad. Apple doesn't offer a way to install unsigned code on a real
device, so every path below still uses your own (free) Apple ID to sign the build - there's no way
around that - but none of them require enrolling in the paid Apple Developer Program ($99/year).

The trade-off for not paying: Apple caps a free-tier ("Personal Team") signature at **7 days**,
after which the app refuses to launch until it's re-signed. Every path below documents how to
redo that in under a minute once the one-time setup is done.

## Which path applies to you

| You have...                          | Use                                                |
|---------------------------------------|-----------------------------------------------------|
| Just want to try the app, no install  | [Path 0: Expo Go](#path-0-expo-go-fastest-dev-only-not-a-real-install) |
| A Mac                                 | [Path A: Mac + Xcode](#path-a-you-have-a-mac)        |
| Windows only, no Mac                  | [Path B: Windows + Sideloadly](#path-b-windows-only-no-mac) |
| iPad only, EU region, iOS 17.4+       | [Path C: AltStore PAL](#path-c-eu-only-altstore-pal-no-computer-at-all) |

All paths except Path 0 install the same compiled app - the difference is only which machine does
the signing.

## Where the build comes from

Every tag push builds the iOS app on a GitHub-hosted macOS runner (`buildmobileios` in
[`.github/workflows/create-app.yaml`](../../.github/workflows/create-app.yaml), the iOS sibling of
the existing `buildmobileandroid` job) and attaches two files to that tag's GitHub Release:

- **`ezbeq-mobile-ios-unsigned.ipa`** - for Sideloadly (Path B) or AltStore PAL (Path C)
- **`ezbeq-mobile-ios.xcarchive.zip`** - for Xcode's Organizer (Path A)

Neither file is signed and no Apple account is involved in producing them - CI builds with code
signing disabled entirely, the same "build for a real device without an account" trick sideloading
tools rely on generally. Signing only happens on your own machine, in the steps below, using your
own Apple ID. See [`ios-ci-automation-plan.md`](ios-ci-automation-plan.md) for how that job
(`buildmobileios` in `create-app.yaml`) is built.

## Path 0: Expo Go (fastest, dev-only, not a real install)

Good for trying the app or day-to-day development against a live Metro server; not a substitute
for a real installed build (no home-screen-independent icon, needs Metro reachable each time).
See [`../README.md`](../README.md#running-locally) for the full local-dev setup. In short:

```bash
bin/run-server-stub      # from the repo root - a stub ezbeq backend, no hardware required
cd mobile && npm install && npm start
```

Scan the QR code with the Expo Go app (free, from the App Store) on your iPad. No Apple account,
no signing, nothing to renew.

## Path A: You have a Mac

**One-time setup:**

1. Install Xcode from the App Store.
2. Xcode → Settings → Accounts → sign in with your own (free) Apple ID.
3. Connect the iPad by cable once, tap "Trust This Computer" on the iPad, and let Xcode finish
   registering it (Window → Devices and Simulators should show it as ready).

**Installing the build**, two options:

- **From the CI artifact** (no local build toolchain needed): download
  `ezbeq-mobile-ios.xcarchive.zip` from the latest GitHub Release, unzip it, then in Xcode: Window →
  Organizer → drag the `.xcarchive` in → **Distribute App** → **Development** → **Automatically
  manage signing** (select your own Apple ID/Personal Team) → Export. Then drag the exported `.ipa`
  onto your iPad's entry in Window → Devices and Simulators (or use Organizer's own Install button)
  to push it over.
- **Building locally** (no CI artifact needed, works today even before the CI job exists):
  ```bash
  cd mobile
  npx expo run:ios --device
  ```
  This prebuilds, compiles, signs (against your free Personal Team), and installs in one step -
  pick your iPad when prompted for a destination.

**Renewing after 7 days:** the app stops launching with a "could not verify" message once the
signature expires. Reconnect the iPad to the same Mac and repeat whichever installing step you
used above - no need to uninstall first.

## Path B: Windows only, no Mac

**One-time setup:**

1. Install [Sideloadly](https://sideloadly.io/) on Windows.
2. Install Apple's [iTunes](https://www.apple.com/itunes/download/) or Apple Mobile Device Support
   so Windows recognizes the iPad over USB (Sideloadly needs this driver even though you don't use
   iTunes itself).

**Installing the build:**

1. Download `ezbeq-mobile-ios-unsigned.ipa` from the latest GitHub Release.
2. Plug in the iPad, unlock it, tap "Trust This Computer" if prompted.
3. Open Sideloadly, drag the `.ipa` onto it, sign in with your Apple ID (you'll be prompted for a
   2FA code from your trusted device), and press **Start**. Sideloadly requests a free development
   certificate + provisioning profile from Apple and installs the signed app.
4. On the iPad, go to Settings → General → VPN & Device Management, tap your Apple ID under
   "Developer App", and tap **Trust** - iOS blocks any freshly-sideloaded app from launching until
   this is done once.

**Renewing after 7 days:** reopen Sideloadly, drag the same `.ipa` in again (no need to redownload
it - keep it around), sign in and press Start again.

## Path C (EU only): AltStore PAL, no computer at all

If your Apple ID region is in the EU and the iPad runs iOS/iPadOS 17.4+, [AltStore
PAL](https://altstore.io/) uses Apple's EU-mandated marketplace APIs to sign and install apps
**directly on the device** - no Windows or Mac involved at any point, including for the 7-day
renewal.

1. Install AltStore PAL on the iPad (follow the on-device install flow at altstore.io - it walks
   you through a one-time web-based Apple ID sign-in).
2. Download `ezbeq-mobile-ios-unsigned.ipa` from the latest GitHub Release directly on the iPad
   (e.g. from Safari), then open it with AltStore PAL to install.
3. When it stops launching after 7 days, open AltStore PAL and refresh it - same on-device flow,
   no computer needed.

Outside the EU, Apple doesn't expose this on-device signing path, so Path A or B is required.

## Limitations, whichever path you use

- No TestFlight, no App Store - these genuinely require the paid Developer Program.
- **7-day resignature cycle** on every path - an Apple restriction on free-tier signing, not
  specific to any of these tools.
- Push notifications: this app only ever uses *local* notifications (see [Backend
  compatibility](../README.md#backend-compatibility) / the Expo Go warning in
  [`../README.md`](../README.md#running-locally)), so this doesn't affect it - but if that ever
  changes, remote push requires the paid account regardless of which sideloading path you use.
- Free Apple IDs can only have a handful of App IDs/devices registered at once - fine for
  personal/family use, not for handing the app to many people.

## Troubleshooting

- **"Untrusted Developer" / app icon greyed out with a warning** → Settings → General → VPN &
  Device Management → trust the certificate under your Apple ID (see Path B step 4).
- **App won't open, "could not verify app" / "unable to install"** → the 7-day signature expired;
  redo the install step for your path. No need to delete the app first.
- **Sideloadly stuck on "waiting for device"** → confirm Apple Mobile Device Support/iTunes is
  installed, the iPad is unlocked, and you tapped "Trust" on the USB prompt.
- **Xcode doesn't list the iPad as a destination** → check Window → Devices and Simulators; if it
  shows "preparing device" indefinitely, unplug/replug and unlock the iPad.
