import { removeUndefinedProperties } from '../../utils.js';
import type { GenericUploadOrderOptionsH005, UploadOrderH005 } from './types.js';

// preserved bug from original JS: references undeclared `document` (not the function parameter)
declare let document: Buffer | string;

const HVE = (orderId: string, options?: Partial<GenericUploadOrderOptionsH005>): UploadOrderH005 => {
	if (Buffer.isBuffer(document)) {
		document = document.toString('utf-8');
	}

	const order = {
		version: 'h005',
		orderDetails: {
			AdminOrderType: 'HVE',
			HVEOrderParams: {
				Service: {
					ServiceName: options?.serviceName ?? 'SCT',
					Scope: options?.scope,
					ServiceOption: options?.serviceOption,
					MsgName: {
						'#': options?.msgName ?? 'pain.001',
						'@': {
							version: options?.msgVersion,
							variant: options?.msgVariant,
							format: options?.msgFormat,
						},
					},
				},
				OrderID: orderId,
			},
		},
		operation: 'upload',
	};

	return removeUndefinedProperties(order) as unknown as UploadOrderH005;
};

export default HVE;
