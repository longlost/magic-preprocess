
// allow use of es modules (import/export syntax)
require = require('esm')(module);
require('./cli').cli(process.argv);