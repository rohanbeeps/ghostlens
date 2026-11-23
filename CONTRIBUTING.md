# Contributing to GHOSTLENS

## Development

Install Node.js 22.12+ or a newer supported LTS release. Run `npm ci` and `npm run dev` from the repository root. See the [README](README.md) for import and visualization guidance.

Keep HAR handling in `src/lib/`, render redacted data as text, and leave raw capture processing in the worker. When changing parsing or aggregation, cover the relevant input with a synthetic Vitest fixture. Model unavailable measurements with `null` and keep zero-valued measurements intact.

Run the release checks from the project root:

```sh
npm ci
npm test
npm run build
npm run build:offline
npx playwright install chromium firefox webkit
npm run test:browser
```

The browser tests serve the production build on port 4175 and open a copy of `GhostLens.html` from disk with network requests blocked. They cover Chromium with WebGL enabled and disabled, Firefox, and Playwright WebKit. The suite exercises narrow viewports, grouped nodes, filters, privacy, comparison, and export. Playwright touch emulation runs on Chromium and WebKit. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an installed Chromium binary. On Linux, `npx playwright install --with-deps chromium firefox webkit` also installs required system libraries. GitHub Actions runs the unit and build checks on Node 22 and 24 and the browser suite on Node 24.

## Benchmark large captures

After building the standard app and installing Chromium, run `npm run benchmark`. The script uses synthetic 1,000-, 10,000-, and 40,000-request captures and records median values over three runs in `work/benchmark/results.json`. Parse time measures the worker's parsing and aggregation. First-render time measures file selection through an observable graph and request count. Filter time measures entering a search through the updated request count. The last two include browser automation overhead. The benchmark uses the software renderer to keep runs comparable.

## Fixtures and reports

Use made-up hosts under reserved domains such as `.test`. The bundled `public/demo.har` is synthetic. Avoid attaching real HAR files to issues or pull requests. Include your browser version, steps to reproduce, and a minimal synthetic capture where relevant.

Describe the behavior your change addresses and the checks you ran. Screenshots are welcome for interface changes when all displayed data is synthetic.

## Beta release

Before tagging a public beta, confirm the GitHub CI checks are green, review the package with `npm audit`, and scan the staged source and release artifacts for secrets. Enable GitHub private vulnerability reporting in the repository security settings. Include the application and dependency notices when distributing `dist/`. Document the tested browsers and open limitations in the GitHub prerelease notes.

By contributing, you agree to license your contribution under the [MIT license](LICENSE).
