'use strict';

module.exports = () => {
	let storedData = undefined;

	return {
		write(data) {
			return new Promise((resolve) => {
				storedData = data;
				return resolve();
			});
		},

		read() {
			return new Promise((resolve) => {
				return resolve(storedData);
			});
		},
	};
};
