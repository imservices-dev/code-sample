/**
 * Front-end entry. Finds every Price Estimator on the page and mounts the React
 * app into it, using the configuration the server already sanitised and put in
 * a data attribute (see render.php). Until this runs, visitors and crawlers see
 * the server-rendered list of packages inside the same element.
 */
import { createRoot } from '@wordpress/element';

import Estimator from './Estimator';

function mount( element ) {
	let config;

	try {
		config = JSON.parse( element.dataset.priceEstimator || '' );
	} catch ( error ) {
		// Leave the server-rendered fallback in place rather than a blank block.
		return;
	}

	createRoot( element ).render( <Estimator config={ config } /> );
}

document.querySelectorAll( '[data-price-estimator]' ).forEach( mount );
