import { Router } from 'express';
import { Alert } from '../models/Alert.js';
import { AuditLog } from '../models/AuditLog.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { Response } from 'express';

const router = Router();

router.get('/history/all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!['STAFF', 'ADMIN'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const alerts = await Alert.find({}).sort({ timestamp: -1 }).limit(100);
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alert history' });
  }
});

// Get all active alerts (staff only)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!['STAFF', 'ADMIN'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const alerts = await Alert.find({
      status: { $in: ['PENDING', 'ACKNOWLEDGED', 'RESOLVING'] },
    }).sort({ timestamp: -1 });

    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// Create SOS alert
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { type, guestMessage, language } = req.body;

    if (!['FIRE', 'MEDICAL', 'SECURITY'].includes(type)) {
      return res.status(400).json({ error: 'Invalid alert type' });
    }

    // Create alert
    const alert = await Alert.create({
      type,
      userId: req.user?.id,
      room: req.user?.room || 'Unknown',
      floor: req.user?.room?.split('-')[0] || 'Unknown', // Extract floor from room format like "3-201"
      guestMessage,
      guestInfo: {
        language: language || 'Auto-detect',
        originalMessage: guestMessage,
      },
    });

    // Log audit trail
    await AuditLog.create({
      userId: req.user?.id,
      username: req.user?.username,
      action: `SOS_${type}_CREATED`,
      details: `Alert created for room ${req.user?.room}`,
    });

    req.io?.emit('new_alert', alert);

    res.status(201).json(alert);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// Get single alert
router.get('/:alertId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const alert = await Alert.findOne({ id: req.params.alertId });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alert' });
  }
});

// Update alert status (staff only)
router.patch('/:alertId/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!['STAFF', 'ADMIN'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { status, message } = req.body;

    if (!['PENDING', 'ACKNOWLEDGED', 'RESOLVING', 'RESOLVED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const alert = await Alert.findOneAndUpdate(
      { id: req.params.alertId },
      {
        status,
        $push: {
          updates: {
            time: new Date().toISOString(),
            message: message || `Status changed to ${status}`,
            staffName: req.user?.username,
          },
        },
      },
      { new: true }
    );

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    // Log audit trail
    await AuditLog.create({
      userId: req.user?.id,
      username: req.user?.username,
      action: `ALERT_STATUS_UPDATED`,
      details: `Alert ${req.params.alertId} status changed to ${status}`,
    });

    req.io?.emit('alert_updated', alert);

    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// Add update to alert
router.post('/:alertId/updates', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!['STAFF', 'ADMIN'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { message } = req.body;

    const alert = await Alert.findOneAndUpdate(
      { id: req.params.alertId },
      {
        $push: {
          updates: {
            time: new Date().toISOString(),
            message,
            staffName: req.user?.username,
          },
        },
      },
      { new: true }
    );

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    req.io?.emit('alert_updated', alert);

    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add update' });
  }
});

export default router;
