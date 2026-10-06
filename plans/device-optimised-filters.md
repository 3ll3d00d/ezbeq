# Device-optimised BEQ coefficients

Status: implemented 2026-10-06.

beqcatalogue publishes per-device-format catalogues (see `beqcatalogue/plans/device-catalogues.md`)
holding optimised biquads, keyed by the main catalogue `digest`, for entries where the optimiser
found a better realisation of the authored filter on that format. ezbeq should use these by default
on devices that load raw coefficients, let the user turn this off per device, and make it clear when
a device is running unoptimised coefficients.

## Decisions

- 4x10 and 10x10 are fixed point and are unsupported for now (no fixed-point profile exists).
- The use-optimised toggle is per device, runtime-persisted, default on.
- ezbeq only needs to know whether an entry needs optimisation: present in the device catalogue =
  needs it (and it's available), absent = doesn't. No extra data from beqcatalogue. Accepted gap: a
  brand-new title reads as "not needed" until the device stage has run.
- Parametric devices (HTP-1, JRiver, CamillaDSP, Q-Sys, StormAudio, Reaper) compute their own
  coefficients, so optimisation is not applicable and nothing is shown for them.

## Published contract (consumed)

- `{catalogueUrl}devices/index.json`: `{schema_version: 1, profiles: [{id, label, file, rate,
  storage, transport, revision, entries, sha256, ...}]}`
- `{catalogueUrl}devices/<file>`: header `{schema_version: 1, profile, revision, rate, storage,
  transport, loading_model: "additive-feedback-decimal17-v1"}` plus
  `entries: {digest: [{b: [3 str], a: [2 str]}, ...]}`, one biquad per catalogue filter, in cascade
  order, same sign/string convention as `filters[*].biquads`.

## 1. Device catalogue loading (`ezbeq/catalogue.py`)

- `DeviceCatalogues`, owned by `CatalogueProvider`, runs on the existing reload loop after the main
  catalogue download.
  - Fetches `devices/index.json`; downloads `devices/<id>.json` only for profiles a configured device
    uses, and only when the index `sha256` changed. Verifies the `sha256`; the profile metadata and
    entries are stored in `ezbeq.db` so they survive a restart without network access.
  - Rejects (logs, marks unavailable) on `schema_version != 1`, unknown `loading_model`, or a
    profile/rate mismatch between file header and index.
- Entries stored in SQLite: `device_entry(profile, revision, digest, biquads)` indexed on
  `(profile, digest)`, replaced per profile in one transaction.
- `optimised_biquads(profile_id, digest, expected_count) -> list | None`; `None` on unavailable
  profile, missing digest, or count mismatch (logged).
- `GET /api/1/meta` reports the loaded profiles (`deviceProfiles`) with revision and sha256.

## 2. Device to profile mapping

- `Device.optimisation_profile -> str | None`; `None` = parametric / not applicable.
- `MinidspDescriptor` gains `precision` (`float32` | `fixed`). Built-in defaults:

  | device_type | precision / fs | profile |
  |---|---|---|
  | 24HD | float32 / 96k | `float32-96k` |
  | DDRC24, SHD, DDRC88, HTx | float32 / 48k | `float32-48k` |
  | 4x10 | fixed / 96k | none (unsupported for now) |
  | 10x10 | fixed / 48k | none (unsupported for now) |
  | 8x12CDSP | float32 / 192k | none (no 192k profile) |

- Per-device `optimisationProfile: <id> | none` in `ezbeq.yml` overrides the default and is how a
  custom `descriptor:` device is mapped. A custom descriptor may instead declare `precision:`; if a
  published profile matches both precision and `fs` it is used.
- Safety: a profile is only applied when its `rate` equals the device `fs` and its `storage` equals
  the device precision; otherwise it is refused with reason `rate_mismatch` / `precision_mismatch`.
- Composite devices resolve per member.

## 3. Per-device toggle

- `useOptimised` (default true) persisted in the device state cache, set via device PATCH
  `{"optimisation": {"enabled": false}}`.
- Toggling does not reload slots; the UI shows what is actually loaded.

## 4. Load path and state

- `Minidsp.load_filter` uses `optimised_biquads(...)` when a profile is mapped, available and
  enabled, passing them to `MinidspBeqCommandGenerator.filt(..., biquads=...)`; otherwise the
  existing `as_bq` path. `mv_adjust`, gains and raw `load_biquads` are unchanged.
- Slot records `coefficients: 'optimised' | 'standard' | 'unoptimised'` and `profile`:
  - `optimised`: optimised coefficients were loaded
  - `standard`: device is optimisable but the entry doesn't need optimisation
  - `unoptimised`: optimised coefficients exist for the entry (or the device can't be optimised)
    but were not used
  - old caches without the field read as unknown.
- Device state gains `optimisation: {profile, label, enabled, available, reason}` (`null` for
  parametric devices); `reason` in `disabled | no_profile | profile_unavailable | rate_mismatch |
  precision_mismatch`.
- Entry lookup `GET /api/1/devices/<name>/optimisation/<entry id>` so the UI can show whether a
  title is optimised for the selected device before loading.

## 5. UI (`ui/` and `mobile/` mirror)

- Device: "Use device-optimised filters" switch when `optimisation != null`; warning chip
  "Unoptimised" with reason tooltip when optimisation is unavailable or disabled.
- Slot: "Optimised (<label>)" chip; warning "Unoptimised" chip; nothing for `standard`.
- Entry: "Optimised for this device" badge, or a hint that optimisation is available but not in use.
- Nothing shown for parametric devices.

## 6. Tests and docs

- pytest: downloads (sha mismatch, unknown loading model, schema bump, unchanged sha, unused
  profile), lookups, minidsp command generation, mapping incl. fixed-point and mismatch refusal,
  custom descriptors, toggle and slot persistence, old caches, composites.
- Vitest/Jest: switch, chips, tooltips, parametric devices hidden.
- Docs: `optimisationProfile`, descriptor `precision`, device table (README), example config
  `examples/ezbeq_optimised.yml`.

## Phasing (one commit each)

1. Backend: loading, mapping, load path, state fields (always on).
2. Per-device toggle + PATCH and entry lookup API.
3. UI + mobile.
