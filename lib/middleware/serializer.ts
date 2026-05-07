import H004Serializer from '../orders/H004/serializer.js';
import H005Serializer from '../orders/H005/serializer.js';

interface OrderLike {
	version: string;
	operation?: string;
	orderDetails?: any;
	transactionId?: string;
	document?: string | Buffer;
	[k: string]: unknown;
}

export default {
	use(order: OrderLike, client: unknown) {
		const { version } = order;

		if (version.toUpperCase() === 'H004') return H004Serializer.use(order as never, client);
		if (version.toUpperCase() === 'H005') return H005Serializer.use(order as never, client);

		throw Error('Error middleware/serializer.js: Invalid version number');
	},
};
