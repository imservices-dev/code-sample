# Price Estimator — a custom Gutenberg block

A WordPress block that lets a visitor estimate a subscription price. The editor
configures packages, add-ons, currency and a call-to-action link in the block
sidebar; the visitor picks a package, a billing model, a number of branches and
add-ons, and sees a live estimate.

It is a WordPress port of a calculator I wrote for a production marketing site
(React/Next.js, PKR/USD). The pricing rules are the same; the block generalises
them to one configurable currency and editor-defined packages.

## What it demonstrates

| Area | Where |
|---|---|
| Custom React block (`apiVersion` 3, `@wordpress/scripts`) | `src/index.js`, `src/edit.js`, `src/block.json` |
| Sidebar settings with core components (`InspectorControls`, `PanelBody`, `TextControl`) | `src/edit.js` |
| **Dynamic block** with server render and a no-JS fallback | `src/render.php` |
| Separate front-end bundle (`viewScript`), React mounted on saved config | `src/view.js` |
| Pricing rules as pure, tested functions | `src/calculate.js`, `tests/js/calculate.test.js` |
| Server-side sanitising of block attributes | `includes/class-config.php`, `tests/php/ConfigTest.php` |
| Accessibility: native radios/number inputs, fieldsets, live region, `:focus-visible` | `src/Estimator.js`, `src/style.scss` |
| Internationalisation with translator comments | `src/*.js`, `src/render.php` |
| Theme-friendly CSS: custom properties, logical properties, specificity 0,1,0 | `src/style.scss` |
| WordPress Coding Standards (PHPCS) and `@wordpress/eslint-plugin` | `.phpcs.xml.dist`, `npm run lint:js` |
| End-to-end tests in a real WordPress (Playwright, `wp-env`) | `tests/e2e/`, `.wp-env.json` |
| CI/CD: lint, test, build, release, deploy | `../.github/workflows/`, `../docs/ci-cd.md` |

## How the pricing works

- **Fixed monthly:** per-branch fee × branches.
- **Hybrid:** a lower per-branch fee, plus a percentage of total revenue.
- **Revenue-based:** a percentage of revenue, never below a per-branch minimum.
  The minimum applies branch by branch, not to the total.
- **Add-ons** are priced per branch per month under every model.
- **Annual billing** exists only for the fixed model, on a package that has an
  annual fee. Anywhere else it falls back to monthly.
- **Revenue-linked models need a revenue figure.** Without one the block asks for
  it instead of showing a misleading total.

## Design decisions worth knowing

- **Dynamic block (`save: () => null`).** Markup comes from `render.php`, so
  changing the markup later never invalidates saved posts and needs no block
  deprecation.
- **Attributes are input, not trusted data.** They live in post content, which can
  be edited by hand or imported. `Config::from_attributes()` sanitises strings,
  clamps numbers, bounds list sizes and rejects bad URL schemes before anything is
  printed. Output is still escaped at the point of printing (`esc_html`,
  `esc_attr( wp_json_encode() )`).
- **No nonces, and why.** The block reads no user data on the server and has no
  form handler, REST route or AJAX call, so there is no state-changing request to
  protect. If you add one (such as saving a quote), add a nonce and a
  capability check there.
- **Inputs keep what the visitor types.** The number inputs hold raw strings and
  clamp only for the maths, tidying the field on blur. A first version clamped on
  every keystroke, so clearing the field snapped it to `1` and you could not type
  a new number; a test caught it.
- **Works without JavaScript.** The server prints a list of packages and prices;
  `view.js` replaces it with the interactive estimator.
- **Performance.** The front-end bundle is about 6 KB and loads only on pages that
  contain the block (WordPress enqueues `viewScript` per block). There are no
  network requests and no layout-shifting content: the result area is always
  present.

## Visual design

- **Layout responds to the block's own width** (a CSS container query), so the
  two-column form and summary layout works in wide blocks and the editor, and
  stacks cleanly in narrow columns and on phones.
- **Choice cards, a switch and large inputs** replace plain form controls. The
  selected state has a shape (a filled ring) as well as a colour, inputs use 1rem
  text so iOS does not zoom, and the summary keeps a fixed height so it does not
  jump.
- **Contrast and motion:** body text and the summary panel meet 7:1, the accent
  meets 4.5:1 on white, transitions run only for visitors who have not asked for
  reduced motion, and Windows high-contrast mode has explicit rules.
- **Themeable:** colours, radius and the summary gradient are CSS custom
  properties (`--pe-accent`, `--pe-ink`, `--pe-surface`, `--pe-border`,
  `--pe-radius`, `--pe-summary-from`, `--pe-summary-to`). Set them on
  `.price-estimator` in your theme or Additional CSS to rebrand the block.

## Project layout

```
price-estimator.php        Plugin header; registers the block from build/
includes/class-config.php  Sanitises saved attributes for output
src/
  block.json               Block metadata, attribute schema and defaults
  index.js  edit.js        Editor entry and sidebar settings
  Estimator.js             Interactive UI, shared by editor preview and front end
  calculate.js             Pure pricing maths
  view.js                  Front-end entry; mounts the React app
  render.php               Server render and no-JS fallback
  style.scss  editor.scss  Styles
build/                     Compiled output (committed so the plugin installs without Node)
tests/js  tests/php        Jest and PHPUnit tests
```

## Develop

Requires Node 18+ and Composer (PHP 7.4+).

```bash
npm install
composer install
npm start              # watch and rebuild into build/
npm run build          # production build
npm test               # Jest: 40 tests (pricing rules + component behaviour)
npm run lint:js        # @wordpress/eslint-plugin
npm run lint:css       # stylelint
composer test          # PHPUnit: 14 tests (attribute sanitiser)
composer lint          # PHPCS with the WordPress ruleset
npm run test:e2e       # end-to-end, after npm run env:start
```

## How to test the block

There are four layers. Use the first two while developing, the third before a
release, and the fourth when you want to see it yourself.

| Layer | Command | What it proves | Needs |
|---|---|---|---|
| Unit and component | `npm test` (40 tests) | The pricing rules, and the UI behaviour in jsdom | Node |
| PHP unit | `composer test` (14 tests) | The attribute sanitiser rejects bad input | PHP, Composer |
| Static checks | `npm run lint:js`, `npm run lint:css`, `composer lint` | WordPress and accessibility lint rules, WordPress Coding Standards | Node, PHP |
| **End-to-end in real WordPress** | `npm run env:start` then `npm run test:e2e` (5 tests) | The block registers from `build/`, renders on the server, mounts on the front end, and hostile saved content is neutralised | Docker |

`npm run test:all` runs lint, unit tests and the build in one go. CI runs every
layer on each pull request (see [`../docs/ci-cd.md`](../docs/ci-cd.md)).

### Try it yourself (manual)

```bash
npm install
npm run build
npm run env:start        # WordPress at http://localhost:8888 (needs Docker)
```

Sign in at <http://localhost:8888/wp-admin> (username `admin`, password
`password`; these are `wp-env` defaults and exist only on your machine). Add a
page, insert **Price Estimator**, change settings in the sidebar, publish and view
it. Stop with `npm run env:stop`; `npm run env:destroy` resets everything.

Prefer not to use Docker? Install the plugin zip into a local WordPress such as
Local, or a staging site, using the steps under "Deploy" below.

### What the end-to-end tests check

1. The block is in the inserter and its preview works (editor).
2. On the published page the estimate recalculates, and a revenue-based model
   asks for revenue first, with no JavaScript errors.
3. The package list is in the **server HTML**, before any script runs.
4. With JavaScript disabled the page is still readable.
5. Hostile saved attributes (an `onerror` handler in the heading, a
   `javascript:` link, a `<script>` in the currency symbol) do not execute or
   render.

### What has and has not been verified

Run and passing: Jest, PHPUnit, ESLint, stylelint, PHPCS, the production build,
the five end-to-end tests against a real WordPress (7.1.3, PHP 8.2, started by
`wp-env`), and installing the built zip with WP-CLI. Not covered: older
WordPress versions, other browsers (the end-to-end suite runs Chromium only),
and caching or optimisation plugins that rewrite scripts.

## Deploy to a WordPress site

Requires WordPress 6.4+ and PHP 7.4+. `build/` is committed, so **the server does
not need Node.**

### Option A — upload the zip (simplest)

1. Build the package: `npm install && npm run plugin-zip`. This creates
   `price-estimator.zip`.
2. In the WordPress admin go to **Plugins → Add New → Upload Plugin**, choose the
   zip, click **Install Now**, then **Activate**.

### Option B — copy the folder (SFTP, rsync, or a deploy pipeline)

Copy `price-estimator.php`, `includes/`, `build/` and `readme.txt` into
`wp-content/plugins/price-estimator/`, then activate it under **Plugins**.

```bash
rsync -av --include='price-estimator.php' --include='readme.txt' \
  --include='includes/***' --include='build/***' --exclude='*' \
  ./ user@host:/path/to/wp-content/plugins/price-estimator/
```

### Option C — WP-CLI

```bash
wp plugin install /path/to/price-estimator.zip --activate
```

### Option D — Composer-managed sites

Add the repository to the site's `composer.json` as a `wordpress-plugin`
package (the included `composer.json` has the right `type`) and let your
deployment run `composer install`. Do not run `npm` on production; ship `build/`.

### Use the block

1. Edit a page or post and click **+** to add a block; search for
   **Price Estimator** (Widgets category).
2. Open the sidebar (**Settings**) to edit the heading, currency symbol, hybrid
   revenue share, button label and link, each package, and the add-ons.
3. Publish. Leave **Button link** empty to hide the button; set it to a contact or
   quote page to receive the visitor's choices as query parameters
   (`package`, `model`, `billing`, `branches`, `estimate`).

### Verify after deploying

1. The block appears in the inserter and the editor shows a working preview.
2. On the published page, changing the package or branches changes the estimate.
3. Choose **Revenue-based**: the block asks for revenue and shows no total until
   you enter one.
4. View the page source: you should see the package list inside the block's
   wrapper before JavaScript runs.
5. Browser console: no errors. Network tab: `view.js` loads only on pages that
   contain the block.
6. Disable JavaScript: the package list is still readable.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Block missing from the inserter | The plugin is not activated, or `build/` was not uploaded. `build/block.json` must exist. |
| Block shows nothing on the front end | Every package has an empty name, so `render.php` prints nothing by design. |
| Editor says the block "contains unexpected content" | This block stores no markup, so this points to a different block. Check the block name `codesample/price-estimator`. |
| Estimate never appears on a revenue model | Revenue is required; enter a number above 0. |
| Plain list never turns interactive | A script error or a caching or optimisation plugin removing `view.js`. Check the console and exclude the script from combining or delaying. |
| Strings are not translated | Add `.json` translation files under `languages/` (the plugin calls `wp_set_script_translations`). |

### Rolling back

Deactivate the plugin. Saved block comments stay in post content and render as
nothing until the plugin is active again; no data is lost.

## Changing the block's namespace

The block is named `codesample/price-estimator`. To use your own prefix, change
`name` in `src/block.json`, the string in `price-estimator.php`, rebuild, and
re-add the block on existing pages.
