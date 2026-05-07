
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import H004Response from '../../lib/orders/H004/response.js';
import createTestClient from '../create-test-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = createTestClient();

const buildResponse = (xmlPath: string): { orderData: () => string; bankKeys: () => unknown; isSegmented: () => boolean; isLastSegment: () => boolean } => {
	const response = H004Response('<xml/>', {} as never) as never as { orderData: () => string; bankKeys: () => unknown; isSegmented: () => boolean; isLastSegment: () => boolean };
	const xml = readFileSync(xmlPath, { encoding: 'utf8' });
	response.orderData = () => xml;
	return response;
};

const fixtures = {
	HPB: async () => H004Response(readFileSync(join(__dirname, '../fixtures/HPB_response.xml'), { encoding: 'utf8' }), await client.keys() as never),
	HPB_DATA: () => buildResponse(join(__dirname, '../fixtures/HPB_response_data.xml')),
	INI: () => H004Response(readFileSync(join(__dirname, '../fixtures/INI_reposne.xml'), { encoding: 'utf8' }), client.keys() as never),
	STA_1: () => H004Response(readFileSync(join(__dirname, '../fixtures/STA_response_part1.xml'), { encoding: 'utf8' }), client.keys() as never),
	STA_2: () => H004Response(readFileSync(join(__dirname, '../fixtures/STA_response_part2.xml'), { encoding: 'utf8' }), client.keys() as never),
	x002mod: 'AJWVHQIfP0H1fr5Y7IjSlDmFksqQ+0E+CjzbEeE6r444LCuSXwbGKF6DJqguyX1qGYxjHRvVtdkNa+GNAtlZnmuPeLHPBUOs5Zx9J5JP4JZOcKd/wnRDIasTkg3NrtZ22tjOrWx26VuR6h7dUH2oJRnFDHmbXoCDMxkqJUNr/TM89p5slJ9Oj5+NAaOzm+7AlwbJ95EI/xc2jEfhp+GdF9CYdS/m2AZaAt79y6QDtBSDdAs0OHTgsOIjbjZkptBF/Gkip2sOordjsChRNLHLDcAOWbsg1NVMuhXs1b6+bCVLXQcGhFydYhqvrXB7pFS0++hlyzqGhbZK5cwEe/v8EJk=',
	e002mod: 'AJWVHQIfP0H1fr5Y7IjSlDmFksqQ+0E+CjzbEeE6r444LCuSXwbGKF6DJqguyX1qGYxjHRvVtdkNa+GNAtlZnmuPeLHPBUOs5Zx9J5JP4JZOcKd/wnRDIasTkg3NrtZ22tjOrWx26VuR6h7dUH2oJRnFDHmbXoCDMxkqJUNr/TM89p5slJ9Oj5+NAaOzm+7AlwbJ95EI/xc2jEfhp+GdF9CYdS/m2AZaAt79y6QDtBSDdAs0OHTgsOIjbjZkptBF/Gkip2sOordjsChRNLHLDcAOWbsg1NVMuhXs1b6+bCVLXQcGhFydYhqvrXB7pFS0++hlyzqGhbZK5cwEe/v8EJk=',
};


describe('H004 response parsing', () => {
	it('parses bank keys', () => {
		const response = fixtures.HPB_DATA();
		const bankKeys = response.bankKeys() as Record<string, { mod: Buffer; exp: Buffer }>;

		assert.equal(bankKeys.bankX002!.mod.toString('base64'), fixtures.x002mod);
		assert.equal(bankKeys.bankE002!.mod.toString('base64'), fixtures.e002mod);
	});

	it('detects unsegmented response', () => {
		const response = fixtures.HPB_DATA();
		assert.equal(response.isSegmented(), false);
		assert.equal(response.isLastSegment(), false);
	});

	it('detects segmented response', () => {
		const responsePart1 = fixtures.STA_1();
		const responsePart2 = fixtures.STA_2();
		assert.equal(responsePart1.isSegmented(), true);
		assert.equal(responsePart1.isLastSegment(), false);
		assert.equal(responsePart2.isSegmented(), true);
		assert.equal(responsePart2.isLastSegment(), true);
	});

	it('parses OrderID', () => {
		const response = fixtures.INI();
		assert.equal(response.orderId(), 'B004');
	});

	it('parses BuissnessCode', () => {
		const response = fixtures.INI();
		const code = response.businessCode();
		assert.equal(code, '000000');
		assert.equal(response.businessSymbol(code), 'EBICS_OK');
		assert.equal(response.businessMeaning(code), 'No technical errors occurred during processing of the EBICS request');
		assert.equal(response.businessShortText(code), 'OK');
	});

	it('parses TechnicalCode', () => {
		const response = fixtures.INI();
		const code = response.technicalCode();
		assert.equal(code, '000000');
		assert.equal((response.technicalSymbol as (c?: string) => string)(code), '[EBICS_OK] OK');
		assert.equal(response.technicalMeaning(code), 'No technical errors occurred during processing of the EBICS request');
		assert.equal(response.technicalShortText(code), 'OK');
	});

	it('parses TransactionID', () => {
		const response = fixtures.STA_1();
		const code = response.transactionId();
		assert.equal(code, 'ECD6F062AAEDFA77250526A68CBEC549');
	});

	it('parses TransactionKey', async () => {
		const response = await fixtures.HPB();
		const code = (response.transactionKey() as Buffer).toString('base64');
		assert.equal(code, '2OTepxiy49uayuzZlYFf8Q==');
	});

	it('parses OrderData', async () => {
		const response = await fixtures.HPB();
		const orderBuffer = response.orderData();
		assert.deepEqual(orderBuffer, readFileSync(join(__dirname, '../fixtures/HPB_response_data.xml')));
	});

	it('generates XML', async () => {
		const response = await fixtures.HPB();
		const xmlString = response.toXML().replace('\\n', '\n');
		assert.deepEqual(xmlString, readFileSync(join(__dirname, '../fixtures/HPB_response.xml'), { encoding: 'utf8' }));
	});
});
