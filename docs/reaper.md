# Adding a REAPER + FabFilter Pro-Q 4 Device to ezbeq

This guide adds a new `reaper` device type to ezbeq, so it can push BEQ
filters directly into a FabFilter Pro-Q 4 instance running inside REAPER,
using REAPER's built-in Web Control interface. No NixOS required - this
works on any machine that can run Python (Linux, macOS, Windows) for the
ezbeq side, and any Windows/Mac machine running REAPER on the other end.

The REAPER-side script referenced throughout this guide,
[`proq4_apply_filters.lua`](proq4_apply_filters.lua), lives alongside this
page and can be downloaded directly from there. An example ezbeq config is
also provided at
[`examples/ezbeq_reaper.yml`](https://github.com/3ll3d00d/ezbeq/blob/master/examples/ezbeq_reaper.yml)
in the repository root.

## What you need

- ezbeq source code (clone from https://github.com/3ll3d00d/ezbeq)
- `reaper.py` (the new device module)
- `proq4_apply_filters.lua` (the REAPER-side script)
- REAPER, with FabFilter Pro-Q 4 installed
- Both machines reachable over the network (can be the same machine)

---

## Step 1: Add `reaper.py` to the ezbeq source

Copy `reaper.py` into ezbeq's package folder, alongside the other device
modules:

```
ezbeq/ezbeq/reaper.py
```

(i.e. next to `ezbeq/ezbeq/htp1.py`, `ezbeq/ezbeq/minidsp.py`, etc - same
folder, same level.)

## Step 2: Modify `device.py` to register the new device type

Open `ezbeq/ezbeq/device.py` and find the `create_devices` function. It
contains a chain of `elif d_type == '...':` blocks, one per supported
device type - something like:

```python
elif d_type == 'camilladsp':
    from ezbeq.camilladsp import CamillaDsp
    devices.append(CamillaDsp(name, cfg.config_path, values, ws_server, catalogue))
```

Add a new `elif` block for `reaper` immediately after it (order among the
`elif` blocks doesn't matter, but keeping it near the end is tidy):

```python
elif d_type == 'reaper':
    from ezbeq.reaper import Reaper
    devices.append(Reaper(name, cfg.config_path, values, ws_server, catalogue))
```

Save the file. That's the only source change needed - `reaper.py` itself
doesn't require any other file to be touched.

## Step 3: Reinstall/rebuild ezbeq so the change is picked up

If you're running ezbeq from source with `pip install -e .` (editable
install), no reinstall is needed - just restart ezbeq. If you installed it
as a regular package, reinstall from your modified source tree, e.g.:

```
pip install --break-system-packages .
```

(run from inside the ezbeq source folder)

## Step 4: Configure the device in ezbeq's `config.yml`

Add a `reaper1` entry (name is up to you) under `devices:`:

```yaml
devices:
  reaper1:
    type: reaper
    ip: 192.168.1.50:8080       # the REAPER machine's IP and Web Control port (see Step 5)
    extstate_section: beqbridge  # optional, this is the default
    extstate_key: filters        # optional, this is the default
    timeout: 3                   # optional, HTTP timeout in seconds
```

Restart ezbeq after saving. You should see a new "REAPER" device/slot show
up in ezbeq's web UI.

---

## Step 5: Enable REAPER's Web Control interface

This is what lets ezbeq talk to REAPER over HTTP. On the machine running
REAPER:

1. Open REAPER's preferences: **Options → Preferences → Control/OSC/Web**.
2. Click **Add**, and choose **"Web browser interface"** from the list (not
   a plain "OSC" device - this specific one is what exposes the HTTP
   interface ezbeq needs).
3. Set a port (e.g. `8080`) - this must match the port you used in
   `config.yml`'s `ip:` field (e.g. `192.168.1.50:8080`).
4. Leave the local IP as `0.0.0.0` or blank, so it listens on all network
   interfaces rather than only localhost (needed since ezbeq is likely
   running on a different machine).
5. Click OK/Apply.
6. **Allow the port through your firewall** on the REAPER machine. On
   Windows, PowerShell (run as Administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "REAPER Web Control" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
   ```

**Test it works** before moving on - from the ezbeq machine (or any
machine on the network), run:

```
curl "http://192.168.1.50:8080/_/SET/EXTSTATE/beqbridge/filters/hello"
```

If REAPER is reachable, this returns without a network error (the actual
HTTP response body doesn't matter much here - a connection failure is the
thing to watch for).

## Step 6: Set up the track and Pro-Q 4 instance in REAPER

1. Create a track in your REAPER project (or use an existing one) that sits
   in your BEQ signal path.
2. **Name the track** something specific - e.g. `BEQ`. You'll need this
   exact name in the Lua script (see `TRACK_NAME` below).
3. Add a single **FabFilter Pro-Q 4** instance to that track's FX chain.
   One instance gives you 24 bands, which is enough headroom for any BEQ
   profile likely to be encountered.

## Step 7: Install and run `proq4_apply_filters.lua`

1. Copy `proq4_apply_filters.lua` into REAPER's Scripts folder. You can
   find/create this folder via **Options → Show REAPER resource path in
   explorer/finder**, then look for (or create) a `Scripts` subfolder.
2. In REAPER, open the **Actions List** (`?` menu or `Actions →
   Show action list...`).
3. Click **New action... → Load ReaScript...** and select
   `proq4_apply_filters.lua`.
4. With the action selected in the list, click **Run** (or double-click
   it) to start it.

The script runs continuously in the background (via REAPER's `defer()`
mechanism) until you stop it or close REAPER - it doesn't finish and exit
like a one-shot script. You'll need to run it again each time you reopen
the project, unless you set up an auto-start (see note at the end).

Check REAPER's console (the same window ReaScript errors/prints show up
in) for a line like:

```
proq4_apply_filters: initialized (Proq_Instance=1, FX index 0, 24 bands discovered), watching ExtState beqbridge/filters
```

If instead you see `"Track 'BEQ' not found."` or similar, see the
`TRACK_NAME` section below.

---

## The three variables you'll most likely need to adjust

These are all declared near the top of `proq4_apply_filters.lua` as plain
Lua `local` variables - edit the file directly and re-run it (stop the
running instance first, or just re-run it after editing; REAPER doesn't
require a restart) to apply a change.

### `TRACK_NAME`

```lua
local TRACK_NAME = "BEQ"
```

Must **exactly match** (case-sensitive) the name of the track holding your
Pro-Q 4 instance (Step 6). If you named your track something other than
`BEQ`, change this to match. If it doesn't match, the script will print
`Track '<name>' not found.` and won't do anything else.

### `Proq_Instance`

```lua
local Proq_Instance = 1
```

Which Pro-Q 4 instance on that track to control, if you have more than
one loaded (counting from the top of the FX chain: `1` = the first Pro-Q
found, `2` = the second, etc). Most setups only need one Pro-Q instance on
the track, so the default of `1` is normally correct. If you ever add a
second Pro-Q instance for some other purpose and the script grabs the
wrong one, change this to point at the right one - the console message on
startup tells you which FX index it actually picked.

### `DEBUGGING`

```lua
local DEBUGGING = true
```

When `true`, the script prints extra detail to REAPER's console on every
filter update:
- each incoming filter's raw values exactly as received (before any unit
  conversion),
- the received `mv_adjust` value,
- and, after applying, a full readback of all 24 bands' *actual* current
  state read directly back from Pro-Q (not just what the script thinks it
  wrote) - useful for confirming a filter load really took effect.

Leave this `true` while you're setting things up and verifying everything
works. Once you're confident it's stable, you can set it to `false` to
quiet the console down - there's no real performance cost either way, so
this is purely about how much console output you want to see.

---

## Testing end to end

1. In ezbeq's web UI, pick a BEQ catalog entry and load it onto the
   `reaper1` device/slot.
2. Watch REAPER's console - you should see filter values being received
   and applied, and (if `DEBUGGING = true`) a full band readback.
3. Open Pro-Q 4's own GUI on the track and visually confirm the bands moved
   as expected.
4. Try clearing the filter from ezbeq's UI and confirm all bands reset to
   flat/off in Pro-Q.

## Optional: auto-starting the script

By default you have to manually run the script from the Actions List each
time you open the project. If you want it to start automatically, REAPER
supports a "global startup action" (via the SWS extension) or a
project-specific startup action - search REAPER's own documentation/forum
for "startup action" for the exact current steps for your REAPER version,
since this is a REAPER-level feature unrelated to anything in this guide's
scripts themselves.
