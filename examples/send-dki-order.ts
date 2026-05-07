#! /usr/bin/env node

import getClient from './getClient.js';
import { Orders } from '../index.js';

const client = getClient();

// The bank keys must have been already saved
client.send(Orders.DKI(null as never, null as never)) // startDate 'YYYY-MM-DD', endDate 'YYYY-MM-DD'
	.then((resp) => {
		const r = resp as { technicalCode: string; orderData: Buffer };
		console.log('Response for DKI order %j', resp);
		if (r.technicalCode !== '000000')
			throw new Error('Something went wrong');

		// Processing of the Exchange Rate file should go here, ideally after saving it to disk
		const data = Buffer.from(r.orderData);
		console.log(data.toString('utf8'));
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
