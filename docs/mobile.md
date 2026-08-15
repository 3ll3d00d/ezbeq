# Mobile App

ezbeq mobile is a companion app for iOS/iPadOS and Android (phone + tablet) covering the main BEQ
workflow: search/browse the catalogue, inspect an entry, upload a filter to a device slot,
activate/clear slots, and adjust gain — kept live over the same WebSocket the web UI uses.

It's a companion, not a replacement for the web UI: it talks to an **existing ezbeq server** over
your LAN and doesn't do any device integration itself, so you still need a running ezbeq server
(see [Installation](index.md#installation)) before pairing the app with it.

## Getting the app

Every tagged release publishes installable builds as assets on the corresponding
[GitHub Release](https://github.com/3ll3d00d/ezbeq/releases) — look for the latest (non-draft)
release and download the asset for your platform:

| Platform      | Asset                             | Notes                                          |
|---------------|------------------------------------|-------------------------------------------------|
| Android       | `ezbeq-mobile-android.apk`         | Signed, installable directly — see below         |
| iOS / iPadOS  | `ezbeq-mobile-ios-unsigned.ipa` or `ezbeq-mobile-ios.xcarchive.zip` | Unsigned — requires a one-time signing step, see [Installing on iOS/iPadOS](mobile-ios-sideloading.md) |

### Android

`ezbeq-mobile-android.apk` is signed with a dedicated release key and can be installed directly:

1. Download the `.apk` to the device (or transfer it over).
2. Open it — Android will prompt to allow installs from that source the first time.
3. Once installed, open the app and pair it with your ezbeq server's LAN address (e.g.
   `http://192.168.1.23:8080`, or whatever port your server is configured for).

### iOS / iPadOS

Apple doesn't allow installing unsigned apps on a real device, even on the free tier, so the iOS
build published by CI is deliberately left unsigned — the last, one-time signing step happens on
your own machine using your own (free) Apple ID. **No paid Apple Developer Program enrollment is
required for any of the supported paths.** See the dedicated
[Installing on iOS/iPadOS](mobile-ios-sideloading.md) page for the full walkthrough (Mac + Xcode,
Windows + Sideloadly, or an EU-only on-device path).

## Backend compatibility

Core functionality (catalogue browse/search, filter upload, slot activate/clear, gain control,
live WebSocket state) works against any reasonably current ezbeq server — it uses the same stable
API the web UI depends on. Two features degrade gracefully against an older server rather than
failing outright:

- The update-available / unsupported-Python banners need a server new enough to return
  `updateAvailable`/`latestVersion`/`pythonSupported` from `/api/1/version` (v2.10.0+) — on an
  older server those banners simply never show.
- The What's New sheet needs `/api/1/whats-new` (added slightly before v2.10.0) — on a server
  without it, the bell just never gets a badge rather than showing an error.

## Building from source / development

For running the app locally against a dev server, Android emulator setup, EAS cloud builds, and
CI release signing, see [`mobile/README.md`](https://github.com/3ll3d00d/ezbeq/blob/main/mobile/README.md)
in the repository.

## Apple TV

Not implemented yet, but the app is architected so that adding `react-native-tvos` support later
shouldn't require changes to the existing phone/tablet code.
