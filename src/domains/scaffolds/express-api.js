// Express API Scaffold
// ══════════════════════════════════════════════════════════════════════════════

export const expressApiScaffold = {
  id: 'express-api',
  name: 'Express REST API',
  description: 'Production-ready Express.js REST API with structured routing, error handling, and middleware',
  tags: ['express', 'node', 'api', 'rest', 'crud'],
  stack: ['Node.js', 'Express', 'ESM'],
  complexity: 'SIMPLE',

  files: [
    {
      path: 'package.json',
      type: 'config',
      template: `{
  "name": "{{PROJECT_NAME}}",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "helmet": "^7.0.0"
  },
  "devDependencies": {}
}`,
    },
    {
      path: 'src/server.js',
      type: 'code',
      template: `import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Routes
app.use('/api', router);

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Error handling
app.use(errorHandler);

app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));

export default app;`,
    },
    {
      path: 'src/routes/index.js',
      type: 'code',
      template: `import { Router } from 'express';

export const router = Router();

router.get('/', (req, res) => {
  res.json({ message: 'API is running', version: '1.0.0' });
});

// Add domain routes here:
// router.use('/users', usersRouter);
// router.use('/items', itemsRouter);`,
    },
    {
      path: 'src/middleware/error.js',
      type: 'code',
      template: `export function errorHandler(err, req, res, next) {
  console.error(\`[\${new Date().toISOString()}] Error:\`, err.message);

  const status = err.status || 500;
  const message = status === 500 ? 'Internal Server Error' : err.message;

  res.status(status).json({
    error: { message, status },
  });
}`,
    },
    {
      path: 'src/middleware/logger.js',
      type: 'code',
      template: `export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(\`\${req.method} \${req.path} \${res.statusCode} \${duration}ms\`);
  });
  next();
}`,
    },
  ],

  postSetup: [
    'npm install',
    'npm run dev',
  ],
};
