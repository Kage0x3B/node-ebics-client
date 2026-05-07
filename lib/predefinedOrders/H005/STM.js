'use strict';

const genericDownload = require('./generic-download');

module.exports = options => genericDownload({
	serviceName: 'STM',
	msgName: 'camt.052',
	containerType: 'ZIP',
	...options,
});
