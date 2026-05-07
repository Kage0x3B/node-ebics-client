import { removeUndefinedProperties } from '../../utils.js';
import type { GenericUploadOrderOptionsH005, UploadOrderH005 } from './types.js';

const genericUpload = (
	document: string | Buffer,
	options: GenericUploadOrderOptionsH005,
): UploadOrderH005 => {
	if (Buffer.isBuffer(document)) {
		document = document.toString('utf-8');
	}

	const signatureOptions = options.signatureFlag ? {
		SignatureFlag: {
			'#': options.signatureFlag,
			requestEDS: options.requestEDS ? true : undefined,
		},
	} : {};

	const order = {
		version: 'h005',
		orderDetails: {
			AdminOrderType: 'BTU',
			BTUOrderParams: {
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
				...signatureOptions,
			},
		},
		operation: 'upload',
		document,
	};

	return removeUndefinedProperties(order) as unknown as UploadOrderH005;
};

export default genericUpload;
