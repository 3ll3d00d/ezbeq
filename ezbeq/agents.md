# Backend Conventions

## Tech Stack

- **Python 3.13+** required
- **Flask** + **Flask-RESTx** for REST API with automatic Swagger docs
- **Twisted** + **Autobahn** for async networking and WebSockets
- **PyYAML** for configuration
- **Poetry** for dependency management

## Development

```bash
poetry install          # Install Python dependencies
poetry run ezbeq        # Run the application (default port 8080)
```

## Coding Conventions

- Follow existing code style in each module
- Device integrations follow the abstract base class pattern in `device.py` — new devices should implement `Device`, `DeviceState`, and `SlotState`
- API versioning is used (v1, v2, v3) — add new endpoints to appropriate version
- WebSocket events use the pattern established in `apis/ws.py`
- Configuration is parsed in `config.py` — add new device config parsing there

## Tests

```bash
pytest                  # Run all tests
pytest --cov=ezbeq      # Run with coverage
```

- Fixtures defined in `tests/conftest.py`
- Test catalogue data at `tests/catalogue.json`
- Test configs at `tests/single.yaml`, `tests/multi.yaml`
- Use `pytest-httpserver` for mocking HTTP endpoints
- Mirror test structure from `test_minidsp_api.py` and `test_camilladsp_api.py` for new device integrations
