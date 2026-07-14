-- proq4_apply_filters.lua
--
-- ==============================================================================
-- OVERVIEW
-- ==============================================================================
-- Persistent ReaScript that bridges ezbeq (running the "reaper" device type,
-- see ezbeq/reaper.py) to a single FabFilter Pro-Q 4 instance running inside
-- this REAPER session.
--
-- Data flow:
--   ezbeq (NixOS) --HTTP GET--> REAPER's Web Control interface --SET/EXTSTATE-->
--   REAPER's ExtState memory (in-process, not persisted to disk) --polled by--> THIS SCRIPT
--   --TrackFX_SetParam--> Pro-Q 4 VST3 instance
--
-- Why this approach instead of something simpler:
--   - Pro-Q 4 has NO native EQ scripting API (REAPER's TrackFX_GetEQParam/
--     TrackFX_SetEQParam only work with REAPER's own native ReaEQ plugin -
--     confirmed empirically via proq4_dump.lua, which showed Pro-Q's params
--     are not recognized by that API at all).
--   - Pro-Q 4's automatable parameters are generic VST3 floats normalized to
--     0..1, NOT real Hz/dB/Q values. The conversion formulas below were
--     reverse-engineered from REAL data (see proq4_curve_sample.lua, which
--     samples TrackFX_FormatParamValueNormalized() at many points and records
--     the actual display string REAPER shows for each normalized value) -
--     they are not assumed or guessed from documentation, because Pro-Q is
--     closed-source and no such documentation exists publicly.
--
-- ==============================================================================
-- VERIFIED CONVERSION FORMULAS (do not change without re-deriving from real
-- proq4_curve_sample.lua output - these were confirmed against actual sampled
-- data points, not derived analytically)
-- ==============================================================================
--   freq:  norm = log(freq/10) / log(3000)        valid range 10 Hz .. 30000 Hz
--          (confirmed: norm=0.5 -> 547.7 Hz matches sampled data exactly)
--   gain:  norm = (gain + 30) / 60                 linear, +/-30 dB
--          (confirmed: norm=0.5 -> 0.00dB, norm=1.0 -> +30dB, exactly linear
--          across all 20 sampled points)
--   q:     norm = log(q/0.025) / log(1600)         valid range 0.025 .. 40
--          (confirmed: norm=0.5 -> Q=1.000 matches sampled data exactly)
--   shape: NOT a formula - Pro-Q packs 10 discrete shapes unevenly into the
--          0..1 range (verified NOT evenly spaced - e.g. "Bell" only occupies
--          roughly 0..0.05 while "Notch" occupies roughly 0.5..0.6). Rather
--          than reverse-engineer the exact bin boundaries (risky - an off-by-
--          one could silently select the wrong shape), we reuse exact
--          normalized values ALREADY CONFIRMED by direct sampling to select
--          each shape we care about: 0.000=Bell, 0.100=LowShelf,
--          0.325=HighShelf. ezbeq's filter model only ever produces
--          PeakingEQ/LowShelf/HighShelf (confirmed from ezbeq/iir.py source -
--          there is no HighPass/LowPass/Notch in its model), so we don't need
--          known-good points for the other 7 Pro-Q shapes.
--   output level (used for mv_adjust): PARTIALLY VERIFIED - linear from
--          norm=0.2 (-21.6dB) to norm=1.0 (+36dB) via formula
--          db = (norm - 0.5) * 72, confirmed against every sampled point in
--          that range. Below norm=0.2 (< -21.6dB) the real curve bends toward
--          -INF and was NOT fully characterized (only a few sample points
--          exist there and they don't fit a simple formula) - values below
--          -21.6dB are CLAMPED with a console warning rather than guessed at,
--          since this directly controls gain-staging/clipping headroom and a
--          wrong guess here has real audio-safety consequences.
--
-- ==============================================================================
-- BAND ACTIVATION - TWO SEPARATE FLAGS REQUIRED
-- ==============================================================================
-- Pro-Q 4 distinguishes "Used" (this band slot exists / is instantiated in
-- the active chain - shows "Unused" by default even on a freshly loaded
-- instance) from "Enabled" (this existing band is not bypassed). BOTH must be
-- set to 1 for a band to actually process audio - confirmed directly from
-- proq4_dump.lua's raw parameter dump, which showed all 24 bands defaulting
-- to Used=0 ("Unused") even though Enabled=1. Setting only Enabled=1 (the
-- more "obvious" flag) silently does nothing audible.
--
-- ==============================================================================
-- DESIGN NOTES
-- ==============================================================================
-- - 24 bands in a SINGLE Pro-Q instance is enough capacity for every BEQ
--   profile seen so far (max observed: 7 filters) - unlike the earlier ReEQ
--   approach which needed 3 stacked instances (5 bands each) to reach 15.
-- - mv_adjust (ezbeq's "MV" master-volume-style headroom adjustment, e.g. a
--   Skyfall-style -3.5dB global trim to prevent clipping from boosted bass
--   bands) is applied ONCE to Pro-Q's dedicated "Output Level" parameter -
--   NOT added into each band's individual Gain. An earlier version of
--   reaper.py had this bug (adding mv_adjust per-band); fixed.
-- - mv_adjust's real source is entry.mv_adjust on the CatalogueEntry itself
--   (parsed from the BEQ catalog's "mv" key) - NOT the mv_adjust function
--   parameter ezbeq's own dispatcher passes around, which is always 0.0 in
--   practice (confirmed: DeviceRepository.load_filter() in ezbeq/device.py
--   never actually passes a real value into it). reaper.py reads
--   entry.mv_adjust directly to work around this.
-- ==============================================================================

local EXTSTATE_SECTION = "beqbridge"
local EXTSTATE_KEY = "filters"
local TRACK_NAME = "BEQ"      -- must exactly match the track name reaper.py/ezbeq targets
local POLL_INTERVAL = 0.25    -- seconds between ExtState checks - keep well under human-perceptible latency
local NUM_BANDS = 24          -- Pro-Q 4's maximum band count

-- Which Pro-Q instance on TRACK_NAME to control, counting in FX chain order
-- (1 = first Pro-Q found scanning top to bottom, 2 = second, etc). Only
-- relevant if you deliberately load more than one Pro-Q instance on the
-- track (e.g. one for BEQ, one for something else) - lets you pick which one
-- ezbeq drives instead of it always grabbing whichever comes first.
local Proq_Instance = 1

-- When true:
--   [1] prints each incoming filter's RAW parsed values exactly as received
--       from the ExtState payload, before any conversion - lets you confirm
--       ezbeq/reaper.py sent what you expected before blaming the Lua math.
--   [2] prints the received mv_adjust value the same way.
--   [3] after applying, reads back every band's ACTUAL current state
--       directly from Pro-Q via TrackFX_GetFormattedParamValue (real display
--       strings like "80.0 Hz", "+5.00 dB" - not just the normalized floats
--       we wrote) - this is a genuine independent confirmation that the
--       write landed correctly, not just an echo of what we intended to
--       write. This is what caught the Used-vs-Enabled bug during
--       development: freq/gain/q could read back correctly while the band
--       was still silently inactive.
-- Set to false once you're confident the setup is stable, to reduce console
-- noise - but there is no real performance cost to leaving it on, since the
-- console output is small (24 short lines) and poll interval is only 4Hz.
local DEBUGGING = true

local MIN_FREQ, MAX_FREQ = 10, 30000
local MIN_Q, MAX_Q = 0.025, 40
local MIN_GAIN, MAX_GAIN = -30, 30

-- Known-good normalized values, confirmed via proq4_curve_sample.lua, that
-- reliably produce each Shape we need. See the big comment block at the top
-- of this file for why this is a lookup table and not a formula.
local SHAPE_MAP = { PeakingEQ = 0.000, LowShelf = 0.100, HighShelf = 0.325 }
local SHAPE_DEFAULT = 0.000  -- Bell - safe fallback for any filter type ezbeq might send that we don't recognize

local last_version = -1

-- track/fx/output_level_idx/band_params are populated by init() and
-- potentially re-populated later if REAPER invalidates our track pointer
-- (e.g. the project is closed and reopened, or the track is deleted and an
-- identically-named one recreated) - see the ValidatePtr check in loop().
local track, fx, output_level_idx
local band_params = {}  -- [bandnum] = { freq=paramidx, gain=paramidx, q=paramidx, shape=paramidx, used=paramidx, enabled=paramidx }

-- ==============================================================================
-- CONVERSION HELPERS
-- ==============================================================================

local function clamp(v, lo, hi)
  if v < lo then return lo elseif v > hi then return hi else return v end
end

-- Converts a real frequency in Hz to Pro-Q's normalized 0..1 parameter value.
-- See the verified-formula comment block at the top of this file.
local function freq_to_norm(freq)
  freq = clamp(freq, MIN_FREQ, MAX_FREQ)
  return clamp(math.log(freq / MIN_FREQ) / math.log(MAX_FREQ / MIN_FREQ), 0, 1)
end

-- Converts a real Q factor to Pro-Q's normalized 0..1 parameter value.
local function q_to_norm(q)
  q = clamp(q, MIN_Q, MAX_Q)
  return clamp(math.log(q / MIN_Q) / math.log(MAX_Q / MIN_Q), 0, 1)
end

-- Converts a real gain in dB to Pro-Q's per-BAND normalized 0..1 parameter
-- value. NOTE: this is a DIFFERENT curve than output_gain_to_norm() below -
-- band Gain is fully linear across its whole +/-30dB range, but Output Level
-- (used for mv_adjust) is only linear in part of its range. Do not conflate
-- the two even though they're both "gain in dB" conceptually.
local function gain_to_norm(gain)
  gain = clamp(gain, MIN_GAIN, MAX_GAIN)
  return clamp((gain - MIN_GAIN) / (MAX_GAIN - MIN_GAIN), 0, 1)
end

-- Converts a real gain in dB to Pro-Q's Output Level normalized 0..1
-- parameter value - used exclusively for mv_adjust (ezbeq's master-volume-
-- style headroom trim), applied ONCE per update, not per band.
-- See the big verified-formula comment block at the top of this file for why
-- the valid range is asymmetric (-21.6dB verified floor, not -30dB).
local OUTPUT_VERIFIED_MIN_DB = -21.6
local OUTPUT_MAX_DB = 36
local function output_gain_to_norm(db)
  if db < OUTPUT_VERIFIED_MIN_DB then
    if DEBUGGING then
      reaper.ShowConsoleMsg(string.format(
        "WARNING: mv_adjust=%.2fdB is below the verified linear range of Output Level (floor %.1fdB) - " ..
        "clamping to %.1fdB. Run proq4_curve_sample.lua again with more low-end samples if this recurs " ..
        "often, so the curve can be characterized further down instead of just clamped.\n",
        db, OUTPUT_VERIFIED_MIN_DB, OUTPUT_VERIFIED_MIN_DB))
    end
    db = OUTPUT_VERIFIED_MIN_DB
  end
  db = clamp(db, OUTPUT_VERIFIED_MIN_DB, OUTPUT_MAX_DB)
  return clamp(0.5 + db / 72, 0, 1)
end

-- ==============================================================================
-- DISCOVERY HELPERS
-- ==============================================================================

local function find_track_by_name(name)
  for i = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, i)
    local _, tname = reaper.GetTrackName(tr)
    if tname == name then return tr end
  end
  return nil
end

local function find_proq(tr, instance_num)
  local count = reaper.TrackFX_GetCount(tr)
  local found = 0
  for i = 0, count - 1 do
    local _, fx_name = reaper.TrackFX_GetFXName(tr, i, "")
    if fx_name:find("Pro%-Q") or fx_name:find("FabFilter") then
      found = found + 1
      if found == instance_num then
        return i, found
      end
    end
  end
  return nil, found
end

local function build_band_params(tr, fxi)
  local bands = {}
  local param_count = reaper.TrackFX_GetNumParams(tr, fxi)
  for p = 0, param_count - 1 do
    local _, name = reaper.TrackFX_GetParamName(tr, fxi, p, "")
    if name == "Output Level" then
      output_level_idx = p
    else
      local bandnum, field = name:match("^Band (%d+) (%a+)$")
      if bandnum then
        bandnum = tonumber(bandnum)
        bands[bandnum] = bands[bandnum] or {}
        if field == "Frequency" then bands[bandnum].freq = p
        elseif field == "Gain" then bands[bandnum].gain = p
        elseif field == "Q" then bands[bandnum].q = p
        elseif field == "Shape" then bands[bandnum].shape = p
        elseif field == "Used" then bands[bandnum].used = p
        elseif field == "Enabled" then bands[bandnum].enabled = p
        end
      end
    end
  end
  return bands
end

local function init()
  track = find_track_by_name(TRACK_NAME)
  if not track then
    reaper.ShowConsoleMsg("Track '" .. TRACK_NAME .. "' not found.\n")
    return false
  end

  local total_found
  fx, total_found = find_proq(track, Proq_Instance)
  if not fx then
    reaper.ShowConsoleMsg(string.format(
      "Proq_Instance=%d requested but only %d Pro-Q instance(s) found on track '%s'.\n",
      Proq_Instance, total_found, TRACK_NAME))
    return false
  end

  band_params = build_band_params(track, fx)
  reaper.ShowConsoleMsg(string.format(
    "proq4_apply_filters: initialized (Proq_Instance=%d, FX index %d, %d bands discovered), watching ExtState %s/%s\n",
    Proq_Instance, fx, NUM_BANDS, EXTSTATE_SECTION, EXTSTATE_KEY))
  return true
end

-- ==============================================================================
-- CORE APPLY / CLEAR LOGIC
-- ==============================================================================

local function clear_all_bands()
  for bandnum, p in pairs(band_params) do
    if p.used then reaper.TrackFX_SetParam(track, fx, p.used, 0) end
    if p.enabled then reaper.TrackFX_SetParam(track, fx, p.enabled, 0) end
    if p.gain then reaper.TrackFX_SetParam(track, fx, p.gain, gain_to_norm(0)) end
  end
  if output_level_idx then
    reaper.TrackFX_SetParam(track, fx, output_level_idx, output_gain_to_norm(0))
  end
end

local function dump_all_bands()
  reaper.ShowConsoleMsg("[DEBUG] --- Reading back all 24 bands from Pro-Q ---\n")
  for bandnum = 1, NUM_BANDS do
    local p = band_params[bandnum]
    if p then
      local function fmt(paramidx)
        if not paramidx then return "?" end
        local _, display = reaper.TrackFX_GetFormattedParamValue(track, fx, paramidx, "")
        return display or "?"
      end
      reaper.ShowConsoleMsg(string.format(
        "[DEBUG] Band %2d: Used=%s Enabled=%s Shape=%s Freq=%s Gain=%s Q=%s\n",
        bandnum, fmt(p.used), fmt(p.enabled), fmt(p.shape), fmt(p.freq), fmt(p.gain), fmt(p.q)))
    else
      reaper.ShowConsoleMsg(string.format("[DEBUG] Band %2d: not discovered (unexpected - Pro-Q should always expose 24 bands)\n", bandnum))
    end
  end
  if output_level_idx then
    local _, display = reaper.TrackFX_GetFormattedParamValue(track, fx, output_level_idx, "")
    reaper.ShowConsoleMsg(string.format("[DEBUG] Output Level: %s\n", display or "?"))
  end
  reaper.ShowConsoleMsg("[DEBUG] --- End readback ---\n")
end

local function apply_filters(mv_adjust, filters)
  clear_all_bands()

  if DEBUGGING then
    reaper.ShowConsoleMsg(string.format("[DEBUG] Received mv_adjust=%s\n", tostring(mv_adjust)))
  end

  if output_level_idx and mv_adjust ~= 0 then
    reaper.TrackFX_SetParam(track, fx, output_level_idx, output_gain_to_norm(mv_adjust))
  end

  local max_idx = 0
  for i in pairs(filters) do
    if i > max_idx then max_idx = i end
  end

  if max_idx > NUM_BANDS then
    reaper.ShowConsoleMsg(string.format(
      "WARNING: %d filters received but only %d bands available on Pro-Q - filters %d+ will be dropped. " ..
      "Consider whether this BEQ profile genuinely needs more than 24 bands, or whether something " ..
      "upstream is sending malformed/duplicate data.\n",
      max_idx, NUM_BANDS, NUM_BANDS + 1))
  end

  for i = 1, math.min(max_idx, NUM_BANDS) do
    local f = filters[i]
    if f then
      if DEBUGGING then
        reaper.ShowConsoleMsg(string.format(
          "[DEBUG] Received filter %d: type=%s freq=%s gain=%s q=%s\n",
          i, tostring(f.type), tostring(f.freq), tostring(f.gain), tostring(f.q)))
      end

      local p = band_params[i]
      if p and p.freq and p.gain and p.q and p.shape and p.used and p.enabled then
        local shape_norm = SHAPE_MAP[f.type]
        if not shape_norm then
          reaper.ShowConsoleMsg(string.format(
            "Filter %d: unrecognized type '%s', defaulting to Bell (parametric peak).\n", i, f.type))
          shape_norm = SHAPE_DEFAULT
        end
        reaper.TrackFX_SetParam(track, fx, p.shape, shape_norm)
        reaper.TrackFX_SetParam(track, fx, p.freq, freq_to_norm(f.freq))
        reaper.TrackFX_SetParam(track, fx, p.gain, gain_to_norm(f.gain))
        reaper.TrackFX_SetParam(track, fx, p.q, q_to_norm(f.q))
        reaper.TrackFX_SetParam(track, fx, p.used, 1)
        reaper.TrackFX_SetParam(track, fx, p.enabled, 1)
      else
        reaper.ShowConsoleMsg(string.format(
          "Filter %d: band %d parameters not fully discovered on this Pro-Q instance - skipped. " ..
          "This should not normally happen on a standard 24-band Pro-Q 4 instance; if it does, " ..
          "re-run proq4_dump.lua and check the parameter names actually match \"Band N <Field>\".\n", i, i))
      end
    end
  end

  if DEBUGGING then
    dump_all_bands()
  end
end

-- ==============================================================================
-- PAYLOAD PARSING
-- ==============================================================================

local function parse_filters(content)
  local version = tonumber(content:match("version=(%d+)"))
  if not version then
    if DEBUGGING then
      reaper.ShowConsoleMsg("[DEBUG] parse_filters: no 'version=' found in ExtState content, ignoring - " ..
        "this is expected if ExtState is empty/stale, but check reaper.py's payload format if it recurs.\n")
    end
    return nil
  end

  if content:match("clear=1") then
    return { version = version, clear = true, mv = 0, filters = {} }
  end

  local mv = tonumber(content:match("mv=([%-%d%.]+)")) or 0

  local filters = {}
  for line in content:gmatch("[^\r\n]+") do
    local idx, ftype, freq, gain, q = line:match(
      "band(%d+)%s+type=(%a+)%s+freq=([%-%d%.]+)%s+gain=([%-%d%.]+)%s+q=([%-%d%.]+)"
    )
    if idx then
      filters[tonumber(idx)] = {
        type = ftype,
        freq = tonumber(freq),
        gain = tonumber(gain),
        q = tonumber(q),
      }
    end
  end
  return { version = version, clear = false, mv = mv, filters = filters }
end

-- ==============================================================================
-- MAIN POLLING LOOP
-- ==============================================================================

local last_check = 0

local function poll_once()
  local now = reaper.time_precise()
  if now - last_check < POLL_INTERVAL then
    return
  end
  last_check = now

  if not reaper.ValidatePtr(track, "MediaTrack*") then
    if DEBUGGING then
      reaper.ShowConsoleMsg("[DEBUG] Track pointer no longer valid (project reload / track recreated?) - re-initializing.\n")
    end
    if not init() then
      return
    end
  end

  if not reaper.HasExtState(EXTSTATE_SECTION, EXTSTATE_KEY) then
    return
  end

  local content = reaper.GetExtState(EXTSTATE_SECTION, EXTSTATE_KEY)
  local data = parse_filters(content)
  if not data or data.version == last_version then
    return
  end
  last_version = data.version

  if data.clear then
    reaper.Undo_BeginBlock()
    clear_all_bands()
    reaper.Undo_EndBlock("ezbeq/Pro-Q: clear all bands", -1)
    reaper.ShowConsoleMsg(string.format("Cleared all bands (version %d)\n", data.version))
  else
    reaper.Undo_BeginBlock()
    apply_filters(data.mv, data.filters)
    reaper.Undo_EndBlock("ezbeq/Pro-Q: apply filter set", -1)
    reaper.ShowConsoleMsg(string.format("Applied filter version %d (mv_adjust=%.2f dB)\n", data.version, data.mv))
  end
end

local function loop()
  local ok, err = pcall(poll_once)
  if not ok then
    reaper.ShowConsoleMsg("[ERROR] proq4_apply_filters: unexpected error in poll_once(), continuing anyway: "
      .. tostring(err) .. "\n")
  end
  reaper.defer(loop)
end

if init() then
  reaper.defer(loop)
end
