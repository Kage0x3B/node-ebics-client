#! /usr/bin/env node

import fs from 'node:fs';

import getClient from './getClient.js';
import { Orders } from '../index.js';

const client = getClient();

// The bank keys must have been already saved
const paymentFile = fs.readFileSync('mytestfile.xml').toString();

client.send(Orders.XG1(paymentFile))
	.then((resp) => {
		console.log('Response for XG1 order %j', resp);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
