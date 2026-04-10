'use strict';

const utils = require('../../utils');
const { removeUndefinedProperties } = require('../../utils');

module.exports = (options) => {
	const order = {
		version: 'h005',
		orderDetails: {
			AdminOrderType: 'HVZ',
			HVZOrderParams: {
			},
		},
		operation: 'download',
	};
	return removeUndefinedProperties(order);
};
