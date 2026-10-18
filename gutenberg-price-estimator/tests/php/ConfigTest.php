<?php
/**
 * Tests for the attribute sanitiser.
 *
 * Block attributes come from post content, which can be edited by hand or
 * imported, so each test feeds Config something hostile or malformed and checks
 * what comes out the other side.
 *
 * @package CodeSample\PriceEstimator
 */

use CodeSample\PriceEstimator\Config;
use PHPUnit\Framework\TestCase;

/**
 * @covers \CodeSample\PriceEstimator\Config
 */
final class ConfigTest extends TestCase {

	/**
	 * A valid package to override in individual tests.
	 *
	 * @param array $overrides Fields to replace.
	 * @return array
	 */
	private function package( array $overrides = array() ) {
		return array_merge(
			array(
				'name'        => 'Growth',
				'monthlyFee'  => 99,
				'hybridFee'   => 59,
				'annualFee'   => 990,
				'revenueRate' => 2.5,
				'revenueMin'  => 59,
			),
			$overrides
		);
	}

	public function test_valid_attributes_pass_through_unchanged() {
		$config = Config::from_attributes(
			array(
				'heading'        => 'Estimate',
				'currencySymbol' => '$',
				'hybridRate'     => 2,
				'ctaUrl'         => '/contact',
				'packages'       => array( $this->package() ),
				'addOns'         => array(
					array(
						'id'    => 'user',
						'label' => 'Extra user',
						'price' => 5,
						'max'   => 20,
					),
				),
			)
		);

		$this->assertSame( 'Estimate', $config['heading'] );
		$this->assertSame( '/contact', $config['ctaUrl'] );
		$this->assertSame( 99.0, $config['packages'][0]['monthlyFee'] );
		$this->assertSame( 990.0, $config['packages'][0]['annualFee'] );
		$this->assertSame( 'user', $config['addOns'][0]['id'] );
		$this->assertSame( 20, $config['addOns'][0]['max'] );
	}

	public function test_markup_is_stripped_from_text_fields() {
		$config = Config::from_attributes(
			array(
				'heading'  => '<script>alert(1)</script>Prices',
				'packages' => array( $this->package( array( 'name' => '<b>Growth</b>' ) ) ),
			)
		);

		// Real sanitize_text_field() also drops the script body; the stand-in does
		// not. Either way, no markup may survive.
		$this->assertStringNotContainsString( '<', $config['heading'] );
		$this->assertStringContainsString( 'Prices', $config['heading'] );
		$this->assertSame( 'Growth', $config['packages'][0]['name'] );
	}

	public function test_dangerous_url_schemes_are_dropped() {
		foreach ( array( 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x' ) as $url ) {
			$config = Config::from_attributes( array( 'ctaUrl' => $url ) );

			$this->assertSame( '', $config['ctaUrl'], $url );
		}
	}

	public function test_text_is_length_capped() {
		$config = Config::from_attributes( array( 'heading' => str_repeat( 'a', 500 ) ) );

		$this->assertSame( 120, mb_strlen( $config['heading'] ) );
	}

	public function test_amounts_are_clamped_to_a_non_negative_finite_range() {
		$config = Config::from_attributes(
			array(
				'packages' => array(
					$this->package(
						array(
							'monthlyFee' => -50,
							'hybridFee'  => 'free',
							'revenueMin' => 1e30,
						)
					),
				),
			)
		);

		$this->assertSame( 0.0, $config['packages'][0]['monthlyFee'] );
		$this->assertSame( 0.0, $config['packages'][0]['hybridFee'] );
		$this->assertSame( Config::MAX_AMOUNT, $config['packages'][0]['revenueMin'] );
	}

	public function test_percentages_are_kept_between_zero_and_one_hundred() {
		$config = Config::from_attributes(
			array(
				'hybridRate' => 250,
				'packages'   => array( $this->package( array( 'revenueRate' => -3 ) ) ),
			)
		);

		$this->assertSame( 100.0, $config['hybridRate'] );
		$this->assertSame( 0.0, $config['packages'][0]['revenueRate'] );
	}

	public function test_a_missing_annual_fee_stays_null_but_zero_is_kept() {
		$none = Config::from_attributes( array( 'packages' => array( $this->package( array( 'annualFee' => null ) ) ) ) );
		$blank = Config::from_attributes( array( 'packages' => array( $this->package( array( 'annualFee' => '' ) ) ) ) );
		$zero = Config::from_attributes( array( 'packages' => array( $this->package( array( 'annualFee' => 0 ) ) ) ) );

		$this->assertNull( $none['packages'][0]['annualFee'] );
		$this->assertNull( $blank['packages'][0]['annualFee'] );
		$this->assertSame( 0.0, $zero['packages'][0]['annualFee'] );
	}

	public function test_nameless_packages_and_add_ons_are_dropped() {
		$config = Config::from_attributes(
			array(
				'packages' => array( $this->package( array( 'name' => '   ' ) ), $this->package() ),
				'addOns'   => array( array( 'label' => '', 'price' => 5 ) ),
			)
		);

		$this->assertCount( 1, $config['packages'] );
		$this->assertCount( 0, $config['addOns'] );
	}

	public function test_list_sizes_are_bounded() {
		$config = Config::from_attributes(
			array(
				'packages' => array_fill( 0, 50, $this->package() ),
				'addOns'   => array_fill( 0, 50, array( 'label' => 'x', 'price' => 1 ) ),
			)
		);

		$this->assertCount( Config::MAX_PACKAGES, $config['packages'] );
		$this->assertCount( Config::MAX_ADD_ONS, $config['addOns'] );
	}

	public function test_add_ons_without_an_id_get_a_stable_one() {
		$config = Config::from_attributes( array( 'addOns' => array( array( 'label' => 'Seat', 'price' => 1 ) ) ) );

		$this->assertSame( 'addon-0', $config['addOns'][0]['id'] );
	}

	public function test_add_on_ids_are_reduced_to_a_safe_key() {
		$config = Config::from_attributes( array( 'addOns' => array( array( 'id' => 'A B"<x>', 'label' => 'Seat', 'price' => 1 ) ) ) );

		$this->assertSame( 'abx', $config['addOns'][0]['id'] );
	}

	public function test_add_on_maximum_is_kept_within_bounds() {
		$config = Config::from_attributes(
			array(
				'addOns' => array(
					array( 'label' => 'A', 'price' => 1, 'max' => 0 ),
					array( 'label' => 'B', 'price' => 1, 'max' => 5000 ),
				),
			)
		);

		$this->assertSame( 1, $config['addOns'][0]['max'] );
		$this->assertSame( 99, $config['addOns'][1]['max'] );
	}

	public function test_hand_edited_content_of_the_wrong_type_does_not_fatal() {
		$config = Config::from_attributes(
			array(
				'heading'  => array( 'not', 'a', 'string' ),
				'packages' => 'nope',
				'addOns'   => array( 'str', 42, null, $this->package() ),
				'ctaUrl'   => 12,
			)
		);

		$this->assertSame( '', $config['heading'] );
		$this->assertSame( array(), $config['packages'] );
		$this->assertSame( '', $config['ctaUrl'] );
		$this->assertCount( 0, $config['addOns'] );
	}

	public function test_the_json_encoded_config_cannot_break_out_of_an_html_attribute() {
		$config = Config::from_attributes( array( 'heading' => 'Say "hi" & <leave>' ) );

		// What render.php does: encode, then escape for an attribute.
		$attribute = htmlspecialchars( json_encode( $config ), ENT_QUOTES );

		$this->assertStringNotContainsString( '"', str_replace( '&quot;', '', $attribute ) );
		$this->assertStringNotContainsString( '<', $attribute );
	}
}
