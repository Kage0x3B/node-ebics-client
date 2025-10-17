'use strict';

const Client = require('./lib/Client');
const OrdersH004 = require('./lib/predefinedOrders/H004');
const OrdersH005 = require('./lib/predefinedOrders/H005');
const fsKeysStorage = require('./lib/storages/fsKeysStorage');
const inMemoryKeysStorage = require('./lib/storages/inMemoryKeysStorage');
const tracesStorage = require('./lib/storages/tracesStorage');
const BankLetter = require('./lib/BankLetter');

module.exports = {
	Client,
	/** @deprecated Use OrdersH004 or OrdersH005 instead */
	Orders: OrdersH004,
	OrdersH004,
	OrdersH005,
	BankLetter,
	fsKeysStorage,
	inMemoryKeysStorage,
	tracesStorage,
};
