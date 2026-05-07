import { removeUndefinedProperties } from '../../utils.js';
import type { DownloadOrderH005, GenericDownloadOrderOptionsH005 } from './types.js';

const HVZ = (options?: Partial<GenericDownloadOrderOptionsH005>): DownloadOrderH005 => {
	const order = {
		version: 'h005',
		orderDetails: {
			AdminOrderType: 'HVZ',
			HVZOrderParams: {
			},
		},
		operation: 'download',
	};
	return removeUndefinedProperties(order) as unknown as DownloadOrderH005;
};

export default HVZ;
