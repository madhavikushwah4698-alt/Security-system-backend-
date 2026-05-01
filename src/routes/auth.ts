import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { authMiddleware, generateToken, AuthRequest } from '../middleware/auth.js';
import { Response } from 'express';

const router = Router();
const ADMIN_ACCESS_CODE = (process.env.ADMIN_ACCESS_CODE || 'CRISIS-ADMIN-2026').toUpperCase();
const isProduction = process.env.NODE_ENV === 'production';

// Cookie options - properly configured for both dev and production
const authCookieOptions = {
  httpOnly: true,  // Prevents JavaScript access (secure against XSS)
  secure: isProduction,  // HTTPS only in production
  sameSite: isProduction ? 'none' : 'lax',  // 'none' for cross-origin in production
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',  // Ensure cookie is sent to all paths
} as const;

// Register
async function registerHandler(req: AuthRequest, res: Response) {
  try {
    console.log('[REGISTER] Request received for user:', req.body.username);
    
    const { username, email, password, role, room, adminCode } = req.body;

    if (!username || !password || !email) {
      console.log('[REGISTER] Missing required fields');
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const normalizedRole = role === 'ADMIN' ? 'ADMIN' : 'USER';
    if (normalizedRole === 'ADMIN' && (!adminCode || adminCode.toUpperCase() !== ADMIN_ACCESS_CODE)) {
      console.log('[REGISTER] Invalid admin code');
      return res.status(403).json({ error: 'Invalid admin access code' });
    }

    console.log('[REGISTER] Checking if user exists...');
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      console.log('[REGISTER] User already exists');
      return res.status(400).json({ error: 'User already exists' });
    }

    console.log('[REGISTER] Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('[REGISTER] Creating user in database...');
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: normalizedRole,
      room: normalizedRole === 'ADMIN' ? room : undefined,
    });

    console.log('[REGISTER] Creating audit log...');
    const auditLog = await AuditLog.create({
      userId: user.id,
      username: user.username,
      action: 'REGISTER',
      details: `${normalizedRole} account registered`,
    });

    console.log('[REGISTER] Generating token...');
    const token = generateToken(user.id, user.username, user.role, user.room);

    console.log('[REGISTER] Setting cookie...');
    res.cookie('token', token, authCookieOptions);

    console.log('[REGISTER] Sending response...');
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      room: user.room,
    });

    console.log('[REGISTER] Emitting socket events...');
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

    console.log('[REGISTER] ✅ Registration successful for:', username);
  } catch (error) {
    console.error('[REGISTER ERROR]', error instanceof Error ? error.message : error);
    console.error('[REGISTER ERROR STACK]', error instanceof Error ? error.stack : '');
    const errorMessage = error instanceof Error ? error.message : 'Registration failed';
    res.status(500).json({ 
      error: errorMessage,
      detail: error instanceof Error ? error.stack : 'Unknown error'
    });
  }
}

router.post('/register', registerHandler);
router.post('/signup', registerHandler);

// Login
router.post('/login', async (req: AuthRequest, res: Response) => {
  try {
    console.log('[LOGIN] Request received for user:', req.body.username);
    
    const { username, password } = req.body;

    if (!username || !password) {
      console.log('[LOGIN] Missing credentials');
      return res.status(400).json({ error: 'Username and password are required' });
    }

    console.log('[LOGIN] Looking up user in database...');
    const user = await User.findOne({ username });
    if (!user) {
      console.log('[LOGIN] User not found:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('[LOGIN] User found, checking password...');
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('[LOGIN] Invalid password for user:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('[LOGIN] Generating token...');
    const token = generateToken(user.id, user.username, user.role, user.room);

    console.log('[LOGIN] Setting cookie...');
    res.cookie('token', token, authCookieOptions);

    console.log('[LOGIN] Creating audit log...');
    const auditLog = await AuditLog.create({
      userId: user.id,
      username: user.username,
      action: 'LOGIN',
      details: `${user.role} logged in`,
    });

    console.log('[LOGIN] Sending response...');
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      room: user.room,
    });

    console.log('[LOGIN] Emitting socket events...');
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

    console.log('[LOGIN] ✅ Login successful for:', username);
  } catch (error) {
    console.error('[LOGIN ERROR]', error instanceof Error ? error.message : error);
    console.error('[LOGIN ERROR STACK]', error instanceof Error ? error.stack : '');
    res.status(500).json({ 
      error: 'Login failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    console.log('[GET /me] User from token:', req.user?.id);
    const user = await User.findOne({ id: req.user?.id }).select('-password');
    console.log('[GET /me] User found:', user ? 'Yes' : 'No');
    if (!user) {
      console.log('[GET /me] User not found in database');
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('[GET /me ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
  });
  res.json({ message: 'Logged out successfully' });
});

export default router;
