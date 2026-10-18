const wpConfig = require( '@wordpress/scripts/config/jest-unit.config' );

module.exports = {
	...wpConfig,
	testMatch: [ '<rootDir>/tests/js/**/*.test.js' ],
	setupFilesAfterEnv: [
		...( wpConfig.setupFilesAfterEnv || [] ),
		'<rootDir>/tests/js/setup.js',
	],
};
