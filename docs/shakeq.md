# ShakEQ

The `shakeq` device type loads BEQ catalogue filters into a ShakEQ tactile signal
processor through a separate ShakEQ HTTP connection service. The service manages
the USB-UART connection. This ezBEQ driver does not access serial ports or require
any of the service's Python modules.

## Requirements

- A running ShakEQ connection service, installed separately.
- A ShakEQ device configured in that service.
- The service's bearer-token file accessible to the ezBEQ process.

The service and ezBEQ can run on the same computer or on different computers.
The adapter does not install or start the service.

## Configuration

Add the device to `devices` in `ezbeq.yml`:

```yaml
devices:
  shakeq1:
    type: shakeq
    url: http://127.0.0.1:8081
    tokenFile: shakeq-service.token
    requestTimeout: 120
    stateTimeout: 2
```

The name, here `shakeq1`, must match the device name in the service. Add another
named entry for each additional processor. An example is provided in
[`examples/ezbeq_shakeq.yml`](https://github.com/3ll3d00d/ezbeq/blob/main/examples/ezbeq_shakeq.yml).

| Setting | Meaning |
| --- | --- |
| `url` | Required HTTP(S) origin of the service, without an API path, query or credentials. |
| `tokenFile` | Required path to the service's existing bearer-token file. Relative paths are resolved against the ezBEQ configuration directory; `~` is supported. |
| `requestTimeout` | Positive, finite timeout in seconds for load/clear requests; default `120`. |
| `stateTimeout` | Positive, finite timeout in seconds for state requests; default `2`. |

Do not copy a token into the URL. When the service is remote, copy its token to a
file accessible to ezBEQ and set `tokenFile` to that file. The file is read for
each HTTP request, so it may be created after ezBEQ starts or replaced without
restarting ezBEQ. A missing, unreadable or invalid file makes only this device
unavailable. If the service token changes, update its configured token file and
restart the service too; the service reads its token at startup. HTTPS requires a valid
certificate trusted by the Python runtime. HTTP redirects are not followed.

## Operations and state

The device has one always-active slot named `BEQ`. Use ezBEQ's existing load and
clear controls. `PeakingEQ` and `LowShelf` catalogue filters are supported;
unsupported, empty or invalid filter lists are rejected before a request is sent.
An empty filter list is not a clear command.

Volume, mute, raw biquads and raw device commands are not supported. Catalogue MV
adjustment is forwarded as metadata; this driver does not apply a listening-gain
change. Activating the fixed slot is a local no-op.

State is read from the connection service's memory, not from firmware. `sent`
means the service confirmed its last operation; `unknown` means there is no
confirmed current state. `serviceOnline` reports whether the service state could
be reached; an invalid response still leaves BEQ status `unknown`. This is not verification of the hardware's mute, bypass or current
filter coefficients. A cached title can remain visible while the service is
unavailable, with status `unknown`.

The driver reuses the snapshot returned by load/clear. State snapshots and failed
state checks have a two-second cache/backoff, including repository list polls
that use `refresh=True`. An unchanged refresh does not write the cache file or
broadcast another WebSocket event. External console changes may take up to two
seconds to appear. GET `/state` must return the latest published snapshot without
waiting for an in-progress UART transfer.

If the service returns HTTP 423 because a console operation reserves the device,
the driver preserves the previous BEQ state and raises an existing ezBEQ error.
The v3 PATCH path reports an invalid request; the existing v1 filter path can
report a server error. A 423 on a state read is handled locally and does not
remove the device from the list. Authentication/routing rejections preserve the
previous BEQ and mark the service reachable. A 400/422 preserves the previous BEQ
only when the response explicitly includes `applied: false`; legacy services
without that guarantee are treated as an unconfirmed result. No API error
handlers are changed. Load/clear failures and
timeouts are never replayed automatically because the hardware may already have
changed. Retry deliberately once the service/device is ready.

## Service contract

The driver uses only these authenticated endpoints:

- `GET /api/1/shakeq/<name>/state`
- `POST /api/1/shakeq/<name>/beq`

A POST contains either `{"action":"clear"}` or `{"action":"load","entry":...}`.
The entry contains `id`, `digest`, `title`, `author`, `formatted_title`, `filters`
and `mv_adjust` from the catalogue.

A successful response is a JSON object with `type: "shakeq"`, the matching
`name`, `status: "sent"` or `"unknown"`, and exactly one `slots` element with
`id: "BEQ"`. `beq` must be present as an entry object or `null`; `consoleBusy` is optional.
Load completion must report `status: "sent"` and both the requested BEQ `id`
and `digest`, including an empty digest verbatim; clear completion must
report `status: "sent"` and `beq: null`.

The ShakEQ browser console, UART handling and any playback automation belong to
separate applications. They add no routes or UI components to ezBEQ.

Responses are limited to **1 MiB of decoded JSON bytes**. The driver checks this
limit explicitly before decoding JSON, including for compressed responses.
Requests use the existing `requests` dependency with environment proxies disabled,
redirects disabled and no automatic retry. Failures are logged by `ezbeq.shakeq`.

The independent service must validate the request and all echoed metadata before
UART access. Rejected validation requests return 400 with `applied: false`.
Failures after hardware access begins return 503 with an unconfirmed result,
never a no-effect rejection. A 200 with invalid JSON/schema/entry identity is
also unconfirmed: the hardware may already have changed.
