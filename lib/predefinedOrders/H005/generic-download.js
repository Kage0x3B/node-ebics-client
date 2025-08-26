'use strict';

const utils = require('../../utils');
const { removeUndefinedProperties } = require('../../utils');

module.exports = (options) => {
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
	return removeUndefinedProperties(order);
};
