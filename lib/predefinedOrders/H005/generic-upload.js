'use strict';

const { removeUndefinedProperties } = require('../../utils');

module.exports = (document, options) => {
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

	return removeUndefinedProperties(order);
};
