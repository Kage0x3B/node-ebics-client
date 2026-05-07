import H004Response from '../orders/H004/response.js';
import H005Response from '../orders/H005/response.js';

export default {
	version(v: string) {
		if (v.toUpperCase() === 'H004') return H004Response;
		if (v.toUpperCase() === 'H005') return H005Response;

		throw Error('Error from middleware/response.js: Invalid version number');
	},
};
