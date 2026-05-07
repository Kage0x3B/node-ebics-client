
import { assert } from 'chai';

import path, { dirname } from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as ebics from '../../index.js';

import xmlLintWasm from 'xmllint-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

	return async (str: string): Promise<boolean> => {
		const results = await xmlLintWasm.validateXML({
			xml: [{ fileName: 'ebics.xml', contents: str }],
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

const iniBuilder = (fn: () => unknown) => fn();
const uploadBuilder = (fn: (doc: string, opts?: unknown) => unknown) => fn('', undefined);
const dateBuilder = (fn: (opts?: unknown) => unknown) => fn({ start: '2018-01-01', end: '2019-01-01' });

const fnOrders: Record<string, (fn: never) => unknown> = {
	INI: iniBuilder as never,
	HIA: iniBuilder as never,
	H3K: iniBuilder as never,
	HPB: iniBuilder as never,

	// upload | document
	DCT: uploadBuilder as never,
	DDT: uploadBuilder as never,
	MCT: uploadBuilder as never,
	SCT: uploadBuilder as never,
	SDD: uploadBuilder as never,
	XCT: uploadBuilder as never,

	// download
	EOP: dateBuilder as never,
	PSR: dateBuilder as never,
	REP: dateBuilder as never,
	STM: dateBuilder as never,
};

const getOrderObject = (name: string, order: unknown) => {
	if (typeof order === 'object') return order as { orderDetails: Record<string, unknown>; operation: string };
	if (fnOrders[name]) return fnOrders[name](order as never) as { orderDetails: Record<string, unknown>; operation: string };
	return null;
};

describe('H005 order generation', () => {
	for (const [name, orderDefinition] of Object.entries(Orders)) {
		const order = getOrderObject(name, orderDefinition);
		if (!order) continue;

		let type;
		const od = order.orderDetails as { BTUOrderParams?: { Service: { ServiceName: string } }; BTDOrderParams?: { Service: { ServiceName: string } }; AdminOrderType?: string };
		if (od.BTUOrderParams) type = od.BTUOrderParams.Service.ServiceName;
		else if (od.BTDOrderParams) type = od.BTDOrderParams.Service.ServiceName;
		else type = od.AdminOrderType;

		const { operation } = order;

		it(`[${operation}] ${type} order generation`, async () => {
			await client.generateKeys({
				subject: 'ebics.example.com',
			}, ['A006', 'E002', 'X002', 'bankE002', 'bankX002']);
			const signedOrder = await client.signOrder(order as never);
			assert.isTrue(await validateXML(signedOrder));
		});
	}
});
