<?php
/**
 * Server render for the Price Estimator block.
 *
 * Prints a wrapper carrying the sanitised configuration, plus a plain list of
 * the packages. The list is what crawlers, feed readers and visitors without
 * JavaScript see; view.js replaces it with the interactive estimator.
 *
 * Variables provided by WordPress: $attributes (array), $content (string),
 * $block (WP_Block).
 *
 * @package CodeSample\PriceEstimator
 */

use CodeSample\PriceEstimator\Config;

$price_estimator_config = Config::from_attributes( $attributes );

// Nothing to estimate: print nothing rather than an empty box.
if ( empty( $price_estimator_config['packages'] ) ) {
	return;
}

$price_estimator_symbol = $price_estimator_config['currencySymbol'];
?>
<div
	<?php
	// get_block_wrapper_attributes() returns already-escaped attributes.
	echo get_block_wrapper_attributes( array( 'class' => 'price-estimator' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	?>
	data-price-estimator="<?php echo esc_attr( wp_json_encode( $price_estimator_config ) ); ?>"
>
	<?php if ( '' !== $price_estimator_config['heading'] ) : ?>
		<h2 class="price-estimator__heading"><?php echo esc_html( $price_estimator_config['heading'] ); ?></h2>
	<?php endif; ?>

	<ul class="price-estimator__fallback">
		<?php foreach ( $price_estimator_config['packages'] as $price_estimator_package ) : ?>
			<li>
				<?php
				echo esc_html(
					sprintf(
						/* translators: 1: package name, 2: currency symbol, 3: formatted monthly price. */
						__( '%1$s: from %2$s%3$s per branch per month', 'price-estimator' ),
						$price_estimator_package['name'],
						$price_estimator_symbol,
						number_format_i18n( $price_estimator_package['monthlyFee'] )
					)
				);
				?>
			</li>
		<?php endforeach; ?>
	</ul>

	<?php if ( '' !== $price_estimator_config['disclaimer'] ) : ?>
		<p class="price-estimator__disclaimer"><?php echo esc_html( $price_estimator_config['disclaimer'] ); ?></p>
	<?php endif; ?>
</div>
