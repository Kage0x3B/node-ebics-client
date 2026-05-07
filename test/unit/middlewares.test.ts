
import { assert } from 'chai';


import response from '../../lib/middleware/response.js';
import serializer from '../../lib/middleware/serializer.js';
import signer from '../../lib/middleware/signer.js';
import createTestClient from '../create-test-client.js';

import { OrdersH004 as Orders } from '../../index.js';

const client = createTestClient();


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
		it('should not throw with supported protocol version and ini operation', () => assert.doesNotThrow(() => serializer.use(Orders.INI as never, client)));
		it('should not throw with supported protocol version and download operation', () => assert.doesNotThrow(() => serializer.use(Orders.STA('2018-01-01', '2018-02-01') as never, client)));
		it('should not throw with supported protocol version and upload operation', () => assert.doesNotThrow(() => serializer.use(Orders.AZV('<xml />') as never, client)));
		it('should throw with no supported protocol version and ', () => assert.throws(() => serializer.use({ version: 'H004', operation: 'unspported' } as never, client)));
		it('should throw with no unuspported protocol version', () => assert.throws(() => serializer.use({ version: 'H003' } as never, client)));
	});
});
