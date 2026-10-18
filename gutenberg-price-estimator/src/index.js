import { registerBlockType } from '@wordpress/blocks';

import Edit from './edit';
import metadata from './block.json';
import './style.scss';
import './editor.scss';

// Dynamic block: the markup is produced by render.php, so `save` stores nothing
// and the block never needs a deprecation when the markup changes.
registerBlockType( metadata.name, {
	edit: Edit,
	save: () => null,
} );
