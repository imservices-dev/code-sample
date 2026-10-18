<?php
/**
 * Turns saved block attributes into a configuration that is safe to print.
 *
 * @package CodeSample\PriceEstimator
 */

namespace CodeSample\PriceEstimator;

defined( 'ABSPATH' ) || exit;

/**
 * Block attributes live in post content, which any editor can change and which
 * can be edited by hand in the code editor or imported from another site. They
 * are therefore input, not trusted data. Everything printed by render.php goes
 * through here first: strings are sanitised and length-capped, numbers are
 * coerced and clamped, and list sizes are bounded.
 *
 * Output is still escaped at the point of printing (late escaping); this class
 * limits what can reach that point, it does not replace the escape.
 */
final class Config {

	const MAX_PACKAGES = 8;
	const MAX_ADD_ONS  = 6;
	const MAX_AMOUNT   = 1000000000.0;

	/**
	 * Build the sanitised configuration shared by the server fallback and the
	 * front-end script.
	 *
	 * @param array $attributes Raw block attributes.
	 * @return array Sanitised configuration, keyed the way the JavaScript expects.
	 */
	public static function from_attributes( array $attributes ) {
		$packages = array();
		$raw      = isset( $attributes['packages'] ) && is_array( $attributes['packages'] ) ? $attributes['packages'] : array();

		foreach ( array_slice( $raw, 0, self::MAX_PACKAGES ) as $package ) {
			$package = self::as_array( $package );
			$name    = self::text( $package, 'name', 60 );

			// A package with no name cannot be chosen or described; drop it.
			if ( '' === $name ) {
				continue;
			}

			$packages[] = array(
				'name'        => $name,
				'monthlyFee'  => self::amount( $package, 'monthlyFee' ),
				'hybridFee'   => self::amount( $package, 'hybridFee' ),
				// Null means "annual billing is not offered", which is not the same as free.
				'annualFee'   => self::optional_amount( $package, 'annualFee' ),
				'revenueRate' => self::percent( $package, 'revenueRate' ),
				'revenueMin'  => self::amount( $package, 'revenueMin' ),
			);
		}

		$add_ons = array();
		$raw     = isset( $attributes['addOns'] ) && is_array( $attributes['addOns'] ) ? $attributes['addOns'] : array();

		foreach ( array_slice( $raw, 0, self::MAX_ADD_ONS ) as $index => $add_on ) {
			$add_on = self::as_array( $add_on );
			$label  = self::text( $add_on, 'label', 60 );

			if ( '' === $label ) {
				continue;
			}

			$id = isset( $add_on['id'] ) && is_string( $add_on['id'] ) ? sanitize_key( $add_on['id'] ) : '';

			$add_ons[] = array(
				// The id keys the visitor's quantities; it must exist and be unique-ish.
				'id'    => '' !== $id ? $id : 'addon-' . (int) $index,
				'label' => $label,
				'price' => self::amount( $add_on, 'price' ),
				'max'   => max( 1, min( 99, (int) ( $add_on['max'] ?? 10 ) ) ),
			);
		}

		return array(
			'heading'        => self::text( $attributes, 'heading', 120 ),
			'disclaimer'     => self::text( $attributes, 'disclaimer', 240 ),
			'currencySymbol' => self::text( $attributes, 'currencySymbol', 4 ),
			'hybridRate'     => self::percent( $attributes, 'hybridRate' ),
			'ctaLabel'       => self::text( $attributes, 'ctaLabel', 60 ),
			'ctaUrl'         => isset( $attributes['ctaUrl'] ) && is_string( $attributes['ctaUrl'] ) ? esc_url_raw( $attributes['ctaUrl'] ) : '',
			'packages'       => $packages,
			'addOns'         => $add_ons,
		);
	}

	/**
	 * Coerce a list item to an array; hand-edited content may hold anything.
	 *
	 * @param mixed $value Raw item.
	 * @return array
	 */
	private static function as_array( $value ) {
		return is_array( $value ) ? $value : array();
	}

	/**
	 * Read a string field, sanitise it and cap its length.
	 *
	 * @param array  $source Source array.
	 * @param string $key    Field name.
	 * @param int    $limit  Maximum length in characters.
	 * @return string
	 */
	private static function text( array $source, $key, $limit ) {
		if ( ! isset( $source[ $key ] ) || ! is_string( $source[ $key ] ) ) {
			return '';
		}

		return mb_substr( sanitize_text_field( $source[ $key ] ), 0, $limit );
	}

	/**
	 * Read a non-negative amount, clamped to a sane maximum.
	 *
	 * @param array  $source Source array.
	 * @param string $key    Field name.
	 * @return float
	 */
	private static function amount( array $source, $key ) {
		$value = $source[ $key ] ?? 0;

		return is_numeric( $value ) ? min( max( (float) $value, 0.0 ), self::MAX_AMOUNT ) : 0.0;
	}

	/**
	 * Read an amount that may be absent.
	 *
	 * @param array  $source Source array.
	 * @param string $key    Field name.
	 * @return float|null Null when missing, empty or not numeric.
	 */
	private static function optional_amount( array $source, $key ) {
		$value = $source[ $key ] ?? null;

		if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
			return null;
		}

		return self::amount( $source, $key );
	}

	/**
	 * Read a percentage between 0 and 100.
	 *
	 * @param array  $source Source array.
	 * @param string $key    Field name.
	 * @return float
	 */
	private static function percent( array $source, $key ) {
		$value = $source[ $key ] ?? 0;

		return is_numeric( $value ) ? min( max( (float) $value, 0.0 ), 100.0 ) : 0.0;
	}
}
