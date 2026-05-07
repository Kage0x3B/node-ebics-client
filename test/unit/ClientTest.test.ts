
import { assert } from 'chai';

import { Client, fsKeysStorage, tracesStorage } from '../../index.js';

describe('Client', () => {
	describe('instantiating', () => {
		it('should throw with no options provided', () => assert.throws(() => new (Client as unknown as new () => Client)()));
		it('should throw with no url provided', () => assert.throws(() => new Client({} as never)));
		it('should throw with no partnerId provided', () => assert.throws(() => new Client({ url: 'https://myebics.com' } as never)));
		it('should throw with no userId provided', () => assert.throws(() => new Client({ url: 'https://myebics.com', partnerId: 'partnerId' } as never)));
		it('should throw with no hostId provided', () => assert.throws(() => new Client({ url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId' } as never)));
		it('should throw with no passphrase provided', () => assert.throws(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId',
		} as never)));
		it('should throw with no keyStorage provided', () => assert.throws(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId', passphrase: 'test',
		} as never)));
		it('should create an isntance without tracesStorage', () => assert.doesNotThrow(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId', passphrase: 'test', keyStorage: fsKeysStorage('./test.key'),
		})));
		it('should create an isntance with tracesStorage', () => assert.doesNotThrow(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId', passphrase: 'test', keyStorage: fsKeysStorage('./test.key'), tracesStorage: tracesStorage('./'),
		})));
	});
});
