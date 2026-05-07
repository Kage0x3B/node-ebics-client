import fs from 'node:fs';

import handlebars from 'handlebars';

import { date } from './utils.js';
import type Client from './Client.js';
import type Key from './keymanagers/Key.js';

export interface BankLetterOptions {
	client: Client;
	bankName: string;
	template: string;
}

const registerHelpers = (): void => {
	handlebars.registerHelper('today', () => date.toISODate(Date.now(), false));

	handlebars.registerHelper('now', () => date.toISOTime(Date.now(), false));

	handlebars.registerHelper('keyExponentBits', (k: Key) => Buffer.byteLength(k.e()) * 8);

	handlebars.registerHelper('keyModulusBits', (k: Key) => k.size());

	handlebars.registerHelper('keyExponent', (k: Key) => k.e('hex'));

	handlebars.registerHelper('keyModulus', (k: Key) => k.n('hex').toUpperCase().match(/.{1,2}/g)!.join(' '));

	handlebars.registerHelper('hasCertificate', (k: Key) => k.hasCertificate());

	handlebars.registerHelper('certificatePem', (k: Key) => k.certificatePem());

	handlebars.registerHelper('sha256', (k: Key) => k.sha256());
};

const writeFile = (file: string, content: string): Promise<void> => new Promise((resolve, reject) => fs.writeFile(file, content, (err) => {
	if (err)
		return reject(err);
	return resolve();
}));

export default class BankLetter {
	client: Client;
	bankName: string;
	template: string;

	constructor({
		client,
		bankName,
		template,
	}: BankLetterOptions) {
		this.client = client;
		this.bankName = bankName;
		this.template = template;
	}

	async generate(): Promise<string> {
		registerHelpers();

		const templ = handlebars.compile(this.template);
		const keys = (await this.client.keys())!;

		const data = {
			bankName: this.bankName,
			userId: this.client.userId,
			partnerId: this.client.partnerId,
			A006: keys.a(),
			X002: keys.x(),
			E002: keys.e(),
		};

		return templ(data);
	}

	async serialize(path: string): Promise<boolean> {
		const letter = await this.generate();
		await writeFile(path, letter);
		return true;
	}
}
