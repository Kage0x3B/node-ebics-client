'use strict';

const { removeUndefinedProperties } = require('../../utils');

module.exports = (document, options) => {
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
			},
		},
		operation: 'upload',
		document,
	};

	return removeUndefinedProperties(order);
};
