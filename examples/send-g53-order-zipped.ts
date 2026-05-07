#! /usr/bin/env node

import fs from 'node:fs';

import getClient from './getClient.js';
import { Orders } from '../index.js';

const client = getClient();

// The bank keys must have been already saved
client.send(Orders.G53(null as never, null as never)) // startDate 'YYYY-MM-DD', endDate 'YYYY-MM-DD'
	.then((resp) => {
		const r = resp as { technicalCode: string; orderData: Buffer };
		console.log('Response for G53 order %j', resp);
		if (r.technicalCode !== '000000')
			throw new Error('Something went wrong');

		// Parsing and processing the CAMT053 file should happen somewhere here, ideally after saving it to disk
		const data = Buffer.from(r.orderData);
		const distPath = 'CAMT053-G53.zip';
		const dstZip = fs.createWriteStream(distPath);
		dstZip.write(data);
		dstZip.end();
	})

	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
