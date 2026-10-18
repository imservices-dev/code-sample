const { defineConfig } = require( '@playwright/test' );
const baseConfig = require( '@wordpress/scripts/config/playwright.config.js' );

// WordPress's own config (global setup that logs in once, wp-env web server,
// reporters), pointed at this project's tests.
module.exports = defineConfig( {
	...baseConfig,
	testDir: __dirname,
} );
