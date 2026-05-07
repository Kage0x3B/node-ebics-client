'use strict';

/* eslint-env node, mocha */

const { assert } = require('chai');


const response = require('../../lib/middleware/response');
const serializer = require('../../lib/middleware/serializer');
const signer = require('../../lib/middleware/signer');
const createTestClient = require('../create-test-client');

const client = createTestClient();
const { OrdersH004: Orders } = require('../../');


describe('Middlewares', () => {
	describe('Response Middleware', () => {
		it('should not throw with supported protocol version', () => assert.doesNotThrow(() => response.version('H004')));
		it('should throw with no unsupported protocol version', () => assert.throws(() => response.version('H003')));
	});
	describe('Signer Middleware', () => {
		it('should not throw with supported protocol version', () => assert.doesNotThrow(() => signer.version('H004')));
		it('should throw with no unsupported protocol version', () => assert.throws(() => signer.version('H003')));
	});
	describe('Serializer Middleware', () => {
		it('should not throw with supported protocol version and ini operation', () => assert.doesNotThrow(() => serializer.use(Orders.INI, client)));
		it('should not throw with supported protocol version and download operation', () => assert.doesNotThrow(() => serializer.use(Orders.STA('2018-01-01', '2018-02-01'), client)));
		it('should not throw with supported protocol version and upload operation', () => assert.doesNotThrow(() => serializer.use(Orders.AZV('<xml />'), client)));
		it('should throw with no supported protocol version and ', () => assert.throws(() => serializer.use({ version: 'H004', operation: 'unspported' }, client)));
		it('should throw with no unuspported protocol version', () => assert.throws(() => serializer.use({ version: 'H003' }, client)));
	});
});
