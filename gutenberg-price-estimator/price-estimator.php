<?php
/**
 * Plugin Name:       Price Estimator Block
 * Description:       A Gutenberg block that lets visitors estimate a subscription price from configurable packages, billing models and add-ons.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            Muhammad Muzammil Qureshi
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       price-estimator
 *
 * @package CodeSample\PriceEstimator
 */

namespace CodeSample\PriceEstimator;

// Direct access guard: this file must only run inside WordPress.
defined( 'ABSPATH' ) || exit;

// Also passed to the asset registration as the cache-busting version.
const VERSION = '1.0.0';

require_once __DIR__ . '/includes/class-config.php';

/**
 * Register the block from its compiled metadata.
 *
 * `build/block.json` is produced by `npm run build`; it points WordPress at the
 * compiled editor, view and style assets and at `render.php`.
 *
 * @return void
 */
function register_block() {
	$registered = register_block_type( __DIR__ . '/build' );

	if ( ! $registered ) {
		return;
	}

	// Load translations for the editor and front-end scripts.
	foreach ( array( 'editorScript', 'viewScript' ) as $field ) {
		$handle = generate_block_asset_handle( 'codesample/price-estimator', $field );
		wp_set_script_translations( $handle, 'price-estimator', plugin_dir_path( __FILE__ ) . 'languages' );
	}
}
add_action( 'init', __NAMESPACE__ . '\register_block' );
