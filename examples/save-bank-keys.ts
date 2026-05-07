#! /usr/bin/env node

import getClient from './getClient.js';
import { Orders } from '../index.js';

const client = getClient();

// Client keys must be already generated and send by letter.
// The bank should have enabled the user
client.send(Orders.HPB)
	.then((resp) => {
		const r = resp as { technicalCode: string; bankKeys: never };
		console.log('Response for HPB order %j', resp);
		if (r.technicalCode !== '000000')
			throw new Error('Something went wrong');

		console.log('Received bank keys: %j', r.bankKeys);
		return client.setBankKeys(r.bankKeys);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
