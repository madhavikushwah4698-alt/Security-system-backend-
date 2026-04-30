import express from 'express';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import alertRoutes from './routes/alerts.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: FRONTEND_URL||'http://localhost:5173',
    credentials: true,
  },
});

// Middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Connect to MongoDB
try {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');
} catch (err) {
  console.error('Failed to connect to MongoDB:', err);
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
  res.json({ status: 'ok' });
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

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Frontend URL: ${FRONTEND_URL}`);
});

export { app, io };
