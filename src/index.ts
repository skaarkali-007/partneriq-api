import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { connectDatabase } from './config/database';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3002',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'affiliate-platform-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Serve static files for uploaded materials
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API routes
import apiRoutes from './routes';
app.use('/api/v1', apiRoutes);

// Initialize tracking services
import { TrackingService } from './services/tracking';
import { NotificationService } from './services/notification';

// Start server
const startServer = async () => {
  try {
    await connectDatabase();
    
    // Initialize MongoDB change streams for real-time conversion notifications
    await TrackingService.initializeConversionChangeStream();
    
    // Initialize notification service
    NotificationService.initialize();
    
    app.listen(PORT, () => {
      logger.info(`Backend server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await TrackingService.closeConversionChangeStream();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await TrackingService.closeConversionChangeStream();
  process.exit(0);
});

// Only start server if this file is run directly (not imported for testing)
if (require.main === module) {
  startServer();
}

export { app };