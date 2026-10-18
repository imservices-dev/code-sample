import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Estimator from '../../src/Estimator';

const config = {
	heading: 'Estimate your price',
	disclaimer: 'This is an estimate, not a quotation.',
	currencySymbol: '$',
	hybridRate: 2,
	ctaLabel: 'Request a quote',
	ctaUrl: '/contact',
	packages: [
		{
			name: 'Starter',
			monthlyFee: 50,
			hybridFee: 30,
			annualFee: 500,
			revenueRate: 3,
			revenueMin: 30,
		},
		{
			name: 'Growth',
			monthlyFee: 100,
			hybridFee: 60,
			annualFee: null,
			revenueRate: 2,
			revenueMin: 60,
		},
	],
	addOns: [ { id: 'user', label: 'Extra user', price: 5, max: 3 } ],
};

const result = () => screen.getByRole( 'status' );

describe( 'Estimator', () => {
	it( 'shows the first package on the fixed model by default', () => {
		render( <Estimator config={ config } /> );

		expect( result() ).toHaveTextContent( '$50 / month' );
		expect(
			screen.getByRole( 'radio', { name: /starter/i } )
		).toBeChecked();
	} );

	it( 'groups choices in labelled fieldsets', () => {
		render( <Estimator config={ config } /> );

		expect(
			screen.getByRole( 'group', { name: 'Package' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'group', { name: 'How you pay' } )
		).toBeInTheDocument();
	} );

	it( 'recalculates when the package changes', async () => {
		const user = userEvent.setup();
		render( <Estimator config={ config } /> );

		await user.click( screen.getByRole( 'radio', { name: /growth/i } ) );

		expect( result() ).toHaveTextContent( '$100 / month' );
	} );

	it( 'multiplies by branches and clamps nonsense input to at least one', async () => {
		const user = userEvent.setup();
		render( <Estimator config={ config } /> );
		const branches = screen.getByLabelText( 'Branches' );

		await user.clear( branches );
		await user.type( branches, '3' );
		expect( result() ).toHaveTextContent( '$150 / month' );

		await user.clear( branches );
		await user.type( branches, '-7' );
		expect( result() ).toHaveTextContent( '$50 / month' );
	} );

	it( 'prices add-ons and respects their maximum', async () => {
		const user = userEvent.setup();
		render( <Estimator config={ config } /> );
		const field = screen.getByLabelText( /extra user/i );

		await user.clear( field );
		await user.type( field, '2' );
		// Monthly total already includes the add-ons: 50 + 2 * 5.
		expect( result() ).toHaveTextContent( '$60 / month' );

		await user.clear( field );
		await user.type( field, '50' );
		// The maths clamps immediately; the field is tidied when it loses focus.
		expect( result() ).toHaveTextContent( '$65 / month' );
		await user.tab();
		expect( field ).toHaveValue( 3 );
	} );

	it( 'lists add-ons separately when billing annually', async () => {
		const user = userEvent.setup();
		render( <Estimator config={ config } /> );

		await user.clear( screen.getByLabelText( /extra user/i ) );
		await user.type( screen.getByLabelText( /extra user/i ), '2' );
		await user.click( screen.getByRole( 'checkbox' ) );

		expect( result() ).toHaveTextContent( '$500 / year' );
		expect( result() ).toHaveTextContent( '+ $10 / month for add-ons' );
	} );

	it( 'asks for revenue instead of showing a total on revenue-linked models', async () => {
		const user = userEvent.setup();
		render( <Estimator config={ config } /> );

		await user.click(
			screen.getByRole( 'radio', { name: /revenue-based/i } )
		);

		expect( result() ).toHaveTextContent(
			/enter your expected monthly revenue/i
		);
		expect( result() ).not.toHaveTextContent( '/ month' );

		await user.type(
			screen.getByLabelText( /expected monthly revenue/i ),
			'10000'
		);
		expect( result() ).toHaveTextContent( '$300 / month' );
	} );

	it( 'offers annual billing only where the package and model allow it', async () => {
		const user = userEvent.setup();
		render( <Estimator config={ config } /> );
		const annual = () => screen.getByRole( 'checkbox' );

		expect( annual() ).toBeEnabled();
		await user.click( annual() );
		expect( result() ).toHaveTextContent( '$500 / year' );

		await user.click( screen.getByRole( 'radio', { name: /growth/i } ) );
		expect( annual() ).toBeDisabled();
		expect( annual() ).not.toBeChecked();
		expect( result() ).toHaveTextContent( '$100 / month' );
	} );

	it( 'links to the call to action with the visitor’s choices', async () => {
		const user = userEvent.setup();
		render( <Estimator config={ config } /> );

		await user.click( screen.getByRole( 'radio', { name: /growth/i } ) );

		const href = screen
			.getByRole( 'link', { name: 'Request a quote' } )
			.getAttribute( 'href' );
		const url = new URL( href, 'https://mmuzammilq.com' );

		expect( url.pathname ).toBe( '/contact' );
		expect( url.searchParams.get( 'package' ) ).toBe( 'Growth' );
		expect( url.searchParams.get( 'estimate' ) ).toBe( '$100' );
	} );

	it( 'hides the button when there is no link or no estimate yet', async () => {
		const user = userEvent.setup();
		const { rerender } = render(
			<Estimator config={ { ...config, ctaUrl: '' } } />
		);
		expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();

		rerender( <Estimator config={ config } /> );
		await user.click( screen.getByRole( 'radio', { name: /hybrid/i } ) );
		expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();
	} );

	it( 'does not navigate from the editor preview', () => {
		render( <Estimator config={ config } isEditor /> );
		const link = screen.getByRole( 'link', { name: 'Request a quote' } );

		// fireEvent returns false when a handler called preventDefault().
		expect( fireEvent.click( link ) ).toBe( false );
	} );

	it( 'renders nothing when there are no packages', () => {
		const { container } = render(
			<Estimator config={ { ...config, packages: [] } } />
		);

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'keeps unrelated sections independent when two blocks share a page', () => {
		render(
			<>
				<div data-testid="a">
					<Estimator config={ config } />
				</div>
				<div data-testid="b">
					<Estimator config={ config } />
				</div>
			</>
		);
		const a = within( screen.getByTestId( 'a' ) ).getByRole( 'radio', {
			name: /starter/i,
		} );
		const b = within( screen.getByTestId( 'b' ) ).getByRole( 'radio', {
			name: /starter/i,
		} );

		expect( a.name ).not.toBe( b.name );
	} );
} );
