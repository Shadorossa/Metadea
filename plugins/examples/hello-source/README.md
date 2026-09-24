# Hello Source (example plugin)

A minimal Metadea plugin used by the documentation (`docs/PLUGINS.md`) and by
the runtime tests (`frontend/src/lib/plugins/plugin-runtime.test.ts`). It is
not bundled with the app.

- `sources.hello`: four made-up works with chapters whose pages are generated
  SVG images. No network access: the manifest declares no hosts.
- `workActions.say-hello`: shows a toast with the `greeting` setting.
- `workPanels.hello-panel`: a card with a few rows read from `metadea.storage`.
- `events`: records `progress.changed` in `metadea.storage`.

To try it, zip the contents of this folder and install the zip from
Settings › Plugins › Install from file…
