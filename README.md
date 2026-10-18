# Code samples — Muhammad Muzammil Qureshi

Two samples, each with its own README and tests.

| Folder | What it is | Stack |
|---|---|---|
| [`gutenberg-price-estimator/`](gutenberg-price-estimator/) | A custom Gutenberg block with sidebar settings, server rendering and a React front end. Includes how to deploy it to a WordPress site. | WordPress, PHP, React, `@wordpress/scripts` |
| [`enquiry-flow/`](enquiry-flow/) | A full vertical slice: API endpoint, React form and tests, covering authentication, validation, rate limiting and logging. | Laravel, React, TypeScript |

Start with the Gutenberg block; it runs and deploys on its own.

Also here: [`.github/workflows/`](.github/workflows/) (CI, release and a sample
deployment) and [`docs/ci-cd.md`](docs/ci-cd.md), which explains the pipeline.

## Verified status

| Check | Result |
|---|---|
| Block: Jest (40), PHPUnit (14), ESLint, stylelint, PHPCS, production build | Passing |
| Enquiry web: Vitest (23), `tsc --noEmit` | Passing |
| Enquiry API: PHPUnit feature tests (22) | Passing in the full application; cannot run from this folder |
| Block end-to-end in a real WordPress (5 Playwright tests, WordPress 7.1.3) | Passing |
