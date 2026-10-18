import { useId, useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import {
	appendQuery,
	calculateEstimate,
	clampInt,
	formatMoney,
	MAX_BRANCHES,
	nonNegative,
} from './calculate';

/**
 * The interactive estimator. Used twice, with the same markup both times: as
 * the live preview in the editor and as the front-end app mounted by view.js.
 *
 * Native radio buttons and number inputs are used on purpose, not custom
 * widgets: they give keyboard support, grouping and screen-reader semantics for
 * free. The result sits in a polite live region so a change is announced.
 *
 * @param {Object}  props
 * @param {Object}  props.config   Sanitised block configuration.
 * @param {boolean} props.isEditor True in the block editor, where links must not navigate.
 */
export default function Estimator( { config, isEditor = false } ) {
	const {
		heading,
		disclaimer,
		currencySymbol = '$',
		hybridRate = 0,
		ctaLabel,
		ctaUrl,
		packages = [],
		addOns = [],
	} = config;

	const uid = useId();
	const [ packageIndex, setPackageIndex ] = useState( 0 );
	const [ model, setModel ] = useState( 'fixed' );
	const [ billing, setBilling ] = useState( 'monthly' );
	// Raw strings, not numbers: a controlled number input that snaps to its
	// minimum the moment it is cleared makes it impossible to type a new value.
	// calculateEstimate() clamps for the maths; onBlur tidies what is displayed.
	const [ branches, setBranches ] = useState( '1' );
	const [ revenue, setRevenue ] = useState( '' );
	const [ quantities, setQuantities ] = useState( {} );

	const models = [
		{ value: 'fixed', label: __( 'Fixed monthly', 'price-estimator' ) },
		{
			value: 'hybrid',
			label: __(
				'Hybrid (lower fee + revenue share)',
				'price-estimator'
			),
		},
		{ value: 'revenue', label: __( 'Revenue-based', 'price-estimator' ) },
	];

	// The editor can delete the selected package; fall back rather than crash.
	const pkg = packages[ packageIndex ] ?? packages[ 0 ];

	const result = useMemo(
		() =>
			pkg
				? calculateEstimate( {
						pkg,
						model,
						billing,
						branches,
						addOns,
						quantities,
						revenue: nonNegative( revenue ),
						hybridRate,
				  } )
				: null,
		[
			pkg,
			model,
			billing,
			branches,
			addOns,
			quantities,
			revenue,
			hybridRate,
		]
	);

	if ( ! pkg || ! result ) {
		return null;
	}

	const { estimate } = result;
	const id = ( name ) => `${ uid }-${ name }`;

	const ctaHref = estimate
		? appendQuery( ctaUrl, {
				package: pkg.name,
				model,
				billing: result.billing,
				branches: result.branches,
				estimate: formatMoney( estimate.amount, currencySymbol ),
		  } )
		: '';

	return (
		<div className="price-estimator__body">
			{ heading && (
				<h2 className="price-estimator__heading">{ heading }</h2>
			) }

			<div className="price-estimator__controls">
				<fieldset className="price-estimator__group">
					<legend>{ __( 'Package', 'price-estimator' ) }</legend>
					<div className="price-estimator__options">
						{ packages.map( ( item, index ) => (
							// eslint-disable-next-line jsx-a11y/label-has-associated-control -- the input is nested in the label
							<label
								key={ item.name }
								className="price-estimator__choice"
							>
								<input
									type="radio"
									name={ id( 'package' ) }
									checked={ index === packageIndex }
									onChange={ () => setPackageIndex( index ) }
								/>
								<span className="price-estimator__choice-text">
									{ item.name }
									<small className="price-estimator__hint">
										{ sprintf(
											/* translators: %s: formatted starting price, e.g. "$49". */
											__( 'from %s', 'price-estimator' ),
											formatMoney(
												item.monthlyFee,
												currencySymbol
											)
										) }
									</small>
								</span>
							</label>
						) ) }
					</div>
				</fieldset>

				<fieldset className="price-estimator__group">
					<legend>{ __( 'How you pay', 'price-estimator' ) }</legend>
					<div className="price-estimator__options">
						{ models.map( ( item ) => (
							// eslint-disable-next-line jsx-a11y/label-has-associated-control -- the input is nested in the label
							<label
								key={ item.value }
								className="price-estimator__choice"
							>
								<input
									type="radio"
									name={ id( 'model' ) }
									checked={ item.value === model }
									onChange={ () => setModel( item.value ) }
								/>
								<span className="price-estimator__choice-text">
									{ item.label }
								</span>
							</label>
						) ) }
					</div>
				</fieldset>

				<div className="price-estimator__fields">
					<div className="price-estimator__field">
						<label htmlFor={ id( 'branches' ) }>
							{ __( 'Branches', 'price-estimator' ) }
						</label>
						<input
							id={ id( 'branches' ) }
							type="number"
							inputMode="numeric"
							min="1"
							max={ MAX_BRANCHES }
							value={ branches }
							onChange={ ( event ) =>
								setBranches( event.target.value )
							}
							onBlur={ () =>
								setBranches(
									String(
										clampInt( branches, 1, MAX_BRANCHES )
									)
								)
							}
						/>
					</div>

					{ addOns.map( ( addOn ) => (
						<div
							key={ addOn.id }
							className="price-estimator__field"
						>
							<label htmlFor={ id( addOn.id ) }>
								{ sprintf(
									/* translators: 1: add-on name, 2: formatted monthly price per branch. */
									__(
										'%1$s (%2$s / branch / month)',
										'price-estimator'
									),
									addOn.label,
									formatMoney( addOn.price, currencySymbol )
								) }
							</label>
							<input
								id={ id( addOn.id ) }
								type="number"
								inputMode="numeric"
								min="0"
								max={ addOn.max }
								value={ quantities[ addOn.id ] ?? '0' }
								onChange={ ( event ) =>
									setQuantities( ( previous ) => ( {
										...previous,
										[ addOn.id ]: event.target.value,
									} ) )
								}
								onBlur={ () =>
									setQuantities( ( previous ) => ( {
										...previous,
										[ addOn.id ]: String(
											clampInt(
												previous[ addOn.id ],
												0,
												addOn.max
											)
										),
									} ) )
								}
							/>
						</div>
					) ) }

					{ result.revenueLinked && (
						<div className="price-estimator__field">
							<label htmlFor={ id( 'revenue' ) }>
								{ __(
									'Expected monthly revenue, all branches',
									'price-estimator'
								) }
							</label>
							<input
								id={ id( 'revenue' ) }
								type="number"
								inputMode="decimal"
								min="0"
								value={ revenue }
								aria-describedby={ id( 'result' ) }
								onChange={ ( event ) =>
									setRevenue( event.target.value )
								}
							/>
						</div>
					) }
				</div>

				{ /* eslint-disable-next-line jsx-a11y/label-has-associated-control -- the input is nested in the label */ }
				<label className="price-estimator__annual">
					<input
						className="price-estimator__switch"
						type="checkbox"
						checked={ result.billing === 'annual' }
						disabled={ ! result.canAnnual }
						onChange={ ( event ) =>
							setBilling(
								event.target.checked ? 'annual' : 'monthly'
							)
						}
					/>
					<span className="price-estimator__switch-label">
						{ result.canAnnual
							? __( 'Bill annually', 'price-estimator' )
							: __(
									'Annual billing is available on the fixed monthly model only',
									'price-estimator'
							  ) }
					</span>
				</label>
			</div>

			<aside className="price-estimator__summary">
				<p className="price-estimator__label">
					{ __( 'Estimated total', 'price-estimator' ) }
				</p>

				<div
					id={ id( 'result' ) }
					className="price-estimator__result"
					role="status"
					aria-live="polite"
				>
					{ estimate ? (
						<>
							<p className="price-estimator__total">
								{ formatMoney(
									estimate.amount,
									currencySymbol
								) }{ ' ' }
								<span className="price-estimator__period">
									{ sprintf(
										/* translators: %s: billing period, "month" or "year". */
										__( '/ %s', 'price-estimator' ),
										estimate.period === 'year'
											? __( 'year', 'price-estimator' )
											: __( 'month', 'price-estimator' )
									) }
								</span>
							</p>
							{ estimate.addOnsMonthly > 0 && (
								<p>
									{ sprintf(
										/* translators: %s: formatted monthly add-on cost. */
										__(
											'+ %s / month for add-ons',
											'price-estimator'
										),
										formatMoney(
											estimate.addOnsMonthly,
											currencySymbol
										)
									) }
								</p>
							) }
							{ result.minimumApplies && (
								<p>
									{ __(
										'The per-branch minimum applies at this revenue.',
										'price-estimator'
									) }
								</p>
							) }
						</>
					) : (
						<p>
							{ __(
								'Enter your expected monthly revenue to see an estimate.',
								'price-estimator'
							) }
						</p>
					) }
				</div>

				{ disclaimer && (
					<p className="price-estimator__disclaimer">
						{ disclaimer }
					</p>
				) }

				{ ctaHref && ctaLabel && (
					<a
						className="price-estimator__cta"
						href={ ctaHref }
						onClick={
							isEditor
								? ( event ) => event.preventDefault()
								: undefined
						}
					>
						{ ctaLabel }
					</a>
				) }
			</aside>
		</div>
	);
}
