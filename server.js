import fs from 'fs';
import https from 'https';
import app from './src/app.js';

const PORT = process.env.PORT || 8000;
const ENV = process.env.NODE_ENV || 'development';

if (ENV === 'production') {
  try {
    const privateKey = fs.readFileSync('/home/musiesupport/certs/privkey.pem', 'utf8');
    const certificate = fs.readFileSync('/home/musiesupport/certs/fullchain.pem', 'utf8');
    const credentials = { key: privateKey, cert: certificate };

    const httpsServer = https.createServer(credentials, app);
    httpsServer.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Production server running on https://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start HTTPS server:', error);
    process.exit(1);
  }
} else {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 Development server running on http://127.0.0.1:${PORT}`);
  });
}