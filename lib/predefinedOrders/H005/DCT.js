'use strict';

const genericUpload = require('./generic-upload');

module.exports = (document, options) => genericUpload(document, {
	serviceName: 'DCT',
	msgName: 'pain.001',
	...options,
});
