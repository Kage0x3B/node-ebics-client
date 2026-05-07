'use strict';

const genericUpload = require('./generic-upload');

module.exports = (document, options) => genericUpload(document, {
	serviceName: 'XCT',
	msgName: 'pain.001',
	...options,
});
