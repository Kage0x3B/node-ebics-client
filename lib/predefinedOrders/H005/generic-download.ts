import utils, { removeUndefinedProperties } from '../../utils.js';
import type { DownloadOrderH005, GenericDownloadOrderOptionsH005 } from './types.js';

const genericDownload = (options: GenericDownloadOrderOptionsH005): DownloadOrderH005 => {
	const order = {
		version: 'h005',
		orderDetails: {
			AdminOrderType: 'BTD',
			BTDOrderParams: {
				Service: {
					ServiceName: options.serviceName,
					Scope: options.scope,
					ServiceOption: options.serviceOption,
					Container: options.containerType ? {
						'@': {
							containerType: options.containerType,
						},
					} : undefined,
					MsgName: {
						'#': options.msgName,
						'@': {
							version: options.msgVersion,
							variant: options.msgVariant,
							format: options.msgFormat,
						},
					},
				},
				...utils.dateRange(options.start, options.end),
			},
		},
		operation: 'download',
	};
	return removeUndefinedProperties(order) as unknown as DownloadOrderH005;
};

export default genericDownload;
