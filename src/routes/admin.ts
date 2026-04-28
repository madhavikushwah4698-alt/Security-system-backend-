import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { translateAndSummarizeIncident, translateText, checkGeminiHealth } from '../services/gemini.js';

const router = Router();

function requireAdmin(req: AuthRequest, res: any) {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

router.get('/personnel', authMiddleware, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const users = await User.find({ role: { $in: ['STAFF', 'ADMIN'] } })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch personnel' });
  }
});

router.post('/personnel', authMiddleware, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { username, email, role, password } = req.body;

    if (!username || !email) {
      return res.status(400).json({ error: 'Username and email are required' });
    }

    const normalizedRole = role === 'ADMIN' ? 'ADMIN' : 'STAFF';
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const tempPassword = password || `ChangeMe-${Math.random().toString(36).slice(-8)}`;
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: normalizedRole,
    });

    const auditLog = await AuditLog.create({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'USER_CREATED',
      details: `Created ${normalizedRole} account for ${username}`,
    });

    req.io?.emit('new_audit_log', auditLog);
    req.io?.emit('personnel_created', {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      room: user.room,
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      room: user.room,
      tempPassword,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create user';
    res.status(500).json({ error: message });
  }
});

router.get('/guests', authMiddleware, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const guests = await User.find({ role: 'USER' }).select('-password').sort({ createdAt: -1 });
    res.json(guests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch guests' });
  }
});

router.patch('/users/:userId', authMiddleware, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { room } = req.body;
    if (!room) {
      return res.status(400).json({ error: 'Room is required' });
    }

    const user = await User.findOneAndUpdate(
      { id: req.params.userId, role: 'USER' },
      { room },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    const auditLog = await AuditLog.create({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'GUEST_ROOM_UPDATED',
      details: `Assigned room ${room} to ${user.username}`,
    });

    req.io?.emit('new_audit_log', auditLog);
    req.io?.emit('guest_room_updated', {
      id: user.id,
      room: user.room,
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update guest room' });
  }
});

router.get('/audit-logs', authMiddleware, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const logs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(200);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.post('/translate', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { text, sourceLang, targetLang } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text is required for translation.' });
    }

    // If a specific target language is requested, use the standalone translateText function
    if (targetLang && typeof targetLang === 'string') {
      const translated = await translateText(text, targetLang);
      return res.json({
        original: text,
        translated,
        targetLang,
      });
    }

    // Default: full translation + summarization (used by alert system)
    const aiResult = await translateAndSummarizeIncident(text, sourceLang);
    res.json({
      original: text,
      translated: aiResult.translatedText,
      detectedLanguage: aiResult.detectedLanguage,
      summary: aiResult.summary,
    });
  } catch (error) {
    console.error('[TRANSLATE ROUTE] Translation failed:', error);
    res.status(500).json({
      error: 'Translation failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Gemini API health check — useful for debugging 403/401 errors
router.get('/gemini-health', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const health = await checkGeminiHealth();
    const httpStatus = health.status === 'ok' ? 200 : 503;
    res.status(httpStatus).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

export default router;
