/**
 * End-to-end tests: the real block in a real WordPress (started by wp-env).
 *
 * These cover what the unit tests cannot: that the block registers from
 * build/block.json, renders on the server, mounts on the front end, and that
 * hostile saved content is neutralised by the PHP sanitiser.
 */
const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const BLOCK = 'codesample/price-estimator';

/**
 * Publish a page whose content is the given block markup and return its URL.
 *
 * @param {Object} requestUtils WordPress REST helper from the fixtures.
 * @param {string} attributes   JSON attributes for the block ('{}' for defaults).
 * @return {Promise<string>} Permalink of the published page.
 */
async function publishPageWith( requestUtils, attributes = '{}' ) {
	const page = await requestUtils.createPage( {
		title: `Estimator ${ Date.now() }`,
		status: 'publish',
		content: `<!-- wp:${ BLOCK } ${ attributes } /-->`,
	} );

	return page.link;
}

test.describe( 'Price Estimator block', () => {
	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.deleteAllPages();
		await requestUtils.deleteAllPosts();
	} );

	test( 'is available in the inserter and shows a working preview', async ( {
		admin,
		editor,
		page,
	} ) => {
		// A post, not a page: new pages open a "Choose a pattern" modal, after a
		// delay, that blocks clicks and is unrelated to what is tested here.
		await admin.createNewPost( { postType: 'post' } );
		await editor.insertBlock( { name: BLOCK } );

		const block = editor.canvas.locator( `[data-type="${ BLOCK }"]` );
		await expect( block ).toBeVisible();
		await expect(
			block.getByRole( 'heading', { name: 'Estimate your price' } )
		).toBeVisible();

		// The preview is interactive: choosing a package changes the total.
		await block.getByRole( 'radio', { name: /growth/i } ).check();
		await expect( block.getByRole( 'status' ) ).toContainText(
			'$99 / month'
		);

		// The sidebar exposes the settings.
		await editor.openDocumentSettingsSidebar();
		await expect(
			page.getByText( 'Hybrid revenue share (%)' )
		).toBeVisible();
	} );

	test( 'renders on the front end and recalculates', async ( {
		page,
		requestUtils,
	} ) => {
		const errors = [];
		page.on( 'pageerror', ( error ) => errors.push( error.message ) );

		await page.goto( await publishPageWith( requestUtils ) );

		const result = page.getByRole( 'status' );
		await expect( result ).toContainText( '$49 / month' );

		await page.getByLabel( 'Branches' ).fill( '3' );
		await expect( result ).toContainText( '$147 / month' );

		await page.getByRole( 'radio', { name: /revenue-based/i } ).check();
		await expect( result ).toContainText(
			/enter your expected monthly revenue/i
		);

		await page.getByLabel( /expected monthly revenue/i ).fill( '30000' );
		await expect( result ).not.toContainText( /enter your expected/i );

		expect( errors ).toEqual( [] );
	} );

	test( 'prints the package list in the server HTML, before any JavaScript', async ( {
		page,
		requestUtils,
	} ) => {
		const url = await publishPageWith( requestUtils );
		const html = await ( await page.request.get( url ) ).text();

		expect( html ).toContain( 'data-price-estimator=' );
		expect( html ).toContain( 'Starter: from $49 per branch per month' );
	} );

	test( 'stays readable with JavaScript disabled', async ( {
		browser,
		requestUtils,
	} ) => {
		const url = await publishPageWith( requestUtils );
		const context = await browser.newContext( {
			javaScriptEnabled: false,
		} );
		const page = await context.newPage();

		await page.goto( url );
		await expect( page.getByText( 'Growth: from $99' ) ).toBeVisible();

		await context.close();
	} );

	test( 'neutralises hostile saved attributes', async ( {
		page,
		requestUtils,
	} ) => {
		const hostile = JSON.stringify( {
			heading: '<img src=x onerror="window.__xss=1">Prices',
			ctaUrl: 'javascript:window.__xss=2',
			ctaLabel: 'Go',
			currencySymbol: '"><script>window.__xss=3</script>',
		} );

		await page.goto( await publishPageWith( requestUtils, hostile ) );
		await expect( page.getByRole( 'status' ) ).toBeVisible();

		expect( await page.evaluate( () => window.__xss ) ).toBeUndefined();
		await expect( page.locator( 'a[href^="javascript:"]' ) ).toHaveCount(
			0
		);
		await expect( page.locator( '.price-estimator img' ) ).toHaveCount( 0 );
	} );
} );
