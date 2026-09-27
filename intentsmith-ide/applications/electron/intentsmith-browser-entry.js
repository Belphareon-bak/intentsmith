// IntentSmith local capability bootstrap must run before Theia frontend modules.
'use strict';
require('./intentsmith-local-http-bootstrap');
// Select a renderer before Theia evaluates any UI extension. A malformed or
// inaccessible preference fails to the existing, production classic UI.
let studioMode = 'classic';
try {
  if (window.localStorage.getItem('intentsmith-studio-ui-mode') === 'studio2') studioMode = 'studio2';
} catch (_) { /* local storage may be unavailable */ }
window.__intentsmithStudioMode = studioMode;
document.documentElement.dataset.intentsmithStudioMode = studioMode;
require('./src-gen/frontend/index');
