// Bootstrap the local capability before the single Studio 2 renderer.
'use strict';
require('./intentsmith-local-http-bootstrap');
window.__intentsmithStudioMode = 'studio2';
document.documentElement.dataset.intentsmithStudioMode = 'studio2';
require('./src-gen/frontend/index');
