const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
    app.use(
        createProxyMiddleware('/ws', {
            target: 'ws://127.0.0.1:8080/ws',
            ws: true,
            changeOrigin: true,
        })
    );
    app.use(
        createProxyMiddleware('/',{
            target: 'http://127.0.0.1:8080/',
            changeOrigin: true,
        })
    );
};