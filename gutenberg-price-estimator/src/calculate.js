/**
 * Pricing arithmetic for the Price Estimator block.
 *
 * Pure functions, no React and no WordPress imports, so the rules can be tested
 * on their own and reused by the editor preview and the front end alike.
 *
 * THE RULES (ported from a production pricing calculator)
 *
 *  - Three models. `fixed`: a per-branch monthly fee. `hybrid`: a lower fee plus
 *    a percentage of revenue. `revenue`: a percentage of revenue only, never
 *    below a per-branch minimum.
 *  - Add-ons are priced per branch per month under every model.
 *  - Revenue-linked models need a revenue figure. Without one there is no honest
 *    number, so the result is `null` rather than a misleading total.
 *  - Annual billing only exists for the fixed model on a package that has an
 *    annual fee; anywhere else it quietly falls back to monthly.
 */

export const MODELS = [ 'fixed', 'hybrid', 'revenue' ];

export const MAX_BRANCHES = 500;

/**
 * Coerce any input to an integer within [min, max].
 *
 * @param {*}      value Raw value, typically a string from an input.
 * @param {number} min   Lowest allowed value.
 * @param {number} max   Highest allowed value.
 * @return {number} Clamped integer; `min` when the input is not a number.
 */
export function clampInt( value, min, max ) {
	const number = Math.floor( Number( value ) );

	if ( ! Number.isFinite( number ) ) {
		return min;
	}

	return Math.min( Math.max( number, min ), max );
}

/**
 * Coerce any input to a non-negative finite number.
 *
 * @param {*} value Raw value.
 * @return {number} The value, or 0 when it is negative or not numeric.
 */
export function nonNegative( value ) {
	const number = Number( value );

	return Number.isFinite( number ) && number > 0 ? number : 0;
}

/**
 * Format a money amount with a symbol prefix and thousands separators.
 *
 * @param {number} amount Amount to format.
 * @param {string} symbol Currency symbol, e.g. "$" or "PKR ".
 * @return {string} Formatted amount, rounded to a whole unit.
 */
export function formatMoney( amount, symbol ) {
	return `${ symbol }${ Math.round( amount ).toLocaleString( 'en-US' ) }`;
}

/**
 * Append query parameters to a URL string, keeping any existing query and hash.
 * Empty values are skipped. Returns '' for an empty URL so callers can hide the
 * call to action instead of linking nowhere.
 *
 * @param {string}                 url    Base URL, absolute or relative.
 * @param {Object<string, string>} params Parameters to add.
 * @return {string} The URL with the parameters appended.
 */
export function appendQuery( url, params ) {
	if ( ! url ) {
		return '';
	}

	const query = new URLSearchParams();

	Object.entries( params ).forEach( ( [ key, value ] ) => {
		if ( value !== undefined && value !== null && value !== '' ) {
			query.set( key, String( value ) );
		}
	} );

	const queryString = query.toString();

	if ( ! queryString ) {
		return url;
	}

	const [ beforeHash, hash = '' ] = url.split( '#' );
	const separator = beforeHash.includes( '?' ) ? '&' : '?';

	return `${ beforeHash }${ separator }${ queryString }${
		hash ? `#${ hash }` : ''
	}`;
}

/**
 * Work out the estimate for one set of choices.
 *
 * @param {Object}                 input
 * @param {Object}                 input.pkg        Selected package.
 * @param {string}                 input.model      One of MODELS.
 * @param {string}                 input.billing    'monthly' or 'annual'.
 * @param {number}                 input.branches   Number of branches (>= 1).
 * @param {Array}                  input.addOns     Add-on definitions {id, price, max}.
 * @param {Object<string, number>} input.quantities Quantity per add-on id.
 * @param {number}                 input.revenue    Expected monthly revenue, all branches.
 * @param {number}                 input.hybridRate Percent of revenue charged by the hybrid model.
 * @return {Object} Breakdown. `estimate` is null when revenue is required but missing.
 */
export function calculateEstimate( {
	pkg,
	model,
	billing = 'monthly',
	branches = 1,
	addOns = [],
	quantities = {},
	revenue = 0,
	hybridRate = 0,
} ) {
	const branchCount = clampInt( branches, 1, MAX_BRANCHES );
	const monthlyRevenue = nonNegative( revenue );
	const revenueLinked = model !== 'fixed';
	const revenueMissing = revenueLinked && monthlyRevenue <= 0;

	const addOnsPerBranch = addOns.reduce( ( sum, addOn ) => {
		const quantity = clampInt( quantities[ addOn.id ], 0, addOn.max ?? 99 );

		return sum + nonNegative( addOn.price ) * quantity;
	}, 0 );
	const addOnsMonthly = addOnsPerBranch * branchCount;

	const baseFee = {
		fixed: nonNegative( pkg.monthlyFee ),
		hybrid: nonNegative( pkg.hybridFee ),
		revenue: 0,
	}[ model ];

	const perBranchRevenue = monthlyRevenue / branchCount;
	const rateShare =
		perBranchRevenue * ( nonNegative( pkg.revenueRate ) / 100 );
	const minimum = nonNegative( pkg.revenueMin );

	let revenueShare = 0;
	let minimumApplies = false;

	if ( model === 'hybrid' ) {
		revenueShare = monthlyRevenue * ( nonNegative( hybridRate ) / 100 );
	} else if ( model === 'revenue' ) {
		minimumApplies = rateShare < minimum;
		revenueShare = Math.max( rateShare, minimum ) * branchCount;
	}

	const monthlyTotal =
		( baseFee + addOnsPerBranch ) * branchCount + revenueShare;

	const annualFee =
		pkg.annualFee === null || pkg.annualFee === undefined
			? null
			: nonNegative( pkg.annualFee );
	const canAnnual = model === 'fixed' && annualFee !== null;
	const effectiveBilling =
		billing === 'annual' && canAnnual ? 'annual' : 'monthly';

	let estimate = null;

	if ( ! revenueMissing ) {
		estimate =
			effectiveBilling === 'annual'
				? {
						period: 'year',
						amount: annualFee * branchCount,
						addOnsMonthly,
				  }
				: { period: 'month', amount: monthlyTotal, addOnsMonthly: 0 };
	}

	return {
		branches: branchCount,
		revenueLinked,
		revenueMissing,
		minimumApplies,
		canAnnual,
		billing: effectiveBilling,
		addOnsMonthly,
		revenueShare,
		monthlyTotal,
		estimate,
	};
}
