import constants from '../../consts.js';

import iniSerializer from './serializers/ini.js';
import downloadSerializer from './serializers/download.js';
import uploadSerializer from './serializers/upload.js';

interface Order {
	version: string;
	operation: string;
	orderDetails: any;
	transactionId?: string;
	document?: string | Buffer;
}

export default {
	use(order: Order, client: any) {
		const operation = order.operation.toUpperCase();

		if (operation === constants.orderOperations.ini) return iniSerializer.use(order, client);
		if (operation === constants.orderOperations.download) return downloadSerializer.use(order, client);
		if (operation === constants.orderOperations.upload) return uploadSerializer.use(order, client);

		throw Error('Error from orders/orders.js: Wrong order version/type.');
	},
};
