#!/usr/bin/env node
// Stands in for luna-send-pub in the tests: records each call and answers like the TV would.
var fs = require("fs");
var a = process.argv.slice(2), uri = a[a.length - 2], params = JSON.parse(a[a.length - 1] || "{}");
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ uri: uri, params: params }) + "\n");
if (/capture\/executeOneShot/.test(uri)) {
  if (process.env.FAKE_CAPTURE_FAIL && /tv\.capture/.test(uri) === false) { console.log('{"returnValue":false,"errorText":"Service does not exist"}'); process.exit(0); }
  fs.writeFileSync(params.path, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]));
  console.log('{"returnValue":true}');
} else if (/getPointerInputSocket/.test(uri)) {
  console.log(JSON.stringify({ returnValue: true, socketPath: "ws://127.0.0.1:" + process.env.FAKE_WS_PORT + "/resources/x/netinput_pointer.sock" }));
} else console.log('{"returnValue":true}');
