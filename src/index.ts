import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import alertRoutes from './routes/alerts.js';
import adminRoutes from './routes/admin.js';

// Validate required environment variables
const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

// Middleware
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    const allowedOrigins = [
      FRONTEND_URL,
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:3001',
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Origin ${origin} not allowed`);
      callback(null, false); // Allow for now, remove true to block
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// app.use(cors(corsOptions));
// app.use(express.json({ limit: '10mb' }));
// app.use(cookieParser());



app.use(cors(corsOptions));

// 👇 ADD THIS LINE HERE
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(cookieParser());




// Request logging
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Connect to MongoDB
console.log('[STARTUP] Connecting to MongoDB...');
try {
  await mongoose.connect(MONGODB_URI!);
  console.log('✅ Connected to MongoDB');
  console.log('[STARTUP] Database ready');
} catch (err) {
  console.error('❌ Failed to connect to MongoDB:', err);
  process.exit(1);
}

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  (req as any).io = io;
  next();
});

// Routes
app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api/sos', alertRoutes);
app.use('/api/alerts', alertRoutes);

// Health check
app.get('/health', (req: express.Request, res: express.Response) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.json({ 
    status: 'ok',
    database: dbConnected ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV,
    frontend_url: FRONTEND_URL,
    timestamp: new Date().toISOString(),
  });
});

// Socket.IO for real-time alerts
io.on('connection', (socket: any) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (data: { userId: string; room: string }) => {
    socket.join(`room:${data.room}`);
    socket.join(`user:${data.userId}`);
    socket.emit('joined', { message: 'You joined the room' });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

io.on('error', (error: any) => {
  console.error('[Socket.IO Error]', error);
});

// Global error handler (should be last)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    detail: isProduction ? undefined : err.stack,
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║         🚀 CRISIS CONNECT BACKEND RUNNING          ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║ 🌐 Server: http://localhost:${PORT}`);
  console.log(`║ 🔐 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`║ 📱 Frontend: ${FRONTEND_URL}`);
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📊 SIGTERM received, shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

export { app, io };
