import {
	appendQuery,
	calculateEstimate,
	clampInt,
	formatMoney,
	nonNegative,
} from '../../src/calculate';

const pkg = {
	name: 'Growth',
	monthlyFee: 100,
	hybridFee: 60,
	annualFee: 1000,
	revenueRate: 2,
	revenueMin: 50,
};

const addOns = [
	{ id: 'terminal', price: 15, max: 10 },
	{ id: 'user', price: 5, max: 20 },
];

describe( 'clampInt', () => {
	it.each( [
		[ '5', 1, 10, 5 ],
		[ 0, 1, 10, 1 ],
		[ 99, 1, 10, 10 ],
		[ 'abc', 1, 10, 1 ],
		[ NaN, 0, 5, 0 ],
		[ 2.9, 0, 5, 2 ],
	] )( 'clampInt(%p, %p, %p) is %p', ( value, min, max, expected ) => {
		expect( clampInt( value, min, max ) ).toBe( expected );
	} );
} );

describe( 'nonNegative', () => {
	it( 'rejects negatives, NaN and Infinity', () => {
		expect( nonNegative( -5 ) ).toBe( 0 );
		expect( nonNegative( 'x' ) ).toBe( 0 );
		expect( nonNegative( Infinity ) ).toBe( 0 );
		expect( nonNegative( '12.5' ) ).toBe( 12.5 );
	} );
} );

describe( 'formatMoney', () => {
	it( 'rounds to a whole unit and adds separators', () => {
		expect( formatMoney( 12345.6, '$' ) ).toBe( '$12,346' );
		expect( formatMoney( 3700, 'PKR ' ) ).toBe( 'PKR 3,700' );
	} );
} );

describe( 'appendQuery', () => {
	it( 'adds parameters, skips empty ones and keeps the hash', () => {
		expect(
			appendQuery( '/quote#form', { package: 'Growth', note: '' } )
		).toBe( '/quote?package=Growth#form' );
	} );

	it( 'extends an existing query string', () => {
		expect( appendQuery( '/quote?ref=a', { branches: 2 } ) ).toBe(
			'/quote?ref=a&branches=2'
		);
	} );

	it( 'returns an empty string for an empty URL so the button can be hidden', () => {
		expect( appendQuery( '', { a: 1 } ) ).toBe( '' );
	} );

	it( 'encodes values rather than trusting them', () => {
		expect( appendQuery( '/q', { package: 'A&B=C' } ) ).toBe(
			'/q?package=A%26B%3DC'
		);
	} );
} );

describe( 'calculateEstimate — fixed model', () => {
	it( 'multiplies the monthly fee by branches', () => {
		const { estimate } = calculateEstimate( {
			pkg,
			model: 'fixed',
			branches: 3,
		} );

		expect( estimate ).toEqual( {
			period: 'month',
			amount: 300,
			addOnsMonthly: 0,
		} );
	} );

	it( 'adds add-ons per branch', () => {
		const { estimate, addOnsMonthly } = calculateEstimate( {
			pkg,
			model: 'fixed',
			branches: 2,
			addOns,
			quantities: { terminal: 2, user: 3 },
		} );

		// (100 + 2*15 + 3*5) * 2 branches
		expect( estimate.amount ).toBe( 290 );
		expect( addOnsMonthly ).toBe( 90 );
	} );

	it( 'clamps an add-on quantity to its maximum', () => {
		const { addOnsMonthly } = calculateEstimate( {
			pkg,
			model: 'fixed',
			addOns,
			quantities: { terminal: 999 },
		} );

		expect( addOnsMonthly ).toBe( 150 );
	} );

	it( 'bills annually as a year total plus monthly add-ons', () => {
		const { estimate, billing } = calculateEstimate( {
			pkg,
			model: 'fixed',
			billing: 'annual',
			branches: 2,
			addOns,
			quantities: { user: 2 },
		} );

		expect( billing ).toBe( 'annual' );
		expect( estimate ).toEqual( {
			period: 'year',
			amount: 2000,
			addOnsMonthly: 20,
		} );
	} );

	it( 'falls back to monthly when the package has no annual fee', () => {
		const result = calculateEstimate( {
			pkg: { ...pkg, annualFee: null },
			model: 'fixed',
			billing: 'annual',
		} );

		expect( result.canAnnual ).toBe( false );
		expect( result.billing ).toBe( 'monthly' );
		expect( result.estimate.period ).toBe( 'month' );
	} );

	it( 'treats an annual fee of 0 as offered, not as missing', () => {
		expect(
			calculateEstimate( {
				pkg: { ...pkg, annualFee: 0 },
				model: 'fixed',
			} ).canAnnual
		).toBe( true );
	} );

	it( 'never allows fewer than one branch or more than the maximum', () => {
		expect(
			calculateEstimate( { pkg, model: 'fixed', branches: -4 } ).branches
		).toBe( 1 );
		expect(
			calculateEstimate( { pkg, model: 'fixed', branches: 99999 } )
				.branches
		).toBe( 500 );
	} );
} );

describe( 'calculateEstimate — revenue-linked models', () => {
	it( 'returns no estimate until revenue is entered', () => {
		expect(
			calculateEstimate( { pkg, model: 'hybrid' } ).estimate
		).toBeNull();
		expect(
			calculateEstimate( { pkg, model: 'revenue', revenue: 0 } )
				.revenueMissing
		).toBe( true );
	} );

	it( 'hybrid: lower fee plus a share of total revenue', () => {
		const { estimate } = calculateEstimate( {
			pkg,
			model: 'hybrid',
			branches: 2,
			revenue: 10000,
			hybridRate: 2,
		} );

		// 60 * 2 branches + 2% of 10,000
		expect( estimate.amount ).toBe( 320 );
	} );

	it( 'revenue-based: charges the rate when it exceeds the minimum', () => {
		const result = calculateEstimate( {
			pkg,
			model: 'revenue',
			revenue: 10000,
		} );

		expect( result.estimate.amount ).toBe( 200 );
		expect( result.minimumApplies ).toBe( false );
	} );

	it( 'revenue-based: never charges below the per-branch minimum', () => {
		const result = calculateEstimate( {
			pkg,
			model: 'revenue',
			branches: 2,
			revenue: 1000,
		} );

		// 1,000 / 2 = 500 per branch; 2% = 10, below the 50 minimum -> 50 * 2
		expect( result.estimate.amount ).toBe( 100 );
		expect( result.minimumApplies ).toBe( true );
	} );

	it( 'revenue-based: applies the minimum branch by branch, not to the total', () => {
		// 4 branches, 8,000 total = 2,000 each; 2% = 40 < 50 -> 4 * 50, not 160
		const { estimate } = calculateEstimate( {
			pkg,
			model: 'revenue',
			branches: 4,
			revenue: 8000,
		} );

		expect( estimate.amount ).toBe( 200 );
	} );

	it( 'still charges add-ons under a revenue-linked model', () => {
		const { estimate } = calculateEstimate( {
			pkg,
			model: 'revenue',
			revenue: 10000,
			addOns,
			quantities: { terminal: 1 },
		} );

		expect( estimate.amount ).toBe( 215 );
	} );

	it( 'ignores annual billing outside the fixed model', () => {
		const { billing, canAnnual } = calculateEstimate( {
			pkg,
			model: 'hybrid',
			billing: 'annual',
			revenue: 1000,
		} );

		expect( canAnnual ).toBe( false );
		expect( billing ).toBe( 'monthly' );
	} );

	it( 'treats a negative or non-numeric revenue as missing', () => {
		expect(
			calculateEstimate( { pkg, model: 'hybrid', revenue: -5 } )
				.revenueMissing
		).toBe( true );
		expect(
			calculateEstimate( { pkg, model: 'hybrid', revenue: 'lots' } )
				.revenueMissing
		).toBe( true );
	} );
} );
