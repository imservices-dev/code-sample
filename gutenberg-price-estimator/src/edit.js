import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	Button,
	PanelBody,
	TextControl,
	__experimentalVStack as VStack, // eslint-disable-line @wordpress/no-unsafe-wp-apis
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

import Estimator from './Estimator';

const MAX_PACKAGES = 8;
const MAX_ADD_ONS = 6;

/**
 * A text input that holds a number. TextControl's `value` is a string; an empty
 * field means "no value", which the annual fee uses to mean "not offered".
 *
 * @param {Object}                     props
 * @param {string}                     props.label    Field label.
 * @param {number|null|undefined}      props.value    Current value; null or undefined shows an empty field.
 * @param {(value: number|null)=>void} props.onChange Receives a number, or null when the field is emptied.
 * @param {string}                     [props.help]   Help text under the field.
 * @param {number}                     [props.min]    Lowest accepted value.
 * @param {number|string}              [props.step]   Step, or 'any'.
 */
function NumberField( {
	label,
	value,
	onChange,
	help,
	min = 0,
	step = 'any',
} ) {
	return (
		<TextControl
			__nextHasNoMarginBottom
			__next40pxDefaultSize
			type="number"
			min={ min }
			step={ step }
			label={ label }
			help={ help }
			value={ value ?? '' }
			onChange={ ( next ) =>
				onChange( next === '' ? null : Number( next ) )
			}
		/>
	);
}

function replaceAt( list, index, patch ) {
	return list.map( ( item, i ) =>
		i === index ? { ...item, ...patch } : item
	);
}

export default function Edit( { attributes, setAttributes } ) {
	const { packages, addOns } = attributes;

	// The preview needs ids on add-ons. Saved content from older versions or
	// hand-edited markup may lack them; derive a stable one from the index.
	const previewConfig = {
		...attributes,
		addOns: addOns.map( ( addOn, index ) => ( {
			...addOn,
			id: addOn.id || `addon-${ index }`,
		} ) ),
	};

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Content', 'price-estimator' ) }>
					<VStack spacing={ 4 }>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Heading', 'price-estimator' ) }
							value={ attributes.heading }
							onChange={ ( heading ) =>
								setAttributes( { heading } )
							}
						/>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Disclaimer', 'price-estimator' ) }
							value={ attributes.disclaimer }
							onChange={ ( disclaimer ) =>
								setAttributes( { disclaimer } )
							}
						/>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Currency symbol', 'price-estimator' ) }
							help={ __(
								'Shown before every amount, e.g. $ or PKR.',
								'price-estimator'
							) }
							value={ attributes.currencySymbol }
							onChange={ ( currencySymbol ) =>
								setAttributes( { currencySymbol } )
							}
						/>
						<NumberField
							label={ __(
								'Hybrid revenue share (%)',
								'price-estimator'
							) }
							value={ attributes.hybridRate }
							onChange={ ( hybridRate ) =>
								setAttributes( { hybridRate: hybridRate ?? 0 } )
							}
						/>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Button label', 'price-estimator' ) }
							value={ attributes.ctaLabel }
							onChange={ ( ctaLabel ) =>
								setAttributes( { ctaLabel } )
							}
						/>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							type="url"
							label={ __( 'Button link', 'price-estimator' ) }
							help={ __(
								'The visitor’s choices are added to this link as query parameters. Leave empty to hide the button.',
								'price-estimator'
							) }
							value={ attributes.ctaUrl }
							onChange={ ( ctaUrl ) =>
								setAttributes( { ctaUrl } )
							}
						/>
					</VStack>
				</PanelBody>

				{ packages.map( ( item, index ) => (
					<PanelBody
						key={ index }
						title={ sprintf(
							/* translators: %s: package name. */
							__( 'Package: %s', 'price-estimator' ),
							item.name || __( '(unnamed)', 'price-estimator' )
						) }
						initialOpen={ false }
					>
						<VStack spacing={ 4 }>
							<TextControl
								__nextHasNoMarginBottom
								__next40pxDefaultSize
								label={ __( 'Name', 'price-estimator' ) }
								value={ item.name }
								onChange={ ( name ) =>
									setAttributes( {
										packages: replaceAt( packages, index, {
											name,
										} ),
									} )
								}
							/>
							{ [
								[
									'monthlyFee',
									__(
										'Fixed monthly fee, per branch',
										'price-estimator'
									),
								],
								[
									'hybridFee',
									__(
										'Hybrid monthly fee, per branch',
										'price-estimator'
									),
								],
								[
									'annualFee',
									__(
										'Annual fee, per branch',
										'price-estimator'
									),
									__(
										'Leave empty if annual billing is not offered.',
										'price-estimator'
									),
								],
								[
									'revenueRate',
									__(
										'Revenue-based rate (%)',
										'price-estimator'
									),
								],
								[
									'revenueMin',
									__(
										'Revenue-based minimum, per branch',
										'price-estimator'
									),
								],
							].map( ( [ key, label, help ] ) => (
								<NumberField
									key={ key }
									label={ label }
									help={ help }
									value={ item[ key ] }
									onChange={ ( value ) =>
										setAttributes( {
											packages: replaceAt(
												packages,
												index,
												{ [ key ]: value }
											),
										} )
									}
								/>
							) ) }
							{ packages.length > 1 && (
								<Button
									variant="secondary"
									isDestructive
									onClick={ () =>
										setAttributes( {
											packages: packages.filter(
												( _, i ) => i !== index
											),
										} )
									}
								>
									{ __(
										'Remove package',
										'price-estimator'
									) }
								</Button>
							) }
						</VStack>
					</PanelBody>
				) ) }

				<PanelBody
					title={ __( 'Packages and add-ons', 'price-estimator' ) }
					initialOpen={ false }
				>
					<VStack spacing={ 4 }>
						<Button
							variant="secondary"
							disabled={ packages.length >= MAX_PACKAGES }
							onClick={ () =>
								setAttributes( {
									packages: [
										...packages,
										{
											name: __(
												'New package',
												'price-estimator'
											),
											monthlyFee: 0,
											hybridFee: 0,
											annualFee: null,
											revenueRate: 0,
											revenueMin: 0,
										},
									],
								} )
							}
						>
							{ __( 'Add package', 'price-estimator' ) }
						</Button>

						{ addOns.map( ( item, index ) => (
							<VStack key={ index } spacing={ 3 }>
								<TextControl
									__nextHasNoMarginBottom
									__next40pxDefaultSize
									label={ __(
										'Add-on name',
										'price-estimator'
									) }
									value={ item.label }
									onChange={ ( label ) =>
										setAttributes( {
											addOns: replaceAt( addOns, index, {
												label,
											} ),
										} )
									}
								/>
								<NumberField
									label={ __(
										'Price, per branch / month',
										'price-estimator'
									) }
									value={ item.price }
									onChange={ ( price ) =>
										setAttributes( {
											addOns: replaceAt( addOns, index, {
												price: price ?? 0,
											} ),
										} )
									}
								/>
								<NumberField
									label={ __(
										'Maximum quantity',
										'price-estimator'
									) }
									min={ 1 }
									step={ 1 }
									value={ item.max }
									onChange={ ( max ) =>
										setAttributes( {
											addOns: replaceAt( addOns, index, {
												max: max ?? 1,
											} ),
										} )
									}
								/>
								<Button
									variant="link"
									isDestructive
									onClick={ () =>
										setAttributes( {
											addOns: addOns.filter(
												( _, i ) => i !== index
											),
										} )
									}
								>
									{ __( 'Remove add-on', 'price-estimator' ) }
								</Button>
							</VStack>
						) ) }

						<Button
							variant="secondary"
							disabled={ addOns.length >= MAX_ADD_ONS }
							onClick={ () =>
								setAttributes( {
									addOns: [
										...addOns,
										{
											id: `addon-${ Date.now().toString(
												36
											) }`,
											label: __(
												'New add-on',
												'price-estimator'
											),
											price: 0,
											max: 10,
										},
									],
								} )
							}
						>
							{ __( 'Add add-on', 'price-estimator' ) }
						</Button>
					</VStack>
				</PanelBody>
			</InspectorControls>

			<div { ...useBlockProps( { className: 'price-estimator' } ) }>
				<Estimator config={ previewConfig } isEditor />
			</div>
		</>
	);
}
