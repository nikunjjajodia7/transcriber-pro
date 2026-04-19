/* fake esbuild preamble — mimics the v1.0.19 bundle's pre-marker region */
var __helper = () => null;

// node_modules/fake-vendor/index.js
var require_fake = function() { return { ok: true }; };

// src/foo.ts
var import_x = require("x");

// src/bar.ts
var _Bar = class {
  hello() { return "bar"; }
};
var Bar = _Bar;

// src/foo.ts
var _Foo = class {
  greet() { return "hi"; }
};
var Foo = _Foo;

// src/bar.ts
Bar.STATIC_FIELD = 42;

// src/foo.ts
Foo.LATE_FIELD = "late";
