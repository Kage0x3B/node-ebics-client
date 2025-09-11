export interface Key {
	pem: string | string[];
}

export interface BankKeys {
	bankX002: Key;
	bankE002: Key;
}

export interface Keys extends BankKeys {
	A006: Key;
	E002: Key;
	X002: Key;
}
