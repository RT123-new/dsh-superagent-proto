# Actual-component UI preview

This harness mounts `src/client/app.tsx` and its real component tree and stylesheet. It supplies disposable representative data through the production management API shapes. It is not a reimplemented visual mockup and is not an installed DSH host.

The top preview strip identifies sample data and provides theme, language and reset controls. Navigation, search, filters, confirmations and supported fixture edits operate locally. Opening a host Session, an external provider conversation, compiling prompts or checking real connections displays an explicit preview limitation instead of contacting a provider. Nothing in this preview sends a message, runs a model, mutates a repository or changes a live system.

## Rebuild

From the repository root with committed dependencies installed:

```bash
pnpm exec vitest run --config scripts/ui-preview/vitest.config.ts
node scripts/ui-preview/build.mjs /absolute/path/to/application-checkout /absolute/path/to/output
```

The first command exports the existing typed panel-test server's responses to `fixtures.json`, with deterministic sample tickets, threads and synthetic metrics. The second builds a self-contained `superagent-workspace.html` using the chosen checkout's actual application source and CSS. Vite is obtained through the existing Vitest dependency; no production dependency or package manifest changes are required.

For before/after comparison, build the baseline from immutable commit `f68f117343758c9e3c94bab30f0a5a0feedb0305`, then build the redesign with the same `fixtures.json`. Serve both output directories with an ordinary local HTTP server. Query parameters `theme=light|dark`, `lang=en|zh`, and `reset=1` set the preview state. Fonts and theme variables are supplied by `preview.css` as an explicit approximation of the DSH host shell; the application stylesheet itself is not replaced.

The generated HTML embeds all JavaScript, fixture data and CSS. The large bundle is intentional for a portable review artifact and does not measure or alter the production bundle's loading strategy.

## Validation boundaries

- Preview measurements and work items are synthetic. Do not interpret them as operational results or cost/speed evidence.
- The fixture adapter emulates the management contract; it is not evidence that live endpoints or server effects work.
- Browser screenshots of this harness show actual frontend code, but not installation into a complete DSH host.
- Host appearance, Session navigation, configuration forms, authentication and provider connectivity require an installed-host check.
- Baseline and redesign captures must use the same fixture, viewport, theme, language and route. Changing fixture content requires recapturing both.

The separate inspection wrapper in the verification output uses a real iframe with a selected 1440×1000, 390×844 or 768×1024 viewport. It does not scale the interface with CSS; it exists only for browser QA and is not part of the product.
