<?php
/**
 * PHPUnit bootstrap.
 *
 * These are unit tests for pure PHP logic, so WordPress is NOT loaded. The few
 * WordPress functions Config uses are replaced by small stand-ins below that
 * behave the same way for the inputs the tests use. They are not a substitute
 * for running the block inside WordPress; see the README for that check.
 */

define( 'ABSPATH', __DIR__ );

if ( ! function_exists( 'sanitize_text_field' ) ) {
	/**
	 * Stand-in: strip tags, collapse whitespace, trim.
	 *
	 * @param string $value Raw string.
	 * @return string
	 */
	function sanitize_text_field( $value ) {
		return trim( preg_replace( '/\s+/', ' ', strip_tags( (string) $value ) ) );
	}
}

if ( ! function_exists( 'sanitize_key' ) ) {
	/**
	 * Stand-in: lowercase letters, digits, dashes and underscores only.
	 *
	 * @param string $value Raw key.
	 * @return string
	 */
	function sanitize_key( $value ) {
		return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $value ) );
	}
}

if ( ! function_exists( 'esc_url_raw' ) ) {
	/**
	 * Stand-in: allow only http(s) and root-relative URLs.
	 *
	 * @param string $value Raw URL.
	 * @return string
	 */
	function esc_url_raw( $value ) {
		$value = trim( (string) $value );

		return preg_match( '#^(https?://|/)#i', $value ) ? $value : '';
	}
}

require_once dirname( __DIR__, 2 ) . '/includes/class-config.php';
