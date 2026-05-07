'use strict';

/* eslint-env node, mocha */

const { assert } = require('chai');

const path = require('path');
const fs = require('fs');

const ebics = require('../..');

const xmlLintWasm = require('xmllint-wasm');

const validateXML = (() => {
	const xsdDir = path.resolve(__dirname, '../xsd/H005');
	const schemaPath = path.resolve(xsdDir, 'ebics_H005.xsd');
	const schemaDoc = fs.readFileSync(schemaPath, { encoding: 'utf8' });
	const preload = fs
		.readdirSync(xsdDir)
		.filter(file => file.endsWith('.xsd') && file !== 'ebics_H005.xsd')
		.map(file => ({
			fileName: file,
			contents: fs.readFileSync(path.join(xsdDir, file), {
				encoding: 'utf8',
			}),
		}));

	return async (str) => {
		const results = await xmlLintWasm.validateXML({
			xml: { fileName: 'ebics.xml', contents: str },
			schema: [
				{
					fileName: 'ebics_H005.xsd',
					contents: schemaDoc,
				},
			],
			preload,
		});
		if (!results.valid) console.log(results.errors.map(e => e.message).join('\n'));
		return results.valid;
	};
})();

const client = new ebics.Client({
	url: 'https://iso20022test.credit-suisse.com/ebicsweb/ebicsweb',
	partnerId: 'CRS04381',
	userId: 'CRS04381',
	hostId: 'CRSISOTB',
	passphrase: Buffer.alloc(32, 0),
	iv: Buffer.alloc(16, 0),
	keyStorage: ebics.inMemoryKeysStorage(),
});

const { OrdersH005: Orders } = ebics;

const iniBuilder = fn => fn();
const uploadBuilder = fn => fn('', undefined);
const dateBuilder = fn => fn({ start: '2018-01-01', end: '2019-01-01' });

const fnOrders = {
	INI: iniBuilder,
	HIA: iniBuilder,
	H3K: iniBuilder,
	HPB: iniBuilder,

	// upload | document
	DCT: uploadBuilder,
	DDT: uploadBuilder,
	MCT: uploadBuilder,
	SCT: uploadBuilder,
	SDD: uploadBuilder,
	XCT: uploadBuilder,

	// download
	EOP: dateBuilder,
	PSR: dateBuilder,
	REP: dateBuilder,
	STM: dateBuilder,
};

const getOrderObject = (name, order) => {
	if (typeof order === 'object') return order;
	if (fnOrders[name]) return fnOrders[name](order);
	return null;
};

describe('H005 order generation', () => {
	// eslint-disable-next-line no-restricted-syntax
	for (const [name, orderDefinition] of Object.entries(Orders)) {
		const order = getOrderObject(name, orderDefinition);
		if (!order) continue;

		let type;
		if (order.orderDetails.BTUOrderParams) type = order.orderDetails.BTUOrderParams.Service.ServiceName;
		else if (order.orderDetails.BTDOrderParams) type = order.orderDetails.BTDOrderParams.Service.ServiceName;
		else type = order.orderDetails.AdminOrderType;

		const { operation } = order;

		it(`[${operation}] ${type} order generation`, async () => {
			await client.generateKeys({
				subject: 'ebics.example.com',
			}, ['A006', 'E002', 'X002', 'bankE002', 'bankX002']);
			const signedOrder = await client.signOrder(order);
			assert.isTrue(await validateXML(signedOrder));
		});
	}
});
