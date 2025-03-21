# ezbeq

A simple web browser for [beqcatalogue](https://beqcatalogue.readthedocs.io/en/latest/) which integrates with [minidsp-rs](https://github.com/mrene/minidsp-rs)
for local remote control of a minidsp or HTP-1.

# Setup

## Windows / MacOS

Python is required so use an appropriate package manager to install it. 

[chocolatey](https://chocolatey.org/) is a convenient choice for Windows
[homebrew](https://docs.brew.sh/Installation) is the equivalent for MacOS

## Linux

Use your distro package manager to install python.

## Installation

Example is provided for rpi users

    $ ssh pi@myrpi
    $ sudo apt install python3 python3-venv python3-pip libyaml-dev
    $ mkdir python
    $ cd python
    $ python3 -m venv ezbeq
    $ cd ezbeq
    $ . bin/activate
    $ pip install ezbeq

### Example Config Files

See [examples](examples)

| Type                        | File                                                                                                                                                                       |
|-----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Camilla DSP                 | [for CamillaDSP v2](examples/ezbeq_camilladsp2.yml), [for CamillaDSP v3](examples/ezbeq_camilladsp2.yml)                                                                   |
| J River Media Center        | [ezbeq_mc.yml](examples/ezbeq_mc.yml)                                                                                                                                      |
| Minidsp 2x4HD               | [ezbeq_md.yml](examples/ezbeq_md.yml), [using multiple devices](examples/ezbeq_md2.yml) or [with custom slot names](examples/ezbeq_named.yml)                              |
| Minidsp 4x10                | [ezbeq_4x10.yml](examples/ezbeq_4x10.yml)                                                                                                                                  |
| Minidsp 10x10               | [without use of XO](examples/ezbeq_10x10.yml), [with](examples/ezbeq_10x10_xo.yml) or [using a custom mapping across input, output and xo](examples/ezbeq_10x10_custom.yml) |
| Minidsp DDRC-24             | [ezbeq_ddrc24.yml](examples/ezbeq_ddrc24.yml)                                                                                                                              |
| Minidsp DDRC-88             | [ezbeq_ddrc88.yml](examples/ezbeq_ddrc88.yml)                                                                                                                              |
| Minidsp HTx                 | [ezbeq_htx.yml](examples/ezbeq_htx.yml)                                                                                                                                    |
| Minidsp SHD                 | [ezbeq_shd.yml](examples/ezbeq_shd.yml)                                                                                                                                    |
| Monolith HTP-1              | [ezbeq_htp1.yml](examples/ezbeq_htp1.yml)                                                                                                                                  |
| Q-Sys                       | [ezbeq_qsys.yml](examples/ezbeq_qsys.yml)                                                                                                                                  |
| Multiple, different devices | [ezbeq_multi.yml](examples/ezbeq_multi.yml)                                                                                                                                |

### Using with a Minidsp

Install minidsp-rs as per the [provided instructions](https://github.com/mrene/minidsp-rs#installation)

### Using with a Monolith HTP-1

See the configuration section below

## Upgrade

    $ ssh pi@myrpi
    $ cd python/ezbeq
    $ . bin/activate
    $ pip install --upgrade --force-reinstall ezbeq

then restart the app

## Running the app manually

    $ ssh pi@myrpi
    $ cd python/ezbeq
    $ . bin/activate
    $ ./bin/ezbeq
      Loading config from /home/pi/.ezbeq/ezbeq.yml
      2021-01-16 08:43:15,374 - twisted - INFO - __init__ - Serving ui from /home/pi/python/ezbeq/lib/python3.8/site-packages/ezbeq/ui

Now open http://youripaddress:8080/index.html in your browser 

## Configuration

See `$HOME/.ezbeq/ezbeq.yml`

The only intended option for override is the port option which sets the port the UI and API is accessible on. This defaults to 8080.

### Using a custom catalogue

If `catalogueUrl` is added to the configuration, e.g.

    catalogueUrl: http://localhost:9999

ezbeq will instead load the catalogue from `http://localhost:9999/database.json`

This provides the ability to run ezbeq against a custom, or locally provided, catalogue.

### Configuring Devices

The devices section contains a list of supported device, the format varies by the type of device and each item is a named device with the name subsequently appearing the UI (if multiple devices are listed)

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
* slotChangeDelay: if true, the command to change the slot is always sent to minidsp-rs as a separate command. If a positive integer or float, it represents an additional delay (in seconds) that will separate each command.

By default, it is assumed the Minidsp 2x4HD is in use. To use a different model, specify via the device_type option. For example:

```
  minidsp:
    cmdTimeout: 10
    exe: minidsp
    ignoreRetcode: false
    options: ''
    type: minidsp
    device_type: 4x10
```

In order for the ezbeq ui to update when the device status is updated outside of ezbeq (e.g. using minidsp remote control), additional configuration is required to enable the [minidsp rs websocket interface](https://minidsp-rs.pages.dev/daemon/http#websocket-streaming)

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

Using, and controlling, multiple devices independently is supported but does require use of the `options` key in order to direct commands to the right device. Precise configuration of this option depends on the minidsp-rs setup so is out of scope of this readme. Typical configuration would involve use of the `--tcp` option combined with changes to `minidsp.toml` as mentioned in the [minidsp-rs docs](https://minidsp-rs.pages.dev/daemon/tcp#multiple-devices). 

For reference, a community provided example configuration guide can be found via [avs](https://www.avsforum.com/threads/ezbeq-use-and-development-discussion.3181732/page-170#post-62257128)

##### Naming Slots

By default, the slots are numbered 1-4 as per the minidsp console. 

To override, extend the device configuration with the `slotNames` key as illustrated in [this example](examples/ezbeq_named.yml). It is not necessary to list every slot, just those that require an explicit name.

##### Minidsp Variants

Device support largely tracks [minidsp-rs device support](https://minidsp-rs.pages.dev/devices).

BEQ MV adjustments are applied to input peq channels only.

###### [2x4HD](https://www.minidsp.com/products/minidsp-in-a-box/minidsp-2x4-hd)

set `device_type: 24HD`

BEQ filters are written to both input channels.

##### [Flex](https://www.minidsp.com/products/minidsp-in-a-box/flex)

configure as per 2x4HD 

add `slotChangeDelay: true` to workaround issues with slow slot changing. If it remains unstable, use `slotChangeDelay: 1.5` (or some other number, experiment to find the smallest value that enables a reliable experience).

Dirac mode (PEQ on output) is only supported at present via a custom configuration. 

###### [DDRC-24](https://www.minidsp.com/products/dirac-series/ddrc-24)

set `device_type: DDRC24`

BEQ filters are written to all output channels.

###### [DDRC-88](https://www.minidsp.com/products/dirac-series/ddrc-88a)

set `device_type: DDRC88`

BEQ filters are written to output channel 3 by default.

Add the `sw_channels` config key to override this, provide a list of channel indexes (0 based) to which the filters should be written. For example to write to the last two output channels:

    device_type: DDRC88
    sw_channels:
    - 6
    - 7

###### [HTx](https://www.minidsp.com/products/ht-series/flex-htx)

requires [minidsp-rs 0.1.12](https://github.com/mrene/minidsp-rs/releases/tag/v0.1.12) or later 

set `device_type: HTx`

BEQ filters are written to output channel 3 by default.

Add the `sw_channels` config key to override this, provide a list of channel indexes (0 based) to which the filters should be written. For example to write to the last two output channels:

    device_type: DDRC88
    sw_channels:
    - 6
    - 7

###### [4x10](https://www.minidsp.com/products/plugins/4x10-plug-in-detail)

set `device_type: 4x10`

The limited biquad capacity (5 per channel) means that filters are split across input and output channels and there is no capacity for user filters.

###### [10x10](https://www.minidsp.com/products/plugins/4x10-10x10-plug-ins/10x10-plug-in-detail)

set `device_type: 10x10`

The limited biquad capacity (6 per channel) means that filters are split across input and output channels and the last 2 biquads per output channel are left under user control.

To avoid this, use the crossover biquads to hold the remaining beq biquads. This leaves the output PEQ untouched. Set `use_xo` to one of the following values to activate this mode:

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

TODO

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

This information is **not** validated, it is left to the user to configure the output format on the zone to match the supplied configuration.

#### Q-Sys

[Q-Sys Designer](https://www.qsc.com/resources/software-and-firmware/q-sys-designer-software/) is supported via the [QRC](https://q-syshelp.qsc.com/Content/External_Control_APIs/QRC/QRC_Overview.htm) protocol

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

One uses a [IIR Custom Filter](https://q-syshelp.qsc.com/Index.htm#Schematic_Library/filter_IIR.htm) component which must be connected to component which provides a text field.

This can be implemented using either a [Text Controller](https://q-syshelp.qsc.com/Index.htm#Schematic_Library/device_controller_script.htm?TocPath=Design%257CSchematic%2520Elements%257CComponents%257CScripting%2520Components%257C_____3) or a [Custom Control](https://q-syshelp.qsc.com/Index.htm#Schematic_Library/custom_controls.htm).

This component allows for a mapping of a text field control key to a `CatalogueEntry` field name.

Two fields have special treatment:

* filters: will be set in a format that can be linked to a IIR Custom Filter and feeds it with the required biquad coefficients.
* images: there can be a variable number of images so each individual image can be specified in a separate field

The alternative approache uses a [Parametric Equaliser](https://q-syshelp.qsc.com/Content/Schematic_Library/equalizer_parametric.htm) component which should be configured with:

* at least 10 bands
* q factor

The component name should be supplied in the configuration above.

Note that this format does not support variable Q shelf filters.

#### CamillaDSP

[CamillaDSP v3](https://github.com/HEnquist/camilladsp) is supported via its [websocket](https://github.com/HEnquist/camilladsp/blob/master/websocket.md) api which means CamillaDSP must be started with additional options:

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

* each filter will be added to the `Filters` section in [IIR](https://github.com/HEnquist/camilladsp#iir) format using one of the Peaking, HighShelf or LowShelf filter types. Filter names will be BEQ1 to BEQ10 
* each filter will be appended to the [Pipeline](https://github.com/HEnquist/camilladsp#pipeline) for the specified channel, an entry of type `Filter` will be added if not already present for that channel

On unload, the camilladsp configuration will be updated as follows:

* the filters will deleted from the `Filters` section
* the filters will be removed from the `Pipeline` section

User controlled master volume adjustments are supported using the [Volume](https://github.com/HEnquist/camilladsp/blob/master/README.md#volume) filter if that filter has been configured in the pipeline. 

BEQ specific input gain adjustments are supported via the use of a [Gain](https://github.com/HEnquist/camilladsp#gain) filter which is inserted into the pipeline ahead of the BEQ filters themselves. 

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
WorkingDirectory=/home/pi
ExecStart=/home/pi/python/ezbeq/bin/ezbeq
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
```

2) enable the service and start it up::

```
$ sudo systemctl enable ezbeq.service
$ sudo service ezbeq start
$ sudo journalctl -u ezbeq.service
-- Logs begin at Sat 2019-08-17 12:17:02 BST, end at Sun 2019-08-18 21:58:43 BST. --
Aug 18 21:58:36 swoop systemd[1]: Started ezbeq.
```

3) reboot and repeat step 2 to verify the recorder has automatically started



