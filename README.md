# ezbeq

A simple web browser for [beqcatalogue](https://beqcatalogue.readthedocs.io/en/latest/) which integrates with [minidsp-rs](https://github.com/mrene/minidsp-rs)
for local remote control of a minidsp.

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

Install minidsp-rs as per the provided instructionshttps://github.com/mrene/minidsp-rs#installation

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

Options that are intended for override are:

* port: listens on port 8080 by default
* minidspExe : full path to the minidsp-rs app, defaults to minidsp so assumes the binary is already on your PATH
* minidspOptions : additional command line switches to pass to the minidsp binary

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
User=myuser
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
