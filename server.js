var cfg = require('envigor')();

(async function() {
  const app = await require('./app.js')(cfg);
  return app.listen(cfg.port || 3000,function() {
    console.log("Listening on port " + (cfg.port || '3000'));
  });
})().catch(console.error);
