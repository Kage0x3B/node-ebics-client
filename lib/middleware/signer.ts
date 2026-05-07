import H004Signer from '../orders/H004/signer.js';
import H005Signer from '../orders/H005/signer.js';

export default {
	version(v: string) {
		if (v.toUpperCase() === 'H004') return H004Signer;
		if (v.toUpperCase() === 'H005') return H005Signer;

		throw Error('Error from middleware/signer.js: Invalid version number');
	},
};
