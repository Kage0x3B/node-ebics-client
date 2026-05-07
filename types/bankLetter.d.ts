import { Client } from "./client";

export interface BankLetterOptions {
	client: Client;
	bankName: string;
	template: string;
}

export class BankLetter {
	constructor(options: BankLetterOptions);
	generate(): Promise<string>;
	serialize(path: string): Promise<boolean>;
}
