# crawshrimp

## Development

```bash
# Python Core
cd core
pip install -r requirements.txt
python api_server.py
# Runs on http://localhost:18765

# Electron App (coming in Phase 2)
cd app
npm install
npm start
```

## Project Structure

```
crawshrimp/
  core/         Python FastAPI core
  app/          Electron + Vue 3 frontend (Phase 2)
  adapters/     Built-in adapter packages
  sdk/          Adapter development guide & schema
```

## Related

- [temu-assistant](https://github.com/howtimeschange/temu-assistant) - predecessor project
- [sdk/ADAPTER_GUIDE.md](sdk/ADAPTER_GUIDE.md) - how to build adapters
- [SPEC.md](SPEC.md) - full technical spec
