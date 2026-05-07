
import { assert } from 'chai';

import path, { dirname } from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as ebics from '../../index.js';
import createTestClient from '../create-test-client.js';

import xmlLintWasm from 'xmllint-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));

const validateXML = (() => {
	const xsdDir = path.resolve(__dirname, '../xsd/H004');
	const schemaPath = path.resolve(xsdDir, 'ebics_H004.xsd');
	const schemaDoc = fs.readFileSync(schemaPath, { encoding: 'utf8' });
	const preload = fs
		.readdirSync(xsdDir)
		.filter(file => file.endsWith('.xsd') && file !== 'ebics_H004.xsd')
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
					fileName: 'ebics_H004.xsd',
					contents: schemaDoc,
				},
			],
			preload,
		});
		return results.valid;
	};
})();

const client = createTestClient();

const { OrdersH004: Orders } = ebics;

const uploadBuilder = (fn: (doc: string) => unknown) => fn('');
const dateBuilder = (fn: (start: string, end: string) => unknown) => fn('2018-01-01', '2019-01-01');

const fnOrders: Record<string, (fn: never) => unknown> = {
	// upload | document
	AZV: uploadBuilder as never,
	CD1: uploadBuilder as never,
	CDB: uploadBuilder as never,
	CDD: uploadBuilder as never,
	CDS: uploadBuilder as never,
	CCT: uploadBuilder as never,
	CCS: uploadBuilder as never,
	XE3: uploadBuilder as never,
	XCT: uploadBuilder as never,

	// download
	STA: dateBuilder as never,
	VMK: dateBuilder as never,
	HAA: dateBuilder as never,
	HTD: dateBuilder as never,
	HPD: dateBuilder as never,
	HKD: dateBuilder as never,
	PTK: dateBuilder as never,
	HAC: dateBuilder as never,
	Z53: dateBuilder as never,
	DKI: dateBuilder as never,
	C53: dateBuilder as never,
	C52: dateBuilder as never,
};

const getOrderObject = (name: string, order: unknown): { orderDetails: { OrderType: string }; operation: string } | null => {
	if (typeof order === 'object') return order as { orderDetails: { OrderType: string }; operation: string };
	if (fnOrders[name]) return fnOrders[name](order as never) as { orderDetails: { OrderType: string }; operation: string };
	return null;
};

describe('H004 order generation', () => {
	for (const [name, orderDefinition] of Object.entries(Orders)) {
		const order = getOrderObject(name, orderDefinition);
		if (!order) continue;

		const type = order.orderDetails.OrderType;
		const { operation } = order;

		it(`[${operation}] ${type} order generation`, async () => {
			const signedOrder = await client.signOrder(order as never);
			assert.isTrue(await validateXML(signedOrder));
		});
	}
});
