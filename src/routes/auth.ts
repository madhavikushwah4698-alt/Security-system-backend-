import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { authMiddleware, generateToken, AuthRequest } from '../middleware/auth.js';
import { Response } from 'express';

const router = Router();
const ADMIN_ACCESS_CODE = (process.env.ADMIN_ACCESS_CODE || 'CRISIS-ADMIN-2026').toUpperCase();

// Register
async function registerHandler(req: AuthRequest, res: Response) {
  try {
    const { username, email, password, role, room, adminCode } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const normalizedRole = role === 'ADMIN' ? 'ADMIN' : 'USER';
    if (normalizedRole === 'ADMIN' && (!adminCode || adminCode.toUpperCase() !== ADMIN_ACCESS_CODE)) {
      return res.status(403).json({ error: 'Invalid admin access code' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (room is only assigned by admin)
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: normalizedRole,
      room: normalizedRole === 'ADMIN' ? room : undefined,
    });

    const auditLog = await AuditLog.create({
      userId: user.id,
      username: user.username,
      action: 'REGISTER',
      details: `${normalizedRole} account registered`,
    });

    const token = generateToken(user.id, user.username, user.role, user.room);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      room: user.room,
    });

    req.io?.emit('new_audit_log', auditLog);
    if (user.role === 'USER') {
      req.io?.emit('guest_logged_in', {
        id: user.id,
        username: user.username,
        email: user.email,
        room: user.room,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Registration failed';
    res.status(500).json({ error: errorMessage });
  }
}

router.post('/register', registerHandler);
router.post('/signup', registerHandler);

// Login
router.post('/login', async (req: AuthRequest, res: Response) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id, user.username, user.role, user.room);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const auditLog = await AuditLog.create({
      userId: user.id,
      username: user.username,
      action: 'LOGIN',
      details: `${user.role} logged in`,
    });

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      room: user.room,
    });

    req.io?.emit('new_audit_log', auditLog);
    if (user.role === 'USER') {
      req.io?.emit('guest_logged_in', {
        id: user.id,
        username: user.username,
        email: user.email,
        room: user.room,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findOne({ id: req.user?.id }).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

export default router;
