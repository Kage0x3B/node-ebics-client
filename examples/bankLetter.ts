#! /usr/bin/env node

import * as ebics from '../index.js';
import path from 'node:path';
import fs from 'node:fs';

import loadConfig from './loadConfig.js';
import getClient from './getClient.js';

const config = loadConfig();
const client = getClient(config as never);
const bankName = client.bankName;
const template = fs.readFileSync('./templates/ini_' + client.languageCode + '.hbs', { encoding: 'utf8' });
const bankLetterFile = path.join('./', 'bankLetter_' + client.bankShortName + '_' + client.languageCode + '.html');

const letter = new ebics.BankLetter({ client, bankName, template });

letter.serialize(bankLetterFile)
	.then(() => {
		console.log('Send your bank the letter (%s)', bankLetterFile);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
