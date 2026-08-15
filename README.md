# ezbeq

A simple web browser for [beqcatalogue](https://beqcatalogue.readthedocs.io/en/latest/) which integrates
with [minidsp-rs](https://github.com/mrene/minidsp-rs)
for local remote control of a minidsp, HTP-1, StormAudio processor or other supported DSP.

A companion [mobile app](#mobile-app) (iOS/iPadOS + Android) is also available, covering the main
BEQ workflow against an existing ezbeq server.

Full documentation, including this README, is also published at
**[ezbeq.readthedocs.io](https://ezbeq.readthedocs.io)**.

## Table of Contents

- [Setup](#setup)
  - [Python 3.14+ Note](#python314)
  - [Windows / MacOS](#windows--macos)
  - [Linux](#linux)
  - [Installation](#installation)
    - [Docker](#docker)
    - [Example Config Files](#example-config-files)
    - [Using with a Minidsp](#using-with-a-minidsp)
    - [Using with a Monolith HTP-1](#using-with-a-monolith-htp-1)
  - [Upgrade](#upgrade)
- [Mobile App](#mobile-app)
- [Scripts (bin/)](#scripts-bin)
- [How the app is structured](#how-the-app-is-structured)
- [Running the app](#running-the-app)
  - [Stub mode — no hardware required](#stub-mode--no-hardware-required)
  - [Frontend hot-reload (UI development)](#frontend-hot-reload-ui-development)
  - [Running the tests](#running-the-tests)
  - [Smoke test](#smoke-test)
- [Configuration](#configuration)
  - [Using a custom catalogue](#using-a-custom-catalogue)
  - [Configuring Devices](#configuring-devices)
    - [Minidsp](#minidsp)
    - [Monolith HTP1](#monolith-htp1)
    - [StormAudio](#stormaudio)
    - [JRiver Media Center](#jriver-media-center)
    - [Q-Sys](#q-sys)
    - [CamillaDSP](#camilladsp)
- [Starting ezbeq on bootup](#starting-ezbeq-on-bootup)
- [Verifying MiniDSP Response](#verifying-minidsp-response)
  - [Quick & Crude](#quick--crude)
  - [Slower but Accurate](#slower-but-accurate)

# Setup

## Python 3.14+ 

ezbeq is compatible with python 3.14 but depends on the presence of the [compression.zstd](https://docs.python.org/3/library/compression.zstd.html#module-compression.zstd) **optional** module. It will fail to start in the absence of this module. [pyenv](https://github.com/pyenv/pyenv) users should ensure that libzstd_dev (or equivalent for their OS/distro) is installed as a prerequisite.

## Windows / MacOS

Python is required so use an appropriate package manager to install it.

[chocolatey](https://chocolatey.org/) is a convenient choice for Windows
[homebrew](https://docs.brew.sh/Installation) is the equivalent for MacOS

## Linux

Use your distro package manager to install python.

## Installation

ezbeq uses [uv](https://docs.astral.sh/uv/) for dependency management.

    $ curl -LsSf https://astral.sh/uv/install.sh | sh
    $ git clone https://github.com/3ll3d00d/ezbeq
    $ cd ezbeq
    $ uv sync

Example is provided for rpi users

    $ ssh pi@myrpi
    $ sudo apt install python3 python3-venv python3-pip libyaml-dev
    $ curl -LsSf https://astral.sh/uv/install.sh | sh
    $ git clone https://github.com/3ll3d00d/ezbeq
    $ cd ezbeq
    $ uv sync

### Docker

The official ezBEQ docker image is published at https://github.com/3ll3d00d/ezbeq-docker.
See that project's README for setup instructions, example compose files, and USB device configuration.

#### Running in Docker

Set `EZBEQ_ACCESS_LOG_STDOUT=1` in your container environment to echo every HTTP request to stdout so it appears in `docker compose logs`. This is independent of `accessLogging:` in `ezbeq.yml` (which controls the access log file).

### Example Config Files

See [examples](examples)

| Type                        | File                                                                                                                                                                        |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Camilla DSP                 | [for CamillaDSP v3](examples/ezbeq_camilladsp3.yml)                                                                                                                         |
| J River Media Center        | [ezbeq_mc.yml](examples/ezbeq_mc.yml)                                                                                                                                       |
| Minidsp 2x4HD               | [ezbeq_md.yml](examples/ezbeq_md.yml), [using multiple devices](examples/ezbeq_md2.yml) or [with custom slot names](examples/ezbeq_named.yml)                               |
| Minidsp 4x10                | [ezbeq_4x10.yml](examples/ezbeq_4x10.yml)                                                                                                                                   |
| Minidsp 10x10               | [without use of XO](examples/ezbeq_10x10.yml), [with](examples/ezbeq_10x10_xo.yml) or [using a custom mapping across input, output and xo](examples/ezbeq_10x10_custom.yml) |
| Minidsp DDRC-24             | [ezbeq_ddrc24.yml](examples/ezbeq_ddrc24.yml)                                                                                                                               |
| Minidsp DDRC-88             | [ezbeq_ddrc88.yml](examples/ezbeq_ddrc88.yml)                                                                                                                               |
| Minidsp HTx                 | [ezbeq_htx.yml](examples/ezbeq_htx.yml)                                                                                                                                     |
| Minidsp SHD                 | [ezbeq_shd.yml](examples/ezbeq_shd.yml)                                                                                                                                     |
| Monolith HTP-1              | [ezbeq_htp1.yml](examples/ezbeq_htp1.yml)                                                                                                                                   |
| Q-Sys                       | [ezbeq_qsys.yml](examples/ezbeq_qsys.yml)                                                                                                                                   |
| StormAudio                  | [ezbeq_stormaudio.yml](examples/ezbeq_stormaudio.yml)                                                                                                                       |
| Multiple, different devices | [ezbeq_multi.yml](examples/ezbeq_multi.yml)                                                                                                                                 |
| Composite (grouped) devices | [ezbeq_composite.yml](examples/ezbeq_composite.yml)                                                                                                                         |

### Using with a Minidsp

Install minidsp-rs as per the [provided instructions](https://github.com/mrene/minidsp-rs#installation)

### Using with a Monolith HTP-1

See the configuration section below

## Upgrade

    $ cd ezbeq
    $ git pull
    $ uv sync

then restart the app

## Mobile App

A companion iOS/iPadOS + Android app is available covering the main BEQ workflow: browse/search
the catalogue, inspect an entry, upload a filter to a device slot, activate/clear slots, and adjust
gain — kept live over the same WebSocket the web UI uses. It's a companion, not a replacement: it
talks to an existing ezbeq server over your LAN and requires one to be running first (see
[Setup](#setup) above).

- **Full install instructions** (Android APK, iOS/iPadOS sideloading without an Apple developer
  account): [ezbeq.readthedocs.io — Mobile App](https://ezbeq.readthedocs.io/en/latest/mobile/)
- **Downloads**: every tagged [GitHub Release](https://github.com/3ll3d00d/ezbeq/releases)
  publishes `ezbeq-mobile-android.apk` (directly installable) and the unsigned iOS build artifacts
  (`ezbeq-mobile-ios-unsigned.ipa` / `ezbeq-mobile-ios.xcarchive.zip`, see the iOS install guide
  above for the required one-time signing step)
- **Building from source / development**: [mobile/README.md](mobile/README.md)

## Scripts (bin/)

| Script | Purpose |
|--------|---------|
| [`bin/run-server`](#running-the-app) | Start the server with real hardware |
| [`bin/run-server-stub`](#stub-mode--no-hardware-required) | Start with a simulated device — no hardware needed |
| [`bin/run-ui-dev`](#frontend-hot-reload-ui-development) | Hot-reload UI dev mode (Vite + Python backend) |
| [`bin/run-tests`](#running-the-tests) | Run pytest suite + smoke test |
| [`bin/smoke-test`](#smoke-test) | HTTP smoke test against a running server |

## How the app is structured

ezbeq is a single Python server (Twisted) that does two things:

1. **Serves the REST API** — `/api/...` routes handled by Flask
2. **Serves the React UI** — pre-built static files from `ezbeq/ui/`

The UI source lives in `ui/` and is built with [Vite](https://vitejs.dev/) /
[Yarn](https://yarnpkg.com/). Running `yarn build` compiles it into
`ezbeq/ui/`, which the Python server then picks up automatically. The Docker
image ships with the UI pre-built.

## Running the app

    $ cd ezbeq
    $ bin/run-server

Then open http://localhost:8080 in your browser.

> **Note:** `bin/run-server` requires the `minidsp` binary in your PATH.
> Install it from [minidsp-rs releases](https://github.com/mrene/minidsp-rs/releases).
> To run without hardware, see *Stub mode* below.

### Stub mode — no hardware required

Simulates a MiniDSP 2x4HD in memory. No `minidsp` binary or physical device
needed. Builds the UI automatically if it hasn't been built yet.

    $ bin/run-server-stub

Then open http://localhost:8080.

### Frontend hot-reload (UI development)

For iterating on the React UI without rebuilding after every change:

    $ bin/run-ui-dev

This starts **two** processes and wires them together:

| Process | URL | Purpose |
|---------|-----|---------|
| Python backend (stub) | http://localhost:8080 | API + WebSocket |
| Vite dev server | http://localhost:5174 | UI with hot-reload |

Open **http://localhost:5174** in your browser. Edits to files under `ui/src/`
are reflected instantly. The Python backend does not hot-reload; restart the
script when you change backend code.

> **Requires Node + Yarn.** Node is available via
> [homebrew](https://formulae.brew.sh/formula/node) (`brew install node`).
> Yarn is activated via `corepack enable yarn`.

### Running the tests

    $ bin/run-tests

This runs the pytest suite followed by an HTTP smoke test that starts a stub
server, makes real HTTP requests, and checks the responses.

### Smoke test

`bin/smoke-test` can also be run standalone — useful for checking a server
that is already running:

    $ bin/smoke-test                  # start a temporary stub server, run checks, stop
    $ bin/smoke-test --port 9999      # same, but on a custom port
    $ bin/smoke-test --no-start       # check a server already running on port 8080

## Configuration

See `$HOME/.ezbeq/ezbeq.yml`

The only intended option for override is the port option which sets the port the UI and API is accessible on. This
defaults to 8080.

### Using a custom catalogue

If `catalogueUrl` is added to the configuration, e.g.

    catalogueUrl: http://localhost:9999

ezbeq will instead load the catalogue from `http://localhost:9999/database.json`

This provides the ability to run ezbeq against a custom, or locally provided, catalogue.

### Configuring Devices

The devices section contains a list of supported device, the format varies by the type of device and each item is a
named device with the name subsequently appearing the UI (if multiple devices are listed)

#### Minidsp

Default values are shown, the only required value is the type field

```
  minidsp:
    cmdTimeout: 10
    exe: minidsp
    ignoreRetcode: false
    options: ''
    slotChangeDelay: false
    type: minidsp
```

* cmdTime: default timeout in seconds for a command sent to minidsp-rs to complete
* exe: location of the minidsp-rs executable
* ignoreRetcode: if true, errors generated by minidsp-rs will be ignored (for debugging/local testing only)
* options: additional command line switches to pass to minidsp-rs (refer to minidsp-rs docs for details)
* type: minidsp
* slotChangeDelay: if true, the command to change the slot is always sent to minidsp-rs as a separate command. If a
  positive integer or float, it represents an additional delay (in seconds) that will separate each command.

By default, it is assumed the Minidsp 2x4HD is in use. To use a different model, specify via the device_type option. For
example:

```
  minidsp:
    cmdTimeout: 10
    exe: minidsp
    ignoreRetcode: false
    options: ''
    type: minidsp
    device_type: 4x10
```

In order for the ezbeq ui to update when the device status is updated outside of ezbeq (e.g. using minidsp remote
control), additional configuration is required to enable
the [minidsp rs websocket interface](https://minidsp-rs.pages.dev/daemon/http#websocket-streaming)

This requires 2 optional additional values in the configuration

```
  wsDeviceId: 0
  wsIp: 127.0.0.1:5380
```

`wsIp` is the address of the `[http_server]` from `/etc/minidsp/config.toml`
`wsDeviceId` is the device id provided by `minidsp probe`, in this example 2 device ids (0 and 1) are available

```
$ minidsp probe                                                                                                                                                                                
Found 2x4HD with serial 911111 at ws://localhost/devices/0/ws [hw_id: 10, dsp_version: 100]
Found 2x4HD with serial 911112 at ws://localhost/devices/1/ws [hw_id: 10, dsp_version: 100]
```

Using, and controlling, multiple devices independently is supported but does require use of the `options` key in order
to direct commands to the right device. Precise configuration of this option depends on the minidsp-rs setup so is out
of scope of this readme. Typical configuration would involve use of the `--tcp` option combined with changes to
`minidsp.toml` as mentioned in the [minidsp-rs docs](https://minidsp-rs.pages.dev/daemon/tcp#multiple-devices).

For reference, a community provided example configuration guide can be found
via [avs](https://www.avsforum.com/threads/ezbeq-use-and-development-discussion.3181732/page-170#post-62257128)

##### Naming Slots

By default, the slots are numbered 1-4 as per the minidsp console.

To override, extend the device configuration with the `slotNames` key as illustrated
in [this example](examples/ezbeq_named.yml). It is not necessary to list every slot, just those that require an explicit
name.

##### Minidsp Variants

Device support largely tracks [minidsp-rs device support](https://minidsp-rs.pages.dev/devices).

BEQ MV adjustments are applied to input peq channels only.

###### [2x4HD](https://www.minidsp.com/products/minidsp-in-a-box/minidsp-2x4-hd)

set `device_type: 24HD`

BEQ filters are written to both input channels.

##### [Flex](https://www.minidsp.com/products/minidsp-in-a-box/flex)

configure as per 2x4HD

add `slotChangeDelay: true` to workaround issues with slow slot changing. If it remains unstable, use
`slotChangeDelay: 1.5` (or some other number, experiment to find the smallest value that enables a reliable experience).

Dirac mode (PEQ on output) is only supported at present via a custom configuration.

###### [DDRC-24](https://www.minidsp.com/products/dirac-series/ddrc-24)

set `device_type: DDRC24`

BEQ filters are written to all output channels.

###### [DDRC-88](https://www.minidsp.com/products/dirac-series/ddrc-88a)

set `device_type: DDRC88`

BEQ filters are written to output channel 3 by default.

Add the `sw_channels` config key to override this, provide a list of channel indexes (0 based) to which the filters
should be written. For example to write to the last two output channels:

    device_type: DDRC88
    sw_channels:
    - 6
    - 7

###### [HTx](https://www.minidsp.com/products/ht-series/flex-htx)

set `device_type: HTx`

If using [minidsp-rs 0.1.12](https://github.com/mrene/minidsp-rs/releases/tag/v0.1.12)

* BEQ filters are written to output channel 3 by default.
* Add the `sw_channels` config key to override this, provide a list of channel indexes (0 based) to which the filters
  should be written. For example to write to the last two output channels:

  device_type: HTx
  sw_channels:
    - 6
    - 7

If using a build of minidsp-rs that contains [this PR](https://github.com/mrene/minidsp-rs/pull/767):

* BEQ filters are written to input channel 3 by default.
* Add the `channels` config key to override this, provide a list of channel indexes (0 based) to which the filters
  should be written. For example to write to the last two input channels:

  device_type: HTx
  channels:
    - 6
    - 7

###### [4x10](https://www.minidsp.com/products/plugins/4x10-plug-in-detail)

set `device_type: 4x10`

The limited biquad capacity (5 per channel) means that filters are split across input and output channels and there is
no capacity for user filters.

###### [10x10](https://www.minidsp.com/products/plugins/4x10-10x10-plug-ins/10x10-plug-in-detail)

set `device_type: 10x10`

The limited biquad capacity (6 per channel) means that filters are split across input and output channels and the last 2
biquads per output channel are left under user control.

To avoid this, use the crossover biquads to hold the remaining beq biquads. This leaves the output PEQ untouched. Set
`use_xo` to one of the following values to activate this mode:

* all : apply beq to both crossover groups
* 0 (or true) : apply beq to crossover group 0
* 1 : apply beq to crossover group 1

###### [SHD](https://www.minidsp.com/products/streaming-hd-series/shd)

set `device_type: SHD`

BEQ filters are written to all output channels.

###### [8x12 CDSP](https://www.minidsp.com/products/car-audio-dsp/c-dsp-8x12)

set `device_type: 8x12CDSP`

BEQ filters are written to all 6 input channels.

##### Custom Layouts

This is intended for advanced users only and requires a detailed understanding of the target device's capabilities and
configuration.

This option allows for bespoke mapping of beq filters to biquad slots. This requires the user to specify

* the capabilities of the device (channel counts, biquad slots per channel)
* the biquad slots the beq filters should be written to.

10 slots *must* be reserved for BEQ filters. These slots can be allocated via any combination of input, xo and output
but there must be exactly 10 slots allocated.

The main characteristics of the custom layout are defined in the `descriptor` section of the config. The descriptor is made up of the following keys:

* name: a name for the device, this is only used for display purposes in the UI
* fs: the sample rate at which the device is configured to operate, this is dictated the minidsp plugin.
* routes: must contain 3 entries (input, crossover, output)
* each entry in routes must contain the following keys:
  * name: must be input, crossover or output
  * biquads: the number of biquads per channel
  * channels: a list of channel indexes (0 based) that are part of this route 
  * slots: a list of slot indexes (0 based) that are allocated to beq filters in this route, these slots will be used in order so the first slot in the list will be used for BEQ filter 0, the second for BEQ filter 1 and so on.
  * groups: specified by the crossover route only, all known minidsp devices that support crossover filters have 2 groups.

Only the channels/biquads specified in the descriptor are addressable via the minidsp command loader screen in the UI. In practical terms, this means if a channel is not included in the BEQ config (e.g. you only write to 1 input channel), the command loader will not be able to address the missing channel(s).

Some example configurations are shown below.

* 2x4HD physical device with BEQ filters applied to the 1st input channel only.

```
accessLogging: false
debugLogging: true
devices:
  dsp1:
    cmdTimeout: 10
    exe: minidsp
    options: ''
    type: minidsp
    descriptor:
      name: 2x4
      fs: 96000
      routes:
      - name: input
        biquads: 10
        channels: [0]
        slots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      - name: crossover
        biquads: 4
        channels: [0, 1, 2, 3]
        slots: []
        groups: [0, 1]
      - name: output
        biquads: 10
        channels: [0, 1, 2, 3]
        slots: []
port: 8080
```

* 2x4HD physical device with the BEQ filters applied to the 1st 4 slots of both input channels and the 1st 6 slots of every output channel.

```
accessLogging: false
debugLogging: true
devices:
  dsp1:
    cmdTimeout: 10
    exe: minidsp
    options: ''
    type: minidsp
    descriptor:
      name: 2x4
      fs: 96000
      routes:
      - name: input
        biquads: 10
        channels: [0]
        slots: [0, 1, 2, 3]
      - name: crossover
        biquads: 4
        channels: [0, 1, 2, 3]
        slots: []
        groups: [0, 1]
      - name: output
        biquads: 10
        channels: [0, 1, 2, 3]
        slots: [0, 1, 2, 3, 4, 5]
port: 8080
```

#### Monolith HTP1

```
  htp1:
    ip: 192.168.1.181
    channels:
    - sub1
    autoclear: true
```

BEQ filters are loaded into the bottom 10 slots of the specified channels only.

* ip: ip address of the HTP1
* channels: list of channels to apply filters to (sub1, sub2 and sub3 are the standard subwoofer channels in the HTP1)
* autoclear: if set to true, BEQ filters will be reset on power state or input change

#### StormAudio

StormAudio ISP processors are supported via the processor Web UI MSO import endpoint.

Requires StormAudio firmware 4.7r2 or newer.

```
  storm:
    ip: 192.0.2.10
    profileName: ezBEQ
    subCount: 1
    timeout: 30
    ratio:
      default:
        gain: 1.0
        q: 1.0
      byType:
        PeakingEQ:
          gain: 1.0
          q: 1.0
        LowShelf:
          gain: 1.0
          q: 1.0
        HighShelf:
          gain: 1.0
          q: 1.0
    type: stormaudio
```

* ip: ip address of the StormAudio processor. Use `url` instead when the endpoint is not at `http://<ip>/mso.php`.
* profileName: name for the profile created by the MSO import.
* subCount: number of subwoofer blocks to include in the import payload. The same BEQ filters are written to each block.
* timeout: request timeout in seconds.
* ratio: optional per-filter type multipliers applied before sending filters to StormAudio. `PeakingEQ` maps to
  `Bell`, `LowShelf` maps to `Low Shelf`, and `HighShelf` maps to `High Shelf`.

Loading a filter creates a StormAudio profile from the current processor state. ezbeq does not activate or delete
StormAudio profiles; clearing the ezbeq slot only clears ezbeq's local state.

#### JRiver Media Center

Media Network must be enabled

```
  jriver:
    address: 192.168.1.181:52199
    auth:
      user: foo
      pass: thisismypass
    secure: true  
    channels:
    - SW
    - C9
    - C10
    block: 2
```

* address: the ip and port on which the Media Center media network is listening
* auth is optional, leave this out if MCWS is not secured
* secure is optional, leave this out if SSL is not used
* supported channels are L R C SW SL SR RL RR and C9 upto C32 (if more than 8 channel output is used)
* block is 1 or 2 and refers to the dsp slots Parametric Equalizer and Parametric Equalizer 2 respectively

This information is **not** validated, it is left to the user to configure the output format on the zone to match the
supplied configuration.

#### Q-Sys

[Q-Sys Designer](https://www.qsc.com/resources/software-and-firmware/q-sys-designer-software/) is supported via
the [QRC](https://q-syshelp.qsc.com/Content/External_Control_APIs/QRC/QRC_Overview.htm) protocol

```
  qsys:
    ip: 192.168.1.181
    port: 1710
    timeout_secs: 2
    components: 
    - beq
    content_info:
    - beq_movie_info:
        text.1: title
        text.2: genres
        text.3: audio_types
        text.4: mv_adjust
        text.5: overview
        text.6: images[0]
        text.7: images[1]
    type: qsys
```

Configuration of the audio pipeline in Q-Sys Designer is left as an exercise for the user.

2 alternative implementations are possible.

One uses a [IIR Custom Filter](https://q-syshelp.qsc.com/Index.htm#Schematic_Library/filter_IIR.htm) component which
must be connected to component which provides a text field.

This can be implemented using either
a [Text Controller](https://q-syshelp.qsc.com/Index.htm#Schematic_Library/device_controller_script.htm?TocPath=Design%257CSchematic%2520Elements%257CComponents%257CScripting%2520Components%257C_____3)
or a [Custom Control](https://q-syshelp.qsc.com/Index.htm#Schematic_Library/custom_controls.htm).

This component allows for a mapping of a text field control key to a `CatalogueEntry` field name.

Two fields have special treatment:

* filters: will be set in a format that can be linked to a IIR Custom Filter and feeds it with the required biquad
  coefficients.
* images: there can be a variable number of images so each individual image can be specified in a separate field

The alternative approach uses
a [Parametric Equaliser](https://q-syshelp.qsc.com/Content/Schematic_Library/equalizer_parametric.htm) component which
should be configured with:

* at least 10 bands
* q factor

The component name should be supplied in the configuration above.

Note that this format does not support variable Q shelf filters.

#### CamillaDSP

[CamillaDSP v3](https://github.com/HEnquist/camilladsp) is supported via
its [websocket](https://github.com/HEnquist/camilladsp/blob/master/websocket.md) api which means CamillaDSP must be
started with additional options:

* `-p` to specify the port
* `-a` to specify the listen address (required if ezbeq runs on a different host to camilladsp)

```
  camilla:
    ip: 192.168.1.181
    port: 1710
    timeout_secs: 2
    channels: 
    - 4
    - 7
    type: camilladsp
```

* ip: the ip on which camilladsp is listening
* port: the port on which camilladsp is listening
* channels: a list of channel numbers to which BEQ filters will be appended

On load, the camilladsp configuration will be updated as follows:

* each filter will be added to the `Filters` section in [IIR](https://github.com/HEnquist/camilladsp#iir) format using
  one of the Peaking, HighShelf or LowShelf filter types. Filter names will be BEQ_0 to BEQ_9, the number corresponds to
  the filter index in the loaded BEQ filter. If a filter with the same name already exists, it will be overwritten with
  the new settings. This means that if you load a different BEQ filter, the existing filters will be updated rather than
  new filters being added.
* each filter will be appended to the [Pipeline](https://github.com/HEnquist/camilladsp#pipeline) for the specified
  channel, an entry of type `Filter` will be added if not already present for that channel

Note that if the named filter (BEQ_0 for example) is already present in the camilladsp configuration, only the filter
parameters will be updated on load or remove.
i.e. this enables the user to define where to put the filters in the pipeline rather than always appending to the end of
the pipeline.

On unload, the camilladsp configuration will be updated as follows:

* the filters will reset to 0 gain filters in the `Filters` section

User controlled master volume adjustments are supported using
the [Volume](https://github.com/HEnquist/camilladsp/blob/master/README.md#volume) filter if that filter has been
configured in the pipeline.

BEQ specific input gain adjustments are supported via the use of a [Gain](https://github.com/HEnquist/camilladsp#gain)
filter which is inserted into the pipeline ahead of the BEQ filters themselves.

#### Composite Devices

`minidsp-rs`'s own `--all-local-devices` option lets its CLI treat 2 locally attached miniDSPs as one target, but that's
as far as it goes - it can't add a 3rd device, and it can't mix in a different device type at all. A composite device
covers both of those cases: it's a named device, just like any other entry under `devices`, that fans a single command
(load a filter, activate a slot, mute, set gain, ...) out to N other devices already defined in your config.

Every "slot" mentioned below is a whole-device configuration/preset slot - the same numbered (or, per
[Naming Slots](#naming-slots), named) slot a device activates and loads a full BEQ profile into, and that appears as
a row in the UI's Slots panel. It is unrelated to the per-channel biquad slot indexes from
[Custom Layouts](#custom-layouts) - those live entirely inside a single loaded filter set and a composite has no
visibility into them.

There are two modes:

* `mirror` - the easy case. All members must be the **same** device `type` (e.g. 3 minidsps forming a sub array) and
  every command is forwarded to each of them unchanged, in parallel. No per-member config is needed.
* `mapped` - the general case, for members that don't already share identical slot/channel numbering - whether
  that's because they're different device `type`s entirely, or because they're the same `type` (e.g. two different
  minidsp models) but wired up or configured differently. One member must be nominated as `primary` - its own state
  (slots, mute, master volume) is what's shown for the composite in the UI.

Two things are handled automatically, for every member, without any config: a member is skipped for any operation
its device type structurally can't do (e.g. nothing except minidsp implements `set_gain`, so a mapped composite
never needs to be told that), and a member with only one real slot (every device type except minidsp and jriver -
see [Naming Slots](#naming-slots)) is always routed straight to that slot, since there's only one it could mean.
`slotMap`/`skipOps` (below) only need to be set explicitly for what's left: translating between two *genuinely*
multi-slot members, or deliberately excluding a member from an op it's otherwise capable of.

```
  sub1:
    type: minidsp
    exe: minidsp
    options: '--tcp 127.0.0.1:5333'
  sub2:
    type: minidsp
    exe: minidsp
    options: '--tcp 127.0.0.1:5334'
  sub3:
    type: minidsp
    exe: minidsp
    options: '--tcp 127.0.0.1:5335'
  bass_array:
    type: composite
    mode: mirror
    members: [sub1, sub2, sub3]

  rear_sub:
    type: minidsp
    exe: minidsp
    options: '--tcp 127.0.0.1:5336'
  side_sub:
    type: minidsp
    exe: minidsp
    options: '--tcp 127.0.0.1:5337'
    device_type: 4x10
  rear_subs:
    type: composite
    mode: mapped
    primary: rear_sub
    exposeMembers: true
    allowPartialGain: true
    members:
      rear_sub: {}
      side_sub:
        slotMap: {'1': '3', '2': '4'}
        skipOps: [set_gain]
```

Every minidsp, regardless of model, exposes exactly 4 configuration slots (`1`-`4`, or their `slotNames` equivalents)
- `slotMap` never invents slots that aren't there, it only relabels the ones the device already has. `rear_sub` is a
2x4HD dedicated to this one sub, so slots `1`/`2` are free for whatever the composite loads into them. `side_sub` is
a 4x10 that also serves other channels in the same rack, and slots `1`/`2` on that unit are already committed to
unrelated presets for those channels - so the two BEQ profiles this composite manages live in its slots `3`/`4`
instead, and `slotMap` maps the composite's `1`/`2` onto the device's `3`/`4`. Its gain trim is also fixed by an
external amp, so `skipOps: [set_gain]` excludes it deliberately even though a 4x10 can otherwise do `set_gain` fine
- which is exactly the case `allowPartialGain` exists for, see below.

* `mode`: `mirror` or `mapped`, as above
* `members`: a list of device names for `mirror` mode, or a map of device name to per-member overrides for `mapped`
  mode (an empty map `{}` means "no overrides needed")
* `primary`: (`mapped` mode only, required) the member whose own state is shown for the composite
* `exposeMembers`: defaults to `false` - once a device is a member of a composite it's hidden from the device
  selector, since the whole point is to stop having to juggle it individually. Set to `true` to keep the member
  individually selectable/controllable alongside the composite.
* `allowPartialGain`: (`mapped` mode only, defaults to `false`) required whenever `set_gain`/`mute`/`unmute` would
  end up applying to some members but not others - see below.
* per-member overrides (`mapped` mode, all optional):
  * `slotMap` translates slot ids between the composite and that member, e.g. `{'1': '3', '2': '4'}` means "when
    the composite is told to use slot `1`, tell this member to use its own slot `3`". Only meaningful for a member
    with more than one real slot - a single-slot member is always routed to its one slot automatically, so any
    `slotMap` configured for one is ignored. For the `primary` member the map is also applied in reverse, so the UI
    shows the composite's slot ids rather than the primary's own.
  * `channelMap` does the same translation for channel numbers - used both by `mute`/`unmute`/
    `set_gain`'s single channel, and by the raw input/output channel lists behind the "Custom
    Layouts" advanced editor (`load_biquads`/`send_commands`). The latter matters for a mapped
    composite spanning two different minidsp models (e.g. a 2x4HD and a 4x10): their hardware
    channel numbering isn't the same, so a raw channel index meaningful on one member needs
    translating before it's sent to the other, or it applies to the wrong channel (or fails).
  * `skipOps` additionally excludes a member from operation names - `activate`, `load_filter`, `load_biquads`,
    `send_commands`, `clear_filter`, `mute`, `unmute`, `set_gain` - that it's technically capable of but shouldn't
    receive for this composite (e.g. a fixed-gain amp stage, as `side_sub` above). Ops the member's device type
    can't do at all are already excluded automatically and never need listing here.
  * `mvAdjust` is a per-member gain trim applied on filter load: this member receives `entry.mv_adjust + mvAdjust`
    while every other member still receives the catalogue entry's own unmodified `mv_adjust`. Use it when one member
    needs a few dB more or less than the rest of the composite.

**`allowPartialGain`**: if a mapped composite's members disagree on `set_gain`/`mute`/`unmute` support - whether
because one member's device type structurally can't do it, or because a member that can was explicitly excluded via
`skipOps` - applying that op would silently affect some members but not others, skewing the array's inter-channel
balance without any error to signal it. ezbeq refuses to start in that situation unless `allowPartialGain: true`
acknowledges it explicitly; the startup error names exactly which members disagree and on which op. `rear_subs`
above needs it because `side_sub` opts out of `set_gain` while `rear_sub` doesn't. This never comes up in `mirror`
mode, since mirror mode already requires every member to share one device `type` (so support is always uniform).

A command is applied to every reachable member even if another one fails (e.g. one sub in an array is offline) - the
composite reports an error naming which member(s) failed, but doesn't undo what succeeded on the others. A composite
cannot contain another composite, and a device can only belong to one composite. See
[ezbeq_composite.yml](examples/ezbeq_composite.yml) for a complete example.

##### Worked example

Take the `rear_subs` composite above and add a `channelMap` and `mvAdjust` to `side_sub` so all four overrides are in
play - say `side_sub`'s output for this sub is wired to its own channel `3` (rather than channel `1`, which the
composite uses as its canonical channel id), and that channel runs 1.5dB hot relative to the rest of the array:

```
  rear_subs:
    type: composite
    mode: mapped
    primary: rear_sub
    exposeMembers: true
    allowPartialGain: true
    members:
      rear_sub: {}
      side_sub:
        slotMap: {'1': '3', '2': '4'}
        channelMap: {'1': '3'}
        skipOps: [set_gain]
        mvAdjust: -1.5
```

* **Loading a filter** - the UI loads a catalogue entry with its own `mv_adjust` of `2.0` into composite slot `1`
  (`rear_subs.load_filter('1', entry)`):
  * `rear_sub` has no overrides, so it loads its own slot `1` at the entry's `mv_adjust` unchanged: `2.0`.
  * `side_sub`'s `slotMap` turns composite slot `1` into its own slot `3`, so it loads slot `3`; `mvAdjust`
    (`-1.5`) is added on top of the entry's `mv_adjust`, so `side_sub` loads at `2.0 + -1.5 = 0.5`.
* **Setting gain** - the UI sets composite slot `1`, channel `1` to `-3dB`
  (`rear_subs.set_gain('1', 1, -3.0)`):
  * `rear_sub` sets its own slot `1`, channel `1` to `-3dB` (no translation needed).
  * `side_sub` never receives this command at all - `set_gain` is in its `skipOps`, so it's left out of the fan-out
    entirely (its gain is fixed at the amp, not remote-controllable).
* **Muting** - the UI mutes composite slot `1`, channel `1` (`rear_subs.mute('1', 1)`):
  * `rear_sub` mutes its own slot `1`, channel `1`.
  * `side_sub`'s `slotMap` and `channelMap` both apply: it mutes its own slot `3`, channel `3`.
* **What the UI shows** - `rear_subs`'s displayed state is `rear_sub`'s state verbatim, since `rear_sub` is
  `primary` and has no `slotMap` to invert. If `side_sub` were `primary` instead, its slot `3` would be shown to the
  user as slot `1` - the reverse of its own `slotMap` - so the UI always speaks in composite-level ids no matter
  which member is primary.

Note `allowPartialGain: true` is only needed here because of `set_gain` - both members are minidsp and neither opts
out of `mute`/`unmute`, so muting always applies uniformly to both regardless of the flag.

## Starting ezbeq on bootup

This is optional but recommended, it ensures the app starts automatically whenever the rpi boots up and makes
sure it restarts automatically if it ever crashes.

We will achieve this by creating and enabling a `systemd` service.

1) Create a file ezbeq.service in the appropriate location for your distro (e.g. ``/etc/systemd/system/`` for debian)::

```
[Unit]
Description=ezbeq
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/youruser
ExecStart=/home/youruser/your_venv_name/ezbeq/bin/ezbeq
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
```

ensure the paths are updated for your user/system setup.

2) enable the service and start it up::

```
$ sudo systemctl enable ezbeq.service
$ sudo service ezbeq start
$ sudo journalctl -u ezbeq.service
-- Logs begin at Sat 2019-08-17 12:17:02 BST, end at Sun 2019-08-18 21:58:43 BST. --
Aug 18 21:58:36 swoop systemd[1]: Started ezbeq.
```

3) reboot and repeat step 2 to verify the recorder has automatically started

## Verifying MiniDSP Response

As noted in
the [setup guide](https://ezbeq.readthedocs.io/en/latest/#suggested-interaction-of-ezbeq-and-official-minidsp-plugin),
minidsp devices do not provide any mechanism to read the currently loaded DSP configuration. This means it is impossible
to see exactly how the DSP is configured, it's only possible to measure the resulting response.

From an ezbeq perspective, there are 2 ways to do this

### Quick & Crude

* Clear filters
* Open the levels tab
* Start playback of a scene that is known to have content boosted by the beq filter (use
  the [beqcatalogue](https://beqcatalogue.readthedocs.io/) heatmap to find one)
* Make note of the displayed levels
* Load the filter
* Restart playback of the same scene
* Compare the reported levels

The measured output level should be increased with the filter in place.

### Slower but Accurate

* Clear filters
* Switch to USB input
* Connect the minidsp dsp to a PC running [REW](https://www.roomeqwizard.com/), configure REW to use the minidsp as both
  input and output device
* Measure a full bandwidth (2-20000 Hz) sweep (call this A)
* Load a filter (switch connection to the ezbeq host if necessary)
* Measure a full bandwidth (2-20000 Hz) sweep (call this B)
* Use the [trace arithmetic](https://www.roomeqwizard.com/betahelp/help_en-GB/html/arithmetic.html) `A / B` function (
  call the result C), the result should look like the inverse of the BEQ filter (i.e. it will go into negative values,
  it shows the supposed rolloff in the original source that is to be corrected by the BEQ filter)
* With C selected, open the EQ window, select your minidsp device as the dsp type and manually input the individual
  filters in the loaded BEQ
* The predicted response should now be a flat line (i.e. the beq filter has "corrected" this back to flat)
